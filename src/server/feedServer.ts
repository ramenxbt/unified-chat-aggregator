import { KickWebhookConnector, kickDefaultPublicKey } from "../connectors/kick/kickWebhookConnector";
import { TwitchEventSubConnector } from "../connectors/twitch/twitchEventSubConnector";
import type { Connector } from "../connectors/types";
import { XApiConnector } from "../connectors/x/xApiConnector";
import { createFeedArchiveFromEnv } from "./feedArchive";
import { LiveFeedRuntime } from "./liveFeedRuntime";

const port = Number(process.env.FEED_SERVER_PORT ?? 8787);
const bufferSize = Number(process.env.FEED_REPLAY_BUFFER_SIZE ?? 250);
const fixtureIntervalMs = Number(process.env.FEED_FIXTURE_INTERVAL_MS ?? 1100);

const connectors = buildConnectorsFromEnv();
const mode = connectors.length > 0 ? "connectors" : "fixture";
const archive = createFeedArchiveFromEnv();
const runtime = new LiveFeedRuntime({
  port,
  bufferSize,
  fixtureIntervalMs,
  mode,
  connectors,
  archive
});

await runtime.start();

console.log(`Feed server listening on ws://127.0.0.1:${port}`);
console.log(`Feed server mode: ${mode}`);
if (archive?.sessionPath) {
  console.log(`Feed archive: ${archive.sessionPath}`);
}

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
  const kickConnector = buildKickConnectorFromEnv();
  const twitchConnector = buildTwitchConnectorFromEnv();
  const xConnector = buildXConnectorFromEnv();
  const connectors: Connector[] = [];

  if (kickConnector) connectors.push(kickConnector);
  if (twitchConnector) connectors.push(twitchConnector);
  if (xConnector) connectors.push(xConnector);

  return connectors;
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

function buildKickConnectorFromEnv() {
  if (process.env.KICK_WEBHOOK_ENABLED !== "true" && !process.env.KICK_WEBHOOK_PUBLIC_URL) {
    return null;
  }

  return new KickWebhookConnector({
    port: Number(process.env.KICK_WEBHOOK_PORT ?? 8788),
    path: process.env.KICK_WEBHOOK_PATH,
    publicKey: process.env.KICK_WEBHOOK_PUBLIC_KEY ?? kickDefaultPublicKey,
    verifySignatures: process.env.KICK_VERIFY_SIGNATURE !== "false",
    sourceName: process.env.KICK_BROADCASTER_SLUG ?? process.env.KICK_BROADCASTER_USER_ID,
    accessToken: process.env.KICK_ACCESS_TOKEN,
    broadcasterUserId: process.env.KICK_BROADCASTER_USER_ID ? Number(process.env.KICK_BROADCASTER_USER_ID) : undefined,
    subscribeOnStart: process.env.KICK_SUBSCRIBE_ON_START === "true",
    subscriptionEndpoint: process.env.KICK_EVENT_SUBSCRIPTION_ENDPOINT
  });
}

function buildXConnectorFromEnv() {
  const bearerToken = process.env.X_BEARER_TOKEN;
  const filterRules = parseEnvList(process.env.X_FILTER_RULES);
  const spacesQuery = process.env.X_SPACES_QUERY;

  if (!bearerToken || (filterRules.length === 0 && !spacesQuery)) {
    return null;
  }

  return new XApiConnector({
    bearerToken,
    filterRules,
    spacesQuery,
    filteredStreamEndpoint: process.env.X_FILTERED_STREAM_ENDPOINT,
    rulesEndpoint: process.env.X_RULES_ENDPOINT,
    spacesSearchEndpoint: process.env.X_SPACES_SEARCH_ENDPOINT,
    spacesPollMs: process.env.X_SPACES_POLL_MS ? Number(process.env.X_SPACES_POLL_MS) : undefined
  });
}

function parseEnvList(value: string | undefined) {
  return (
    value
      ?.split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}
