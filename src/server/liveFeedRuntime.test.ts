import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { ConnectorEventListener, ConnectorStatusListener, ConnectorHealth } from "../connectors/types";
import type { ConnectorStatus, UnifiedEvent } from "../domain/unifiedEvent";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import { LiveFeedRuntime } from "./liveFeedRuntime";

class MockClient {
  readyState = WebSocket.OPEN;
  messages: unknown[] = [];

  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
}

class MockServer {
  clients = new Set<MockClient>();
  private connectionListener: ((client: MockClient) => void) | null = null;

  on(_event: "connection", listener: (client: MockClient) => void) {
    this.connectionListener = listener;
  }

  close(callback: (error?: Error) => void) {
    callback();
  }

  connect(client = new MockClient()) {
    this.clients.add(client);
    this.connectionListener?.(client);
    return client;
  }
}

class MockConnector {
  readonly platform = "twitch" as const;
  private eventListener: ConnectorEventListener | null = null;
  private statusListener: ConnectorStatusListener | null = null;
  private health: ConnectorHealth = {
    platform: "twitch",
    state: "stopped",
    label: "Mock Twitch",
    sourceName: "marketbubble",
    eventCount: 0,
    droppedCount: 0,
    reconnectCount: 0
  };

  async start() {
    this.health = {
      ...this.health,
      state: "live"
    };
    this.statusListener?.(this.health);
  }

  async stop() {
    this.health = {
      ...this.health,
      state: "stopped"
    };
  }

  status() {
    return this.health;
  }

  subscribe(listener: ConnectorEventListener) {
    this.eventListener = listener;
    return () => {
      this.eventListener = null;
    };
  }

  subscribeStatus(listener: ConnectorStatusListener) {
    this.statusListener = listener;
    return () => {
      this.statusListener = null;
    };
  }

  emit(event: UnifiedEvent) {
    this.health = {
      ...this.health,
      eventCount: this.health.eventCount + 1,
      lastEventAt: event.receivedAt
    };
    this.statusListener?.(this.health);
    this.eventListener?.(event);
  }
}

function findStatus(messages: unknown[]): ConnectorStatus | undefined {
  return messages.find((message): message is { type: "status"; status: ConnectorStatus } => {
    return typeof message === "object" && message !== null && "type" in message && message.type === "status";
  })?.status;
}

describe("LiveFeedRuntime", () => {
  it("serves fixture snapshots and events", async () => {
    const server = new MockServer();
    const runtime = new LiveFeedRuntime({
      port: 18801,
      mode: "fixture",
      fixtureIntervalMs: 20,
      initialEventCount: 3,
      webSocketServer: server
    });

    await runtime.start();
    const client = server.connect();
    runtime.broadcastEvent(createFixtureEvent(20));
    await runtime.stop();

    expect(client.messages[0]).toMatchObject({
      type: "snapshot"
    });
    expect(client.messages.some((message) => (message as { type?: string }).type === "event")).toBe(true);
  });

  it("fans out connector events and statuses in connector mode", async () => {
    const server = new MockServer();
    const connector = new MockConnector();
    const runtime = new LiveFeedRuntime({
      port: 18802,
      mode: "connectors",
      connectors: [connector],
      webSocketServer: server
    });
    await runtime.start();

    const client = server.connect();
    connector.emit({
      ...createFixtureEvent(2),
      platform: "twitch",
      platformEventId: "real-message-1",
      id: "twitch:real-message-1"
    });
    await runtime.stop();

    expect(client.messages.some((message) => (message as { type?: string }).type === "event")).toBe(true);
    expect(findStatus(client.messages)).toMatchObject({
      platform: "twitch",
      state: "live",
      eventCount: 1
    });
  });
});

