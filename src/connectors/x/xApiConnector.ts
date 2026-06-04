import {
  buildUnifiedEventId,
  type ConnectorStatus,
  type UnifiedBadge,
  type UnifiedEvent
} from "../../domain/unifiedEvent";
import { ConnectorEventBus } from "../eventBus";
import type { Connector, ConnectorHealth, ConnectorRuntimeOptions } from "../types";
import {
  xFilteredStreamPayloadSchema,
  xRulesResponseSchema,
  xSpacesSearchResponseSchema,
  type XFilteredStreamPayload,
  type XSpace,
  type XUser
} from "./xApiTypes";

export type XApiConnectorConfig = {
  bearerToken: string;
  filterRules?: string[];
  spacesQuery?: string;
  filteredStreamEndpoint?: string;
  rulesEndpoint?: string;
  spacesSearchEndpoint?: string;
  spacesPollMs?: number;
};

export type XApiConnectorOptions = ConnectorRuntimeOptions & {
  fetch?: typeof fetch;
};

const defaultFilteredStreamEndpoint = "https://api.x.com/2/tweets/search/stream";
const defaultRulesEndpoint = "https://api.x.com/2/tweets/search/stream/rules";
const defaultSpacesSearchEndpoint = "https://api.x.com/2/spaces/search";
const defaultSpacesPollMs = 30000;

export class XApiConnector implements Connector {
  readonly platform = "x" as const;

  private readonly bus = new ConnectorEventBus();
  private readonly seenEventIds = new Set<string>();
  private readonly now: () => Date;
  private readonly fetcher: typeof fetch;
  private streamAbortController: AbortController | null = null;
  private spacesInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private health: ConnectorHealth;

  constructor(
    private readonly config: XApiConnectorConfig,
    options: XApiConnectorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? fetch;
    this.health = this.createInitialHealth();
  }

  async start() {
    if (this.running) return;

    this.running = true;
    this.updateHealth({
      state: "connecting",
      startedAt: this.now().toISOString(),
      lastError: undefined
    });

    if (this.config.filterRules?.length) {
      try {
        await this.ensureFilterRules();
      } catch (error) {
        this.markNetworkFailure(error, "X filter rules setup failed");
      }
      void this.startFilteredStream();
    }

    if (this.config.spacesQuery) {
      try {
        await this.pollSpaces();
      } catch (error) {
        this.markNetworkFailure(error, "X Spaces search failed");
      }
      this.spacesInterval = setInterval(() => {
        void this.pollSpaces().catch((error: unknown) => {
          this.markNetworkFailure(error, "X Spaces search failed");
        });
      }, this.config.spacesPollMs ?? defaultSpacesPollMs);
    }

    if (!this.config.filterRules?.length && !this.config.spacesQuery) {
      this.updateHealth({
        state: "degraded",
        lastError: "X connector has no filter rules or Spaces query"
      });
    }
  }

