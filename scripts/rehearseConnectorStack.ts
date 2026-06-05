import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { WebSocket, WebSocketServer } from "ws";
import { buildEvidenceReport } from "../src/server/evidenceReport";
import { findLatestArchivePath } from "../src/server/feedArchiveLookup";
import type { FeedServerMessage } from "../src/live/protocol";

const feedPort = 8799;
const kickPort = 8800;
const runId = Date.now();
const eventTimestamp = new Date().toISOString();
const archiveDir = path.resolve("qa/connectors", `feed-sessions-${runId}`);
const databasePath = path.resolve("qa/connectors", `feed-${runId}.sqlite`);
const feedWsUrl = `ws://127.0.0.1:${feedPort}`;
const expectedPlatforms = new Set(["twitch", "kick", "x"]);

async function main() {
  await mkdir(archiveDir, { recursive: true });

  const platformApi = await startPlatformApi();
  const twitchEventSub = await startTwitchEventSub();
  const feedServer = startProcess(localBin("tsx"), ["src/server/feedServer.ts"], {
    FEED_SERVER_PORT: String(feedPort),
    FEED_REPLAY_BUFFER_SIZE: "250",
    FEED_INITIAL_EVENT_COUNT: "0",
    FEED_ARCHIVE_DIR: archiveDir,
    FEED_DB_PATH: databasePath,
    TWITCH_CLIENT_ID: "tw-client",
    TWITCH_ACCESS_TOKEN: "tw-token",
    TWITCH_BROADCASTER_USER_ID: "1337",
    TWITCH_BOT_USER_ID: "9001",
    TWITCH_BROADCASTER_LOGIN: "marketbubble",
    TWITCH_EVENTSUB_ENDPOINT: twitchEventSub.url,
    TWITCH_EVENTSUB_SUBSCRIPTION_ENDPOINT: `${platformApi.url}/twitch/subscriptions`,
    KICK_WEBHOOK_ENABLED: "true",
    KICK_VERIFY_SIGNATURE: "false",
    KICK_WEBHOOK_PORT: String(kickPort),
    KICK_BROADCASTER_SLUG: "marketbubble",
    X_BEARER_TOKEN: "x-token",
    X_FILTER_RULES: "Market Bubble",
    X_SPACES_QUERY: "Market Bubble",
    X_FILTERED_STREAM_ENDPOINT: `${platformApi.url}/x/stream`,
    X_RULES_ENDPOINT: `${platformApi.url}/x/rules`,
    X_SPACES_SEARCH_ENDPOINT: `${platformApi.url}/x/spaces`,
    X_SPACES_POLL_MS: "60000"
  });

  try {
    const seenPlatforms = await waitForConnectorEvents();

    if (seenPlatforms.size !== expectedPlatforms.size) {
      throw new Error(`Expected Twitch, Kick, and X connector events, got ${[...seenPlatforms].join(", ")}`);
    }
  } finally {
    await stopProcess(feedServer);
    twitchEventSub.close();
    await platformApi.close();
  }

  const archivePath = await findLatestArchivePath(archiveDir);
  const report = await buildEvidenceReport({
    archivePath,
    databasePath
  });

  if (!report.ok) {
    throw new Error(`Connector rehearsal evidence failed: ${report.issues.join("; ")}`);
  }

  console.log(
    [
      "Connector rehearsal passed",
      `Archive: ${archivePath}`,
      `Database: ${databasePath}`,
      `Events: ${report.eventCount}`,
      `Source labels: ${report.sourceLabels.join(", ")}`,
      `P95 latency: ${report.performance.p95LatencyMs.toFixed(0)}ms`
    ].join("\n")
  );
}

async function startPlatformApi() {
  const streamResponses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "POST" && requestUrl.pathname === "/twitch/subscriptions") {
      response.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [] }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/x/rules") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [] }));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/x/rules") {
      response
        .writeHead(201, { "Content-Type": "application/json" })
        .end(JSON.stringify({ meta: { sent: eventTimestamp } }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/x/stream") {
      streamResponses.add(response);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(`${JSON.stringify(xPostPayload())}\n`);
      response.on("close", () => {
        streamResponses.delete(response);
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/x/spaces") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(xSpacesPayload()));
      return;
    }

    response.writeHead(404).end();
  });

  await listen(server, 0);
  const port = getServerPort(server);

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const response of streamResponses) {
        response.end();
      }
      await closeServer(server);
    }
  };
}

