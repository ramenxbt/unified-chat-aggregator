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
    expect(formatted).toContain(
      "FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed"
    );
    expect(formatted).toContain(
      "VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173"
    );
    expect(plan.targetSourceLabels).toEqual(["KICK (MARKETBUBBLE)", "TWITCH (MARKETBUBBLE)", "X (@MARKETBUBBLE)"]);
    expect(formatted).toContain("Target source labels:");
    expect(formatted).toContain("KICK (MARKETBUBBLE)");
    expect(formatted).toContain("TWITCH (MARKETBUBBLE)");
    expect(formatted).toContain("X (@MARKETBUBBLE)");
    expect(formatted).toContain("http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14");
    expect(formatted).toContain("tunnel health check: npm run live:tunnel");
    expect(plan.obs).toMatchObject({
      sourceType: "Browser Source",
      width: 1280,
      height: 720,
      fps: 30,
      background: "transparent"
    });
    expect(formatted).toContain("OBS browser source settings:");
    expect(formatted).toContain("source type: Browser Source");
    expect(formatted).toContain("size: 1280x720");
    expect(formatted).toContain("custom CSS: body { background: rgba(0, 0, 0, 0); overflow: hidden; }");
    expect(formatted).toContain("OBS handoff files: npm run obs:handoff -- --app-port 5173 --out qa/obs");
    expect(formatted).toContain("database: data/feed.sqlite");
    expect(formatted).toContain(
      "live proof gate: npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000"
    );
    expect(formatted).toContain(
      "evidence check: npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite"
    );
    expect(formatted).toContain(
      "submission bundle: npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json"
    );
  });

  it("uses configured proof gate thresholds in final run commands", () => {
    const plan = buildLiveRunPlan(
      {
        ...completeEnv,
        PROOF_MIN_EVENTS: "100",
        PROOF_MIN_SOURCE_LABELS: "5",
        PROOF_MAX_P95_LATENCY_MS: "2500",
        PROOF_TIMEOUT_MS: "300000",
        PROOF_INTERVAL_MS: "2000"
      },
      {
        archiveDir: "data/final sessions",
        databasePath: "data/final proof.sqlite"
      }
    );
    const formatted = formatLiveRunPlan(plan);

    expect(plan.proofGate).toEqual({
      minEvents: 100,
      minSourceLabels: 5,
      maxP95LatencyMs: 2500,
      timeoutMs: 300000,
      intervalMs: 2000
    });
    expect(formatted).toContain(
      "live proof gate: npm run proof:gate -- --archive-dir 'data/final sessions' --watch --min-events 100 --min-source-labels 5 --max-p95-latency-ms 2500 --timeout-ms 300000 --interval-ms 2000"
    );
    expect(formatted).toContain(
      "evidence check: npm run evidence:check -- --archive-dir 'data/final sessions' --db 'data/final proof.sqlite'"
    );
    expect(formatted).toContain(
      "submission bundle: npm run submission:bundle -- --archive-dir 'data/final sessions' --db 'data/final proof.sqlite' --out submission-bundle --clips clip-queue.json"
    );
  });

  it("uses a configured clip queue export path in the bundle command", () => {
    const plan = buildLiveRunPlan(completeEnv, {
      clipQueuePath: "exports/final clips.json"
    });

    expect(plan.evidence.submissionBundleCommand).toContain("--clips 'exports/final clips.json'");
  });

  it("surfaces missing strict requirements while still printing setup commands", () => {
    const plan = buildLiveRunPlan({});
    const formatted = formatLiveRunPlan(plan);

    expect(plan.ok).toBe(false);
    expect(formatted).toContain("Live preflight: needs setup");
    expect(formatted).toContain("missing: TWITCH_CLIENT_ID");
    expect(formatted).toContain("Final run commands:");
    expect(formatted).toContain("Target source labels:");
    expect(formatted).toContain("not configured");
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
    expect(plan.evidence.proofGateCommand).toContain("--allow-partial");
    expect(plan.evidence.evidenceCheckCommand).toContain("--allow-partial");
    expect(plan.evidence.submissionBundleCommand).toContain("--allow-partial");
  });

  it("falls back when proof timing overrides are invalid", () => {
    const plan = buildLiveRunPlan(
      {
        ...completeEnv,
        PROOF_TIMEOUT_MS: "300000",
        PROOF_INTERVAL_MS: "2000"
      },
      {
        proofTimeoutMs: Number.NaN,
        proofIntervalMs: -1
      }
    );

    expect(plan.proofGate.timeoutMs).toBe(300000);
    expect(plan.proofGate.intervalMs).toBe(2000);
    expect(plan.evidence.proofGateCommand).not.toContain("NaN");
  });
});
