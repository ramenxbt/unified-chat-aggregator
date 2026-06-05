import { describe, expect, it } from "vitest";
import { buildLiveRunPlan, formatLiveRunPlan } from "./liveRunPlan";
import type { LivePreflightEnv } from "./livePreflight";

const completeEnv: LivePreflightEnv = {
  TWITCH_CLIENT_ID: "tw-client",
  TWITCH_ACCESS_TOKEN: "tw-token",
  TWITCH_BROADCASTER_USER_ID: "1337",
  TWITCH_BOT_USER_ID: "9001",
  TWITCH_BROADCASTER_LOGIN: "marketbubble",
  KICK_WEBHOOK_ENABLED: "true",
  KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick",
  KICK_ACCESS_TOKEN: "kick-token",
  KICK_BROADCASTER_USER_ID: "123456789",
  KICK_BROADCASTER_SLUG: "marketbubble",
  KICK_SUBSCRIBE_ON_START: "true",
  X_BEARER_TOKEN: "x-token",
  X_FILTER_RULES: "from:marketbubble, market bubble",
  X_SPACES_QUERY: "Market Bubble"
};

describe("live run plan", () => {
  it("prints final commands, OBS URLs, and evidence paths for a ready environment", () => {
    const plan = buildLiveRunPlan(completeEnv, {
      appPort: 5173,
      feedPort: 8787,
      archiveDir: "data/feed-sessions",
      databasePath: "data/feed.sqlite"
    });
    const formatted = formatLiveRunPlan(plan);

    expect(plan.ok).toBe(true);
    expect(formatted).toContain("Live preflight: ready");
    expect(formatted).toContain("FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed");
    expect(formatted).toContain("VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev");
    expect(formatted).toContain("http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14");
    expect(formatted).toContain("database: data/feed.sqlite");
    expect(formatted).toContain(
      "live proof gate: npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000"
    );
    expect(formatted).toContain(
      "evidence check: npm run evidence:check -- --archive data/feed-sessions/<session-id> --db data/feed.sqlite"
    );
    expect(formatted).toContain(
      "submission bundle: npm run submission:bundle -- --archive data/feed-sessions/<session-id> --db data/feed.sqlite --out submission-bundle"
    );
  });

  it("surfaces missing strict requirements while still printing setup commands", () => {
    const plan = buildLiveRunPlan({});
    const formatted = formatLiveRunPlan(plan);

    expect(plan.ok).toBe(false);
    expect(formatted).toContain("Live preflight: needs setup");
    expect(formatted).toContain("missing: TWITCH_CLIENT_ID");
    expect(formatted).toContain("Final run commands:");
    expect(formatted).toContain("public URL: not configured");
  });

  it("supports one-platform dry run planning", () => {
    const plan = buildLiveRunPlan(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      {
        allowPartial: true
      }
    );

    expect(plan.ok).toBe(true);
    expect(plan.report.requireAllPlatforms).toBe(false);
  });
});