async function startTwitchEventSub() {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  server.on("connection", (socket) => {
    socket.send(JSON.stringify(twitchWelcomeMessage()));
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(twitchNotificationMessage()));
      }
    }, 150);
  });

  const port = getServerPort(server);

  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => server.close()
  };
}

async function waitForConnectorEvents() {
  const socket = await connectFeedSocket();
  const seenPlatforms = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out waiting for connector events. Saw ${[...seenPlatforms].join(", ") || "none"}`));
    }, 15_000);

    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as FeedServerMessage;

      if (message.type === "snapshot") {
        for (const event of message.events) {
          seenPlatforms.add(event.platform);
        }
      }

      if (message.type === "event") {
        seenPlatforms.add(message.event.platform);
      }

      if (seenPlatforms.has("kick") && seenPlatforms.has("twitch") && seenPlatforms.has("x")) {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    void postKickWebhook().catch((error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return seenPlatforms;
}

async function postKickWebhook() {
  const deadline = Date.now() + 10_000;
  const payload = kickChatPayload();

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${kickPort}/webhooks/kick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Kick-Event-Message-Id": "kick-rehearsal-event-1",
          "Kick-Event-Subscription-Id": "kick-rehearsal-subscription",
          "Kick-Event-Signature": "unsigned-local-rehearsal",
          "Kick-Event-Message-Timestamp": eventTimestamp,
          "Kick-Event-Type": "chat.message.sent",
          "Kick-Event-Version": "1"
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 204) return;
    } catch {
      await delay(100);
    }
  }

  throw new Error("Timed out posting Kick connector rehearsal webhook");
}

async function connectFeedSocket() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      return await openSocket(feedWsUrl);
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for ${feedWsUrl}`);
}

function openSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`socket timeout for ${url}`));
    }, 1000);

    socket.once("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function twitchWelcomeMessage() {
  return {
    metadata: {
      message_id: "welcome-1",
      message_type: "session_welcome",
      message_timestamp: eventTimestamp
    },
    payload: {
      session: {
        id: "session-1",
        status: "connected",
        connected_at: eventTimestamp
      }
    }
  };
}

function twitchNotificationMessage() {
  return {
    metadata: {
      message_id: "eventsub-message-1",
      message_type: "notification",
      message_timestamp: eventTimestamp,
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
        message_id: "twitch-rehearsal-message-1",
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
            id: "Mod",
            info: ""
          }
        ]
      }
    }
  };
}

function kickChatPayload() {
  return {
    message_id: "kick-rehearsal-message-1",
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
    content: "HYPE just different",
    emotes: [],
    created_at: eventTimestamp
  };
}

function xPostPayload() {
  return {
    data: {
      id: "x-rehearsal-post-1",
      text: "Market Bubble stream is live",
      author_id: "user-1",
      created_at: eventTimestamp,
      conversation_id: "thread-1"
    },
    includes: {
      users: [
        {
          id: "user-1",
          username: "marketbubble",
          name: "Market Bubble",
          profile_image_url: "https://example.test/avatar.jpg",
          verified: true
        }
      ]
    },
    matching_rules: [{ id: "rule-1", tag: "market" }]
  };
}

function xSpacesPayload() {
  return {
    data: [
      {
        id: "space-1",
        state: "live",
        title: "Market Bubble Live",
        creator_id: "creator-1",
        participant_count: 420,
        started_at: eventTimestamp,
        updated_at: eventTimestamp
      }
    ],
    includes: {
      users: [
        {
          id: "creator-1",
          username: "marketbubble",
          name: "Market Bubble",
          verified: true
        }
      ]
    }
  };
}

function startProcess(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      ...env
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  return child;
}

function localBin(command: string) {
  return path.resolve("node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.killed || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, 5000);

    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getServerPort(server: Server | WebSocketServer) {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port");
  }

  return address.port;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
