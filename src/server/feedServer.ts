import { TwitchEventSubConnector } from "../connectors/twitch/twitchEventSubConnector";
import type { Connector } from "../connectors/types";
import { LiveFeedRuntime } from "./liveFeedRuntime";

const port = Number(process.env.FEED_SERVER_PORT ?? 8787);
const bufferSize = Number(process.env.FEED_REPLAY_BUFFER_SIZE ?? 250);
const fixtureIntervalMs = Number(process.env.FEED_FIXTURE_INTERVAL_MS ?? 1100);

const connectors = buildConnectorsFromEnv();
const mode = connectors.length > 0 ? "connectors" : "fixture";
const runtime = new LiveFeedRuntime({
  port,
  bufferSize,
  fixtureIntervalMs,
  mode,
  connectors
});

await runtime.start();

console.log(`Feed server listening on ws://127.0.0.1:${port}`);
console.log(`Feed server mode: ${mode}`);

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  await runtime.stop();
  process.exit(0);
}

function buildConnectorsFromEnv(): Connector[] {
  const twitchConnector = buildTwitchConnectorFromEnv();

  return twitchConnector ? [twitchConnector] : [];
}

function buildTwitchConnectorFromEnv() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const accessToken = process.env.TWITCH_ACCESS_TOKEN;
  const broadcasterUserId = process.env.TWITCH_BROADCASTER_USER_ID;
  const botUserId = process.env.TWITCH_BOT_USER_ID;

  if (!clientId || !accessToken || !broadcasterUserId || !botUserId) {
    return null;
  }

  return new TwitchEventSubConnector({
    clientId,
    accessToken,
    broadcasterUserId,
    botUserId,
    broadcasterLogin: process.env.TWITCH_BROADCASTER_LOGIN,
    endpoint: process.env.TWITCH_EVENTSUB_ENDPOINT,
    subscriptionEndpoint: process.env.TWITCH_EVENTSUB_SUBSCRIPTION_ENDPOINT
  });
}
