import { WebSocket, WebSocketServer } from "ws";
import { type UnifiedEvent } from "../domain/unifiedEvent";
import {
  createFixtureEvent,
  createInitialFixtureState,
  updateFixtureStatuses
} from "../fixtures/fixtureEvents";
import { type FeedServerMessage } from "../live/protocol";
import { ReplayBuffer } from "../live/replayBuffer";

const port = Number(process.env.FEED_SERVER_PORT ?? 8787);
const bufferSize = Number(process.env.FEED_REPLAY_BUFFER_SIZE ?? 250);
const fixtureIntervalMs = Number(process.env.FEED_FIXTURE_INTERVAL_MS ?? 1100);

const wss = new WebSocketServer({ port });
const replayBuffer = new ReplayBuffer(bufferSize);
let { events, statuses } = createInitialFixtureState(24);
let sequence = events.length;

for (const event of [...events].reverse()) {
  replayBuffer.add(event);
}

function send(client: WebSocket, message: FeedServerMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function broadcast(message: FeedServerMessage) {
  for (const client of wss.clients) {
    send(client, message);
  }
}

function broadcastEvent(event: UnifiedEvent) {
  if (!replayBuffer.add(event)) {
    return;
  }

  events = replayBuffer.snapshot();
  statuses = updateFixtureStatuses(statuses, event);
  broadcast({ type: "event", event });

  for (const status of statuses) {
    if (status.platform === event.platform) {
      broadcast({ type: "status", status });
      break;
    }
  }
}

function snapshotMessage(): FeedServerMessage {
  return {
    type: "snapshot",
    events: replayBuffer.snapshot(),
    statuses,
    generatedAt: new Date().toISOString()
  };
}

wss.on("connection", (client) => {
  send(client, snapshotMessage());
});

setInterval(() => {
  const event = createFixtureEvent(sequence);
  sequence += 1;
  broadcastEvent(event);
}, fixtureIntervalMs);

setInterval(() => {
  broadcast({
    type: "heartbeat",
    generatedAt: new Date().toISOString()
  });
}, 15000);

console.log(`Feed server listening on ws://127.0.0.1:${port}`);
