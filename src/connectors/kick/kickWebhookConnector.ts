import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "http";
import { createVerify } from "crypto";
import type { AddressInfo } from "net";
import {
  buildUnifiedEventId,
  type ConnectorStatus,
  type UnifiedBadge,
  type UnifiedEvent,
  type UnifiedFragment
} from "../../domain/unifiedEvent";
import { ConnectorEventBus } from "../eventBus";
import type { Connector, ConnectorHealth, ConnectorRuntimeOptions } from "../types";
import {
  kickChatMessagePayloadSchema,
  kickWebhookHeadersSchema,
  type KickChatMessagePayload,
  type KickUser,
  type KickWebhookHeaders
} from "./kickWebhookTypes";

export type KickWebhookConnectorConfig = {
  port: number;
  path?: string;
  publicKey?: string;
  verifySignatures?: boolean;
  sourceName?: string;
  accessToken?: string;
  broadcasterUserId?: number;
  subscribeOnStart?: boolean;
  subscriptionEndpoint?: string;
};

export type KickWebhookConnectorOptions = ConnectorRuntimeOptions & {
  fetch?: typeof fetch;
  serverFactory?: HttpServerFactory;
};

type HttpServerLike = {
  address(): AddressInfo | string | null;
  close(callback: (error?: Error) => void): void;
  listen(port: number, host: string, callback: () => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
};

type HttpServerFactory = (listener: (request: IncomingMessage, response: ServerResponse) => void) => HttpServerLike;

const defaultPath = "/webhooks/kick";
const defaultSubscriptionEndpoint = "https://api.kick.com/public/v1/events/subscriptions";
const maxBodyBytes = 1024 * 1024;

export const kickDefaultPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

export class KickWebhookConnector implements Connector {
  readonly platform = "kick" as const;

  private readonly bus = new ConnectorEventBus();
  private readonly seenEventIds = new Set<string>();
  private readonly now: () => Date;
  private readonly fetcher: typeof fetch;
  private readonly serverFactory: HttpServerFactory;
  private server: HttpServerLike | null = null;
  private health: ConnectorHealth;

  constructor(
    private readonly config: KickWebhookConnectorConfig,
    options: KickWebhookConnectorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? fetch;
    this.serverFactory = options.serverFactory ?? ((listener) => createServer(listener));
    this.health = this.createInitialHealth();
  }

  async start() {
    if (this.server) return;

    this.updateHealth({
      state: "connecting",
      startedAt: this.now().toISOString(),
      lastError: undefined
    });

    this.server = this.serverFactory((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.config.port, "127.0.0.1", () => {
        this.server?.off("error", reject);
        resolve();
      });
    });

    this.updateHealth({ state: "live" });

    if (this.config.subscribeOnStart) {
      await this.createChatMessageSubscription();
    }
  }

  async stop() {
    if (!this.server) {
      this.updateHealth({ state: "stopped" });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
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

  webhookUrl() {
    const address = this.server?.address();
    const port = typeof address === "object" && address ? address.port : this.config.port;

    return `http://127.0.0.1:${port}${this.config.path ?? defaultPath}`;
  }

  acceptWebhook(rawBody: Buffer, incomingHeaders: IncomingHttpHeaders) {
    const headers = parseKickHeaders(incomingHeaders);

    if (!headers) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Kick webhook headers were missing or invalid"
      });
      return 400;
    }

    if (this.shouldVerifySignature() && !verifyKickWebhookSignature(this.config.publicKey ?? kickDefaultPublicKey, headers, rawBody)) {
      this.updateHealth({
        state: "unauthorized",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Kick webhook signature verification failed"
      });
      return 401;
    }

    if (headers.eventType !== "chat.message.sent" || headers.eventVersion !== "1") {
      this.updateHealth({
        state: "live",
        droppedCount: this.health.droppedCount + 1,
        lastError: `Unsupported Kick event ${headers.eventType} v${headers.eventVersion}`
      });
      return 202;
    }

    let rawPayload: unknown;

    try {
      rawPayload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid Kick webhook JSON"
      });
      return 400;
    }

    const parsedPayload = kickChatMessagePayloadSchema.safeParse(rawPayload);

    if (!parsedPayload.success) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid Kick chat message payload"
      });
      return 400;
    }

    this.emitEvent(this.normalizeChatMessage(parsedPayload.data, headers, rawPayload));
    return 204;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname !== (this.config.path ?? defaultPath)) {
      response.writeHead(404).end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    let rawBody: Buffer;

    try {
      rawBody = await readRequestBody(request);
    } catch {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Kick webhook body exceeded the size limit"
      });
      response.writeHead(413).end();
      return;
    }

    response.writeHead(this.acceptWebhook(rawBody, request.headers)).end();
  }

  private async createChatMessageSubscription() {
    if (!this.config.accessToken) {
      this.updateHealth({
        state: "degraded",
        lastError: "Kick subscription setup needs KICK_ACCESS_TOKEN"
      });
      return;
    }

    const body: Record<string, unknown> = {
      method: "webhook",
      events: [{ name: "chat.message.sent", version: 1 }]
    };

    if (this.config.broadcasterUserId) {
      body.broadcaster_user_id = this.config.broadcasterUserId;
    }

    const response = await this.fetcher(this.config.subscriptionEndpoint ?? defaultSubscriptionEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      this.updateHealth({
        state:
          response.status === 429
            ? "rate_limited"
            : response.status === 401 || response.status === 403
              ? "unauthorized"
              : "degraded",
        lastError: `Kick event subscription failed with HTTP ${response.status}`
      });
    }
  }

  private normalizeChatMessage(payload: KickChatMessagePayload, headers: KickWebhookHeaders, raw: unknown): UnifiedEvent {
    const occurredAt = payload.created_at ?? headers.timestamp;
    const receivedAt = this.now().toISOString();

    return {
      id: buildUnifiedEventId("kick", payload.message_id),
      platform: "kick",
      kind: "chat_message",
      platformEventId: payload.message_id,
      sourceChannelId: payload.broadcaster.user_id?.toString(),
      sourceChannelName: payload.broadcaster.channel_slug ?? payload.broadcaster.username ?? undefined,
      authorId: payload.sender.user_id?.toString(),
      authorName: payload.sender.username ?? undefined,
      authorAvatarUrl: normalizeOptionalUrl(payload.sender.profile_picture),
      authorColor: payload.sender.identity?.username_color,
      text: payload.content,
      fragments: normalizeFragments(payload),
      badges: normalizeBadges(payload.sender),
      parentEventId: payload.replies_to?.message_id,
      occurredAt,
      receivedAt,
      raw: {
        headers,
        payload: raw
      }
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

  private shouldVerifySignature() {
    return this.config.verifySignatures ?? true;
  }

  private createInitialHealth(): ConnectorHealth {
    return {
      platform: "kick",
      state: "stopped",
      label: "Events webhook",
      sourceName: this.config.sourceName ?? this.config.path ?? defaultPath,
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

export function verifyKickWebhookSignature(publicKey: string, headers: KickWebhookHeaders, rawBody: Buffer) {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headers.messageId}.${headers.timestamp}.`);
    verifier.update(rawBody);
    verifier.end();

    return verifier.verify(publicKey, headers.signature, "base64");
  } catch {
    return false;
  }
}

export function parseKickHeaders(headers: IncomingHttpHeaders): KickWebhookHeaders | null {
  const parsedHeaders = kickWebhookHeadersSchema.safeParse({
    messageId: getHeader(headers, "kick-event-message-id"),
    subscriptionId: getHeader(headers, "kick-event-subscription-id"),
    signature: getHeader(headers, "kick-event-signature"),
    timestamp: getHeader(headers, "kick-event-message-timestamp"),
    eventType: getHeader(headers, "kick-event-type"),
    eventVersion: getHeader(headers, "kick-event-version")
  });

  return parsedHeaders.success ? parsedHeaders.data : null;
}

function getHeader(headers: IncomingHttpHeaders, key: string) {
  const value =
    headers[key] ?? Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === key)?.[1];

  if (Array.isArray(value)) return value[0];
  return value;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;

      if (totalBytes > maxBodyBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function normalizeFragments(payload: KickChatMessagePayload): UnifiedFragment[] {
  const fragments: UnifiedFragment[] = [];
  const emotePattern = /\[emote:([^:\]]+):([^\]]+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = emotePattern.exec(payload.content)) !== null) {
    if (match.index > cursor) {
      fragments.push({
        type: "text",
        text: payload.content.slice(cursor, match.index)
      });
    }

    fragments.push({
      type: "emote",
      id: match[1],
      text: match[2]
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < payload.content.length) {
    fragments.push({
      type: "text",
      text: payload.content.slice(cursor)
    });
  }

  return fragments.length > 0 ? fragments : [{ type: "text", text: payload.content }];
}

function normalizeBadges(user: KickUser): UnifiedBadge[] {
  const badges: UnifiedBadge[] =
    user.identity?.badges?.map((badge) => ({
      type: badge.type,
      label: badge.text,
      count: badge.count
    })) ?? [];

  if (user.is_verified) {
    badges.push({ type: "verified", label: "Verified" });
  }

  return badges;
}

function normalizeOptionalUrl(value: string | null | undefined) {
  if (!value) return undefined;

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}