  async stop() {
    this.running = false;
    this.streamAbortController?.abort();
    this.streamAbortController = null;

    if (this.spacesInterval) {
      clearInterval(this.spacesInterval);
      this.spacesInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.updateHealth({ state: "stopped" });
  }

  status() {
    return this.health;
  }

  subscribe(listener: (event: UnifiedEvent) => void) {
    return this.bus.subscribe(listener);
  }

  subscribeStatus(listener: (status: ConnectorStatus) => void) {
    return this.bus.subscribeStatus(listener);
  }

  private async ensureFilterRules() {
    const rules = this.config.filterRules ?? [];

    if (rules.length === 0) return;

    const response = await this.fetcher(this.config.rulesEndpoint ?? defaultRulesEndpoint, {
      headers: this.headers()
    });

    if (!response.ok) {
      this.markHttpFailure(response, "X filter rules lookup failed");
      return;
    }

    const parsed = xRulesResponseSchema.safeParse(await response.json());
    const existingValues = new Set(parsed.success ? parsed.data.data?.map((rule) => rule.value) : []);
    const missingRules = rules.filter((rule) => !existingValues.has(rule));

    if (missingRules.length === 0) return;

    const addResponse = await this.fetcher(this.config.rulesEndpoint ?? defaultRulesEndpoint, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        add: missingRules.map((value, index) => ({
          value,
          tag: `rule-${index + 1}`
        }))
      })
    });

    if (!addResponse.ok) {
      this.markHttpFailure(addResponse, "X filter rules update failed");
    }
  }

  private async startFilteredStream() {
    if (!this.running) return;

    this.streamAbortController?.abort();
    this.streamAbortController = new AbortController();

    const url = new URL(this.config.filteredStreamEndpoint ?? defaultFilteredStreamEndpoint);
    url.searchParams.set("tweet.fields", "created_at,author_id,conversation_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name,profile_image_url,verified");

    try {
      const response = await this.fetcher(url.toString(), {
        headers: this.headers(),
        signal: this.streamAbortController.signal
      });

      if (!response.ok) {
        this.markHttpFailure(response, "X filtered stream failed");
        return;
      }

      if (!response.body) {
        this.updateHealth({
          state: "degraded",
          lastError: "X filtered stream did not return a readable body"
        });
        return;
      }

      this.updateHealth({ state: "live" });
      await this.readFilteredStream(response.body);
    } catch (error) {
      if (!this.running || this.streamAbortController?.signal.aborted) return;

      this.updateHealth({
        state: "reconnecting",
        reconnectCount: this.health.reconnectCount + 1,
        lastError: error instanceof Error ? error.message : "X filtered stream disconnected"
      });
    }
  }

  private async readFilteredStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (this.running) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        this.handleFilteredStreamLine(line);
      }
    }

    if (buffer.trim()) {
      this.handleFilteredStreamLine(buffer);
    }

    if (this.running) {
      this.updateHealth({
        state: "reconnecting",
        reconnectCount: this.health.reconnectCount + 1
      });
      this.reconnectTimeout = setTimeout(() => {
        void this.startFilteredStream();
      }, 1000);
    }
  }

  private handleFilteredStreamLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) return;

    let rawPayload: unknown;

    try {
      rawPayload = JSON.parse(trimmedLine);
    } catch {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid X filtered stream JSON"
      });
      return;
    }

    const parsedPayload = xFilteredStreamPayloadSchema.safeParse(rawPayload);

    if (!parsedPayload.success) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid X filtered stream payload"
      });
      return;
    }

    this.emitEvent(this.normalizePost(parsedPayload.data, rawPayload));
  }

  private async pollSpaces() {
    if (!this.config.spacesQuery || !this.running) return;

    const url = new URL(this.config.spacesSearchEndpoint ?? defaultSpacesSearchEndpoint);
    url.searchParams.set("query", this.config.spacesQuery);
    url.searchParams.set("state", "live");
    url.searchParams.set("max_results", "10");
    url.searchParams.set(
      "space.fields",
      "id,state,title,creator_id,host_ids,speaker_ids,participant_count,subscriber_count,scheduled_start,started_at,updated_at"
    );
    url.searchParams.set("expansions", "creator_id,host_ids,speaker_ids");
    url.searchParams.set("user.fields", "username,name,profile_image_url,verified");

    const response = await this.fetcher(url.toString(), {
      headers: this.headers()
    });

    if (!response.ok) {
      this.markHttpFailure(response, "X Spaces search failed");
      return;
    }

    const parsedResponse = xSpacesSearchResponseSchema.safeParse(await response.json());

    if (!parsedResponse.success) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid X Spaces search payload"
      });
      return;
    }

    for (const space of parsedResponse.data.data ?? []) {
      this.emitEvent(this.normalizeSpace(space, parsedResponse.data.includes?.users ?? [], parsedResponse.data));
    }

    this.updateHealth({ state: "live" });
  }

  private normalizePost(payload: XFilteredStreamPayload, raw: unknown): UnifiedEvent {
    const author = payload.includes?.users?.find((user) => user.id === payload.data.author_id);
    const ruleTags = payload.matching_rules?.map((rule) => rule.tag ?? rule.id).filter(Boolean) ?? [];
    const occurredAt = payload.data.created_at ?? this.now().toISOString();
    const receivedAt = this.now().toISOString();

    return {
      id: buildUnifiedEventId("x", payload.data.id),
      platform: "x",
      kind: "post",
      platformEventId: payload.data.id,
      sourceChannelName: ruleTags.length ? ruleTags.join(", ") : "filtered stream",
      authorId: payload.data.author_id,
      authorName: author?.username ?? author?.name,
      authorAvatarUrl: author?.profile_image_url,
      text: payload.data.text,
      fragments: [],
      badges: normalizeUserBadges(author),
      parentEventId: payload.data.conversation_id,
      occurredAt,
      receivedAt,
      raw
    };
  }

  private normalizeSpace(space: XSpace, users: XUser[], raw: unknown): UnifiedEvent {
    const creator = users.find((user) => user.id === space.creator_id);
    const participantText =
      typeof space.participant_count === "number" ? ` - ${space.participant_count} participants` : "";
    const occurredAt = space.started_at ?? space.updated_at ?? this.now().toISOString();
    const eventVersion = [space.updated_at, space.participant_count, space.state].filter(Boolean).join(":");
    const platformEventId = `space:${space.id}:${eventVersion || "live"}`;

    return {
      id: buildUnifiedEventId("x", platformEventId),
      platform: "x",
      kind: "space_metadata",
      platformEventId,
      sourceChannelId: space.id,
      sourceChannelName: "live spaces",
      authorId: creator?.id ?? space.creator_id,
      authorName: creator?.username ?? creator?.name,
      authorAvatarUrl: creator?.profile_image_url,
      text: `Live Space: ${space.title ?? space.id}${participantText}`,
      fragments: [],
      badges: normalizeUserBadges(creator),
      occurredAt,
      receivedAt: this.now().toISOString(),
      raw
    };
  }

  private emitEvent(event: UnifiedEvent) {
    const dedupeKey = buildUnifiedEventId(event.platform, event.platformEventId);

    if (this.seenEventIds.has(dedupeKey)) {
      return;
    }

    this.seenEventIds.add(dedupeKey);
    this.bus.emit(event);
    this.updateHealth({
      state: "live",
      eventCount: this.health.eventCount + 1,
      lastEventAt: event.receivedAt,
      latencyMs: Math.max(0, new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime())
    });
  }

  private markHttpFailure(response: Response, message: string) {
    this.updateHealth({
      state:
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "unauthorized"
            : "degraded",
      lastError: `${message} with HTTP ${response.status}`
    });
  }

  private markNetworkFailure(error: unknown, message: string) {
    this.updateHealth({
      state: "degraded",
      lastError: error instanceof Error ? `${message}: ${error.message}` : message
    });
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.config.bearerToken}`,
      Accept: "application/json"
    };
  }

  private createInitialHealth(): ConnectorHealth {
    return {
      platform: "x",
      state: "stopped",
      label: "Filtered stream + Spaces",
      sourceName: this.config.spacesQuery ?? this.config.filterRules?.join(", ") ?? "configured feed",
      eventCount: 0,
      droppedCount: 0,
      reconnectCount: 0
    };
  }

  private updateHealth(nextHealth: Partial<ConnectorHealth>) {
    this.health = {
      ...this.health,
      ...nextHealth
    };
    this.bus.emitStatus(this.health);
  }
}

function normalizeUserBadges(user: XUser | undefined): UnifiedBadge[] {
  if (!user?.verified) return [];

  return [{ type: "verified", label: "Verified" }];
}
