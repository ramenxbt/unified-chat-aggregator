import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { ConnectorEventListener, ConnectorStatusListener, ConnectorHealth } from "../connectors/types";
import type { ConnectorStatus, UnifiedEvent } from "../domain/unifiedEvent";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import type { FeedArchive, FeedArchiveSession } from "./feedArchive";
import { LiveFeedRuntime } from "./liveFeedRuntime";

class MockClient {
  readyState: WebSocket["readyState"] = WebSocket.OPEN;
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

class MockArchive implements FeedArchive {
  readonly sessions: FeedArchiveSession[] = [];
  readonly events: UnifiedEvent[] = [];
  readonly statuses: ConnectorStatus[] = [];
  stoppedAt: string | null = null;

  async start(session: FeedArchiveSession) {
    this.sessions.push(session);
  }

  recordEvent(event: UnifiedEvent) {
    this.events.push(event);
  }

  recordStatus(status: ConnectorStatus) {
    this.statuses.push(status);
  }

  async stop(endedAt: string) {
    this.stoppedAt = endedAt;
  }
}

function messagesOfType<T extends string>(messages: unknown[], type: T) {
  return messages.filter((message): message is { type: T } => {
    return typeof message === "object" && message !== null && "type" in message && message.type === type;
  });
}

function findStatus(messages: unknown[]): ConnectorStatus | undefined {
  return messages.find((message): message is { type: "status"; status: ConnectorStatus } => {
    return typeof message === "object" && message !== null && "type" in message && message.type === "status";
  })?.status;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error("Timed out waiting for runtime condition");
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

  it("sends bounded replay snapshots to late clients", async () => {
    const server = new MockServer();
    const runtime = new LiveFeedRuntime({
      port: 18803,
      mode: "fixture",
      bufferSize: 2,
      initialEventCount: 0,
      webSocketServer: server
    });

    const first = createFixtureEvent(1);
    const second = createFixtureEvent(2);
    const third = createFixtureEvent(3);

    await runtime.start();
    runtime.broadcastEvent(first);
    runtime.broadcastEvent(second);
    runtime.broadcastEvent(third);
    const client = server.connect();
    await runtime.stop();

    expect(client.messages[0]).toMatchObject({
      type: "snapshot",
      events: [third, second]
    });
  });

  it("does not rebroadcast duplicate platform events", async () => {
    const server = new MockServer();
    const runtime = new LiveFeedRuntime({
      port: 18804,
      mode: "fixture",
      initialEventCount: 0,
      webSocketServer: server
    });
    const event = createFixtureEvent(4);

    await runtime.start();
    const client = server.connect();
    runtime.broadcastEvent(event);
    runtime.broadcastEvent({ ...event, id: "different-local-id" });
    await runtime.stop();

    expect(messagesOfType(client.messages, "event")).toHaveLength(1);
  });

  it("emits fixture bursts from a single interval tick", async () => {
    const server = new MockServer();
    const runtime = new LiveFeedRuntime({
      port: 18807,
      mode: "fixture",
      initialEventCount: 0,
      fixtureIntervalMs: 10,
      fixtureBurstSize: 4,
      webSocketServer: server
    });

    await runtime.start();
    const client = server.connect();
    await waitFor(() => messagesOfType(client.messages, "event").length >= 4);
    await runtime.stop();

    expect(messagesOfType(client.messages, "event").length).toBeGreaterThanOrEqual(4);
  });

  it("skips clients that are not open under fanout pressure", async () => {
    const server = new MockServer();
    const runtime = new LiveFeedRuntime({
      port: 18805,
      mode: "fixture",
      initialEventCount: 0,
      webSocketServer: server
    });
    const openClient = new MockClient();
    const closedClient = new MockClient();
    closedClient.readyState = WebSocket.CLOSED;

    await runtime.start();
    server.connect(openClient);
    server.connect(closedClient);
    runtime.broadcastEvent(createFixtureEvent(5));
    await runtime.stop();

    expect(messagesOfType(openClient.messages, "event")).toHaveLength(1);
    expect(messagesOfType(closedClient.messages, "event")).toHaveLength(0);
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

  it("archives accepted events and statuses", async () => {
    const server = new MockServer();
    const archive = new MockArchive();
    const runtime = new LiveFeedRuntime({
      port: 18806,
      mode: "fixture",
      initialEventCount: 0,
      webSocketServer: server,
      archive
    });
    const event = createFixtureEvent(8);

    await runtime.start();
    runtime.broadcastEvent(event);
    runtime.broadcastEvent({ ...event, id: "different-local-id" });
    await runtime.stop();

    expect(archive.sessions).toHaveLength(1);
    expect(archive.sessions[0]).toMatchObject({
      mode: "fixture",
      bufferSize: 250,
      fixtureBurstSize: 1
    });
    expect(archive.events).toEqual([event]);
    expect(archive.statuses.some((status) => status.platform === event.platform)).toBe(true);
    expect(archive.stoppedAt).not.toBeNull();
  });
});
