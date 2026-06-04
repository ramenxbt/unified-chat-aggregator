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
  twitchChatNotificationPayloadSchema,
  twitchEventSubMessageSchema,
  twitchSessionPayloadSchema,
  type TwitchChatMessageEvent
} from "./eventSubTypes";

type EventSubSocket = {
  close: () => void;
  send?: (data: string) => void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export type EventSubSocketFactory = (url: string) => EventSubSocket;

export type TwitchEventSubConfig = {
  clientId: string;
  accessToken: string;
  broadcasterUserId: string;
  botUserId: string;
  broadcasterLogin?: string;
  endpoint?: string;
  subscriptionEndpoint?: string;
};

export type TwitchEventSubConnectorOptions = ConnectorRuntimeOptions & {
  fetch?: typeof fetch;
  socketFactory?: EventSubSocketFactory;
};

const defaultEndpoint = "wss://eventsub.wss.twitch.tv/ws";
const defaultSubscriptionEndpoint = "https://api.twitch.tv/helix/eventsub/subscriptions";

export class TwitchEventSubConnector implements Connector {
  readonly platform = "twitch" as const;

  private readonly bus = new ConnectorEventBus();
  private readonly seenEventIds = new Set<string>();
  private readonly now: () => Date;
  private readonly fetcher: typeof fetch;
  private readonly socketFactory: EventSubSocketFactory;
  private socket: EventSubSocket | null = null;
  private running = false;
  private health: ConnectorHealth;

  constructor(
    private readonly config: TwitchEventSubConfig,
    options: TwitchEventSubConnectorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? fetch;
    this.socketFactory =
      options.socketFactory ??
      ((url) => {
        return new WebSocket(url) as EventSubSocket;
      });
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
    this.connect(this.config.endpoint ?? defaultEndpoint);
  }

  async stop() {
    this.running = false;
    this.socket?.close();
    this.socket = null;
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

  private connect(url: string) {
    const socket = this.socketFactory(url);
    this.socket = socket;

    socket.onopen = () => {
      this.updateHealth({ state: "connecting" });
    };

    socket.onmessage = (message) => {
      void this.handleSocketMessage(message.data);
    };

    socket.onerror = () => {
      this.updateHealth({
        state: "degraded",
        lastError: "Twitch EventSub WebSocket error"
      });
    };

    socket.onclose = () => {
      if (this.running && this.health.state !== "reconnecting") {
        this.updateHealth({
          state: "reconnecting",
          reconnectCount: this.health.reconnectCount + 1
        });
      }
    };
  }

  private async handleSocketMessage(data: string) {
    let rawMessage: unknown;

    try {
      rawMessage = JSON.parse(data);
    } catch {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid Twitch EventSub JSON"
      });
      return;
    }

    const parsedMessage = twitchEventSubMessageSchema.safeParse(rawMessage);

    if (!parsedMessage.success) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid Twitch EventSub message"
      });
      return;
    }

    const { metadata, payload } = parsedMessage.data;

    if (metadata.message_type === "session_welcome") {
      const sessionPayload = twitchSessionPayloadSchema.parse(payload);
      const subscribed = await this.createChatMessageSubscription(sessionPayload.session.id);

      if (subscribed) {
        this.updateHealth({ state: "live" });
      }
      return;
    }

    if (metadata.message_type === "session_keepalive") {
      this.updateHealth({ state: "live" });
      return;
    }

    if (metadata.message_type === "session_reconnect") {
      const sessionPayload = twitchSessionPayloadSchema.parse(payload);
      this.updateHealth({
        state: "reconnecting",
        reconnectCount: this.health.reconnectCount + 1
      });

      if (sessionPayload.session.reconnect_url) {
        this.connect(sessionPayload.session.reconnect_url);
      }
      return;
    }

    if (metadata.message_type === "revocation") {
      this.updateHealth({
        state: "unauthorized",
        lastError: "Twitch EventSub subscription was revoked"
      });
      return;
    }

    if (metadata.message_type === "notification") {
      this.handleNotification(payload, metadata.message_timestamp);
    }
  }

  private async createChatMessageSubscription(sessionId: string) {
    const response = await this.fetcher(this.config.subscriptionEndpoint ?? defaultSubscriptionEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Client-Id": this.config.clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: this.config.broadcasterUserId,
          user_id: this.config.botUserId
        },
        transport: {
          method: "websocket",
          session_id: sessionId
        }
      })
    });

    if (!response.ok) {
      this.updateHealth({
        state: response.status === 401 || response.status === 403 ? "unauthorized" : "degraded",
        lastError: `Twitch subscription failed with HTTP ${response.status}`
      });
      return false;
    }

    return true;
  }

  private handleNotification(payload: unknown, messageTimestamp: string) {
    const parsedPayload = twitchChatNotificationPayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      this.updateHealth({
        state: "degraded",
        droppedCount: this.health.droppedCount + 1,
        lastError: "Invalid Twitch chat notification payload"
      });
      return;
    }

    const event = this.normalizeChatMessage(parsedPayload.data.event, messageTimestamp, payload);
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
      latencyMs: Math.max(
        0,
        new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime()
      )
    });
  }

  private normalizeChatMessage(
    event: TwitchChatMessageEvent,
    messageTimestamp: string,
    raw: unknown
  ): UnifiedEvent {
    const occurredAt = messageTimestamp;
    const receivedAt = this.now().toISOString();

    return {
      id: buildUnifiedEventId("twitch", event.message_id),
      platform: "twitch",
      kind: "chat_message",
      platformEventId: event.message_id,
      sourceChannelId: event.broadcaster_user_id,
      sourceChannelName: event.broadcaster_user_login || event.broadcaster_user_name,
      authorId: event.chatter_user_id,
      authorName: event.chatter_user_login || event.chatter_user_name,
      authorColor: event.color,
      text: event.message.text,
      fragments: normalizeFragments(event),
      badges: normalizeBadges(event),
      occurredAt,
      receivedAt,
      raw
    };
  }

  private createInitialHealth(): ConnectorHealth {
    return {
      platform: "twitch",
      state: "stopped",
      label: "EventSub WebSocket",
      sourceName: this.config.broadcasterLogin ?? this.config.broadcasterUserId,
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

function normalizeFragments(event: TwitchChatMessageEvent): UnifiedFragment[] {
  return event.message.fragments.map((fragment) => {
    if (fragment.type === "emote" && fragment.emote) {
      return {
        type: "emote",
        text: fragment.text,
        id: fragment.emote.id
      };
    }

    if (fragment.type === "mention" && fragment.mention) {
      return {
        type: "mention",
        text: fragment.text,
        id: fragment.mention.user_id
      };
    }

    if (fragment.type === "cheermote") {
      return {
        type: "cheermote",
        text: fragment.text
      };
    }

    return {
      type: "text",
      text: fragment.text
    };
  });
}

function normalizeBadges(event: TwitchChatMessageEvent): UnifiedBadge[] {
  return event.badges.map((badge) => ({
    type: badge.set_id,
    label: badge.id,
    count: Number.isFinite(Number(badge.info)) ? Number(badge.info) : undefined
  }));
}
