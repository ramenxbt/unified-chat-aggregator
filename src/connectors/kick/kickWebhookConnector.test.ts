import { createSign, generateKeyPairSync } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KickWebhookConnector,
  parseKickHeaders,
  verifyKickWebhookSignature,
  type KickWebhookConnectorConfig
} from "./kickWebhookConnector";

const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: "pkcs1",
    format: "pem"
  },
  publicKeyEncoding: {
    type: "spki",
    format: "pem"
  }
});

const activeConnectors: KickWebhookConnector[] = [];
const configFetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

beforeEach(() => {
  configFetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
});

afterEach(async () => {
  await Promise.all(activeConnectors.map((connector) => connector.stop()));
  activeConnectors.length = 0;
  configFetch.mockReset();
});

function createConnector(config: Partial<KickWebhookConnectorConfig> = {}) {
  const connector = new KickWebhookConnector(
    {
      port: 0,
      publicKey: keyPair.publicKey,
      sourceName: "marketbubble",
      ...config
    },
    {
      now: () => new Date("2026-06-04T18:00:01.000Z"),
      fetch: configFetch,
      serverFactory: createMockServerFactory()
    }
  );
  activeConnectors.push(connector);
  return connector;
}

function chatPayload(messageId = "message-1") {
  return {
    message_id: messageId,
    replies_to: {
      message_id: "parent-1",
      content: "parent",
      sender: {
        is_anonymous: false,
        user_id: 111,
        username: "parent_user",
        is_verified: false,
        profile_picture: "https://example.test/parent.jpg",
        channel_slug: "parent-user",
        identity: null
      }
    },
    broadcaster: {
      is_anonymous: false,
      user_id: 123456789,
      username: "Market Bubble",
      is_verified: true,
      profile_picture: "https://example.test/broadcaster.jpg",
      channel_slug: "marketbubble",
      identity: null
    },
    sender: {
      is_anonymous: false,
      user_id: 987654321,
      username: "user91",
      is_verified: false,
      profile_picture: "https://example.test/sender.jpg",
      channel_slug: "user91",
      identity: {
        username_color: "#67e85f",
        badges: [
          {
            text: "Subscriber",
            type: "subscriber",
            count: 3
          }
        ]
      }
    },
    content: "HYPE just different [emote:4148074:HYPERCLAP]",
    emotes: [
      {
        emote_id: "4148074",
        positions: [{ s: 20, e: 43 }]
      }
    ],
    created_at: "2026-06-04T18:00:00.000Z"
  };
}

function signedHeaders(rawBody: string, overrides: Record<string, string> = {}) {
  const messageId = overrides["Kick-Event-Message-Id"] ?? "01JTESTMESSAGEID";
  const timestamp = overrides["Kick-Event-Message-Timestamp"] ?? "2026-06-04T18:00:00.000Z";
  const signer = createSign("RSA-SHA256");
  signer.update(`${messageId}.${timestamp}.${rawBody}`);
  signer.end();

  return {
    "Content-Type": "application/json",
    "Kick-Event-Message-Id": messageId,
    "Kick-Event-Subscription-Id": "01JTESTSUBSCRIPTION",
    "Kick-Event-Signature": signer.sign(keyPair.privateKey, "base64"),
    "Kick-Event-Message-Timestamp": timestamp,
    "Kick-Event-Type": "chat.message.sent",
    "Kick-Event-Version": "1",
    ...overrides
  };
}

function acceptWebhook(connector: KickWebhookConnector, body: unknown, headers: Record<string, string> = {}) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);

  return connector.acceptWebhook(Buffer.from(rawBody), {
    ...signedHeaders(rawBody),
    ...headers
  });
}

function createMockServerFactory() {
  return (_listener: (request: IncomingMessage, response: ServerResponse) => void) => ({
    address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4321 }),
    close: (callback: (error?: Error) => void) => callback(),
    listen: (_port: number, _host: string, callback: () => void) => callback(),
    off: () => undefined,
    once: () => undefined
  });
}

function createCapturingServerFactory() {
  let capturedListener: ((request: IncomingMessage, response: ServerResponse) => void) | null = null;

  return {
    serverFactory: (listener: (request: IncomingMessage, response: ServerResponse) => void) => {
      capturedListener = listener;

      return {
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 4321 }),
        close: (callback: (error?: Error) => void) => callback(),
        listen: (_port: number, _host: string, callback: () => void) => callback(),
        off: () => undefined,
        once: () => undefined
      };
    },
    request: async (request: Partial<IncomingMessage>) => {
      if (!capturedListener) {
        throw new Error("No listener captured");
      }

      const response = createMockResponse();

      capturedListener(request as IncomingMessage, response as unknown as ServerResponse);
      await flush();

      return response;
    }
  };
}

