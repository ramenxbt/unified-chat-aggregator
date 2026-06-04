import { describe, expect, it, vi } from "vitest";
import { TwitchEventSubConnector, type EventSubSocketFactory } from "./twitchEventSubConnector";

class MockSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  close() {
    this.closed = true;
    this.onclose?.({});
  }

  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

const config = {
  clientId: "client-id",
  accessToken: "access-token",
  broadcasterUserId: "1337",
  botUserId: "9001",
  broadcasterLogin: "marketbubble",
  endpoint: "wss://example.test/ws",
  subscriptionEndpoint: "https://example.test/eventsub"
};

function createConnector(fetchResponse: Partial<Response> = { ok: true, status: 202 }) {
  const sockets: MockSocket[] = [];
  const socketFactory: EventSubSocketFactory = (url) => {
    const socket = new MockSocket(url);
    sockets.push(socket);
    return socket;
  };
  const fetcher = vi.fn(async () => fetchResponse as Response);
  const now = () => new Date("2026-06-04T18:00:01.000Z");
  const connector = new TwitchEventSubConnector(config, {
    fetch: fetcher as unknown as typeof fetch,
    now,
    socketFactory
  });

  return {
    connector,
    fetcher,
    sockets
  };
}

function welcomeMessage(sessionId = "session-1") {
  return {
    metadata: {
      message_id: "welcome-1",
      message_type: "session_welcome",
      message_timestamp: "2026-06-04T18:00:00.000Z"
    },
    payload: {
      session: {
        id: sessionId,
        status: "connected",
        connected_at: "2026-06-04T18:00:00.000Z"
      }
    }
  };
}

function notificationMessage(messageId = "message-1") {
  return {
    metadata: {
      message_id: `eventsub-${messageId}`,
      message_type: "notification",
      message_timestamp: "2026-06-04T18:00:00.000Z",
      subscription_type: "channel.chat.message",
      subscription_version: "1"
    },
    payload: {
      subscription: {
        id: "subscription-1",
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: "1337",
          user_id: "9001"
        },
        transport: {
          method: "websocket",
          session_id: "session-1"
        }
      },
      event: {
        broadcaster_user_id: "1337",
        broadcaster_user_login: "marketbubble",
        broadcaster_user_name: "MarketBubble",
        chatter_user_id: "777",
        chatter_user_login: "user67",
        chatter_user_name: "User67",
        message_id: messageId,
        message: {
          text: "Ansem is cooking again",
          fragments: [
            {
              type: "text",
              text: "Ansem is cooking again"
            }
          ]
        },
        color: "#a970ff",
        badges: [
          {
            set_id: "moderator",
            id: "1",
            info: ""
          }
        ]
      }
    }
  };
}

async function flush() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("TwitchEventSubConnector", () => {
  it("creates a channel chat message subscription after session welcome", async () => {
    const { connector, fetcher, sockets } = createConnector();

    await connector.start();
    sockets[0].emit(welcomeMessage("session-abc"));
    await flush();

    expect(fetcher).toHaveBeenCalledWith(
      "https://example.test/eventsub",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "Client-Id": "client-id"
        }),
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: "1337",
            user_id: "9001"
          },
          transport: {
            method: "websocket",
            session_id: "session-abc"
          }
        })
      })
    );
    expect(connector.status().state).toBe("live");
  });

  it("normalizes Twitch chat notifications into unified events and dedupes repeats", async () => {
    const { connector, sockets } = createConnector();
    const events: unknown[] = [];
    connector.subscribe((event) => events.push(event));

    await connector.start();
    sockets[0].emit(welcomeMessage());
    await flush();
    sockets[0].emit(notificationMessage("message-1"));
    sockets[0].emit(notificationMessage("message-1"));
    await flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "twitch:message-1",
      platform: "twitch",
      kind: "chat_message",
      platformEventId: "message-1",
      sourceChannelName: "marketbubble",
      authorName: "user67",
      text: "Ansem is cooking again",
      badges: [{ type: "moderator", label: "1" }]
    });
    expect(connector.status().eventCount).toBe(1);
  });

  it("marks unauthorized when subscription creation is rejected", async () => {
    const { connector, sockets } = createConnector({ ok: false, status: 403 });

    await connector.start();
    sockets[0].emit(welcomeMessage());
    await flush();

    expect(connector.status()).toMatchObject({
      state: "unauthorized",
      lastError: "Twitch subscription failed with HTTP 403"
    });
  });

  it("opens Twitch reconnect URL when EventSub asks for reconnect", async () => {
    const { connector, sockets } = createConnector();

    await connector.start();
    sockets[0].emit({
      metadata: {
        message_id: "reconnect-1",
        message_type: "session_reconnect",
        message_timestamp: "2026-06-04T18:00:00.000Z"
      },
      payload: {
        session: {
          id: "session-1",
          status: "reconnecting",
          connected_at: "2026-06-04T18:00:00.000Z",
          reconnect_url: "wss://example.test/reconnect"
        }
      }
    });
    await flush();

    expect(sockets.map((socket) => socket.url)).toEqual([
      "wss://example.test/ws",
      "wss://example.test/reconnect"
    ]);
    expect(connector.status().reconnectCount).toBe(1);
  });

  it("degrades instead of throwing on invalid JSON", async () => {
    const { connector, sockets } = createConnector();

    await connector.start();
    sockets[0].emit("{bad json");
    await flush();

    expect(connector.status()).toMatchObject({
      state: "degraded",
      droppedCount: 1,
      lastError: "Invalid Twitch EventSub JSON"
    });
  });
});

