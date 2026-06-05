import { WebSocket, WebSocketServer } from "ws";
import type { ConnectorStatus, UnifiedEvent } from "../domain/unifiedEvent";
import type { Connector } from "../connectors/types";
import {
  createFixtureEvent,
  createInitialFixtureState,
  updateFixtureStatuses
} from "../fixtures/fixtureEvents";
import type { FeedServerMessage } from "../live/protocol";
import { ReplayBuffer } from "../live/replayBuffer";
import { createFeedSessionId, type FeedArchive } from "./feedArchive";

export type LiveFeedRuntimeOptions = {
  port: number;
  bufferSize?: number;
  fixtureIntervalMs?: number;
  fixtureBurstSize?: number;
  mode: "fixture" | "connectors";
  connectors?: Connector[];
  initialEventCount?: number;
  webSocketServer?: WebSocketServerLike;
  archive?: FeedArchive | null;
};

type WebSocketLike = Pick<WebSocket, "readyState" | "send">;

type WebSocketServerLike = {
  clients: Set<WebSocketLike>;
  on(event: "connection", listener: (client: WebSocketLike) => void): void;
  close(callback: (error?: Error) => void): void;
};

export class LiveFeedRuntime {
  private readonly replayBuffer: ReplayBuffer;
  private readonly wss: WebSocketServerLike;
  private readonly fixtureIntervalMs: number;
  private readonly fixtureBurstSize: number;
  private readonly mode: LiveFeedRuntimeOptions["mode"];
  private readonly connectors: Connector[];
  private fixtureInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private statuses: ConnectorStatus[];
  private sequence: number;

  constructor(private readonly options: LiveFeedRuntimeOptions) {
    this.replayBuffer = new ReplayBuffer(options.bufferSize ?? 250);
    this.wss = options.webSocketServer ?? new WebSocketServer({ port: options.port });
    this.fixtureIntervalMs = options.fixtureIntervalMs ?? 1100;
    this.fixtureBurstSize = Math.max(1, Math.floor(options.fixtureBurstSize ?? 1));
    this.mode = options.mode;
    this.connectors = options.connectors ?? [];

    const initialState = createInitialFixtureState(options.initialEventCount ?? 24);
    this.statuses =
      this.mode === "fixture" ? initialState.statuses : this.connectors.map((connector) => connector.status());
    this.sequence = initialState.events.length;

    if (this.mode === "fixture") {
      for (const event of [...initialState.events].reverse()) {
        this.replayBuffer.add(event);
      }
    }
  }

  async start() {
    const startedAt = new Date().toISOString();
    await this.options.archive?.start({
      sessionId: createFeedSessionId(startedAt, this.mode),
      startedAt,
      mode: this.mode,
      bufferSize: this.options.bufferSize ?? 250,
      fixtureIntervalMs: this.fixtureIntervalMs,
      fixtureBurstSize: this.fixtureBurstSize,
      connectorPlatforms: this.connectors.map((connector) => connector.platform)
    });

    for (const event of [...this.replayBuffer.snapshot()].reverse()) {
      this.options.archive?.recordEvent(event);
    }

    for (const status of this.statuses) {
      this.options.archive?.recordStatus(status);
    }

    this.wss.on("connection", (client) => {
      this.send(client, this.snapshotMessage());
    });

    this.heartbeatInterval = setInterval(() => {
      this.broadcast({
        type: "heartbeat",
        generatedAt: new Date().toISOString()
      });
    }, 15000);

    if (this.mode === "fixture") {
      this.fixtureInterval = setInterval(() => {
        for (let burstIndex = 0; burstIndex < this.fixtureBurstSize; burstIndex += 1) {
          const event = createFixtureEvent(this.sequence);
          this.sequence += 1;
          this.broadcastEvent(event);
        }
      }, this.fixtureIntervalMs);
      return;
    }

    for (const connector of this.connectors) {
      connector.subscribe((event) => this.broadcastEvent(event));
      connector.subscribeStatus((status) => this.updateStatus(status));
      await connector.start();
      this.updateStatus(connector.status());
    }
  }

  async stop() {
    if (this.fixtureInterval) {
      clearInterval(this.fixtureInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    await Promise.all(this.connectors.map((connector) => connector.stop()));
    await this.options.archive?.stop(new Date().toISOString());

    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  snapshotMessage(): FeedServerMessage {
    return {
      type: "snapshot",
      events: this.replayBuffer.snapshot(),
      statuses: this.statuses,
      generatedAt: new Date().toISOString()
    };
  }

  broadcastEvent(event: UnifiedEvent) {
    if (!this.replayBuffer.add(event)) {
      return;
    }

    if (this.mode === "fixture") {
      this.statuses = updateFixtureStatuses(this.statuses, event);
    }

    this.options.archive?.recordEvent(event);
    this.broadcast({ type: "event", event });

    for (const status of this.statuses) {
      if (status.platform === event.platform) {
        this.broadcast({ type: "status", status });
        this.options.archive?.recordStatus(status);
        break;
      }
    }
  }

  updateStatus(status: ConnectorStatus) {
    const statusIndex = this.statuses.findIndex((currentStatus) => currentStatus.platform === status.platform);

    if (statusIndex === -1) {
      this.statuses = [...this.statuses, status];
    } else {
      this.statuses = this.statuses.map((currentStatus) =>
        currentStatus.platform === status.platform ? status : currentStatus
      );
    }

    this.broadcast({ type: "status", status });
    this.options.archive?.recordStatus(status);
  }

  private send(client: WebSocketLike, message: FeedServerMessage) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  private broadcast(message: FeedServerMessage) {
    for (const client of this.wss.clients) {
      this.send(client, message);
    }
  }
}