function createMockResponse() {
  return {
    body: undefined as unknown,
    headers: undefined as unknown,
    statusCode: 0,
    writeHead(statusCode: number, headers?: unknown) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(body?: unknown) {
      this.body = body;
      return this;
    }
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("KickWebhookConnector", () => {
  it("verifies Kick webhook signatures", () => {
    const rawBody = Buffer.from(JSON.stringify(chatPayload()));
    const headers = parseKickHeaders(signedHeaders(rawBody.toString("utf8")));

    expect(headers).not.toBeNull();
    expect(verifyKickWebhookSignature(keyPair.publicKey, headers!, rawBody)).toBe(true);
    expect(
      verifyKickWebhookSignature(keyPair.publicKey, { ...headers!, signature: "not-valid" }, rawBody)
    ).toBe(false);
  });

  it("normalizes signed Kick chat webhooks and dedupes repeats", async () => {
    const connector = createConnector();
    const events: unknown[] = [];
    connector.subscribe((event) => events.push(event));

    await connector.start();
    const status = acceptWebhook(connector, chatPayload("message-1"));
    const duplicateStatus = acceptWebhook(connector, chatPayload("message-1"));

    expect(status).toBe(204);
    expect(duplicateStatus).toBe(204);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "kick:message-1",
      platform: "kick",
      kind: "chat_message",
      platformEventId: "message-1",
      sourceChannelName: "marketbubble",
      authorName: "user91",
      authorColor: "#67e85f",
      text: "HYPE just different [emote:4148074:HYPERCLAP]",
      parentEventId: "parent-1",
      badges: [{ type: "subscriber", label: "Subscriber", count: 3 }],
      fragments: [
        { type: "text", text: "HYPE just different " },
        { type: "emote", id: "4148074", text: "HYPERCLAP" }
      ]
    });
    expect(connector.status().eventCount).toBe(1);
  });

  it("serves a safe receiver health check for tunnel validation", async () => {
    const server = createCapturingServerFactory();
    const connector = new KickWebhookConnector(
      {
        port: 0,
        publicKey: keyPair.publicKey,
        sourceName: "marketbubble"
      },
      {
        now: () => new Date("2026-06-04T18:00:01.000Z"),
        fetch: configFetch,
        serverFactory: server.serverFactory
      }
    );
    activeConnectors.push(connector);

    await connector.start();

    const response = await server.request({
      method: "GET",
      url: "/webhooks/kick"
    });
    const headResponse = await server.request({
      method: "HEAD",
      url: "/webhooks/kick"
    });
    const body = JSON.parse(String(response.body));

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      platform: "kick",
      receiver: "ready",
      path: "/webhooks/kick"
    });
    expect(headResponse.statusCode).toBe(200);
    expect(headResponse.body).toBeUndefined();
    expect(connector.status().droppedCount).toBe(0);
  });

  it("rejects unsigned or forged webhook requests", async () => {
    const connector = createConnector();
    const events: unknown[] = [];
    connector.subscribe((event) => events.push(event));

    await connector.start();
    const status = acceptWebhook(connector, chatPayload(), {
      "Kick-Event-Signature": "bad-signature"
    });

    expect(status).toBe(401);
    expect(events).toHaveLength(0);
    expect(connector.status()).toMatchObject({
      state: "unauthorized",
      droppedCount: 1,
      lastError: "Kick webhook signature verification failed"
    });
  });

  it("creates a chat message event subscription when configured", async () => {
    configFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const connector = createConnector({
      accessToken: "kick-token",
      broadcasterUserId: 123456789,
      subscribeOnStart: true,
      subscriptionEndpoint: "https://example.test/events/subscriptions"
    });

    await connector.start();

    expect(configFetch).toHaveBeenCalledWith(
      "https://example.test/events/subscriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer kick-token",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({
          method: "webhook",
          events: [{ name: "chat.message.sent", version: 1 }],
          broadcaster_user_id: 123456789
        })
      })
    );
  });

  it("surfaces Kick subscription rate limits in connector health", async () => {
    configFetch.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const connector = createConnector({
      accessToken: "kick-token",
      subscribeOnStart: true,
      subscriptionEndpoint: "https://example.test/events/subscriptions"
    });

    await connector.start();

    expect(connector.status()).toMatchObject({
      state: "rate_limited",
      lastError: "Kick event subscription failed with HTTP 429"
    });
  });
});
