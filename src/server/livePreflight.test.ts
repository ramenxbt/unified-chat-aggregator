import { describe, expect, it } from "vitest";
import { evaluateLivePreflight, formatLivePreflightReport, type LivePreflightEnv } from "./livePreflight";

const completeEnv: LivePreflightEnv = {
  TWITCH_CLIENT_ID: "twitch-client-live-123",
  TWITCH_ACCESS_TOKEN: "twitch-access-live-123",
  TWITCH_BROADCASTER_USER_ID: "1337",
  TWITCH_BOT_USER_ID: "9001",
  TWITCH_BROADCASTER_LOGIN: "marketbubble",
  KICK_WEBHOOK_ENABLED: "true",
  KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick",
  KICK_ACCESS_TOKEN: "kick-access-live-123",
  KICK_BROADCASTER_USER_ID: "123456789",
  KICK_BROADCASTER_SLUG: "marketbubble",
  KICK_SUBSCRIBE_ON_START: "true",
  X_BEARER_TOKEN: "x-bearer-live-123",
  X_FILTER_RULES: "from:marketbubble, market bubble",
  X_SPACES_QUERY: "Market Bubble"
};

describe("live preflight", () => {
  it("reports fixture mode when live connector env is missing", () => {
    const report = evaluateLivePreflight({});

    expect(report).toMatchObject({
      ok: false,
      mode: "fixture"
    });
    expect(report.checks.every((check) => check.ready)).toBe(false);
    expect(formatLivePreflightReport(report)).toContain("missing: TWITCH_CLIENT_ID");
    expect(formatLivePreflightReport(report)).toContain("Stream-day .env checklist:");
    expect(formatLivePreflightReport(report)).toContain("TWITCH_CLIENT_ID=");
    expect(formatLivePreflightReport(report)).toContain("TWITCH_BROADCASTER_LOGIN=marketbubble");
    expect(formatLivePreflightReport(report)).toContain("KICK_WEBHOOK_PUBLIC_URL=https://YOUR-TUNNEL.example/webhooks/kick");
    expect(formatLivePreflightReport(report)).toContain("KICK_BROADCASTER_SLUG=marketbubble");
  });

  it("passes when Twitch, Kick, and X are ready", () => {
    const report = evaluateLivePreflight(completeEnv);

    expect(report).toMatchObject({
      ok: true,
      mode: "connectors"
    });
    expect(report.checks.map((check) => [check.platform, check.ready])).toEqual([
      ["twitch", true],
      ["kick", true],
      ["x", true]
    ]);
  });

  it("rejects placeholder credentials before final readiness", () => {
    const report = evaluateLivePreflight({
      ...completeEnv,
      TWITCH_CLIENT_ID: "tw-client",
      TWITCH_ACCESS_TOKEN: "tw-token",
      KICK_ACCESS_TOKEN: "kick-token",
      X_BEARER_TOKEN: "x-token"
    });
    const formatted = formatLivePreflightReport(report);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.platform === "twitch")).toMatchObject({
      ready: false,
      missing: ["TWITCH_CLIENT_ID (replace placeholder)", "TWITCH_ACCESS_TOKEN (replace placeholder)"]
    });
    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: false,
      missing: ["KICK_ACCESS_TOKEN (replace placeholder)"]
    });
    expect(report.checks.find((check) => check.platform === "x")).toMatchObject({
      ready: false,
      missing: ["X_BEARER_TOKEN (replace placeholder)"]
    });
    expect(formatted).toContain("TWITCH_ACCESS_TOKEN=");
    expect(formatted).toContain("KICK_ACCESS_TOKEN=");
    expect(formatted).toContain("X_BEARER_TOKEN=");
  });

  it("rejects the placeholder Kick tunnel URL", () => {
    const report = evaluateLivePreflight({
      ...completeEnv,
      KICK_WEBHOOK_PUBLIC_URL: "https://YOUR-TUNNEL.example/webhooks/kick"
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: false,
      missing: ["real KICK_WEBHOOK_PUBLIC_URL"]
    });
  });

  it("allows a partial live connector run when requested", () => {
    const report = evaluateLivePreflight(
      {
        X_BEARER_TOKEN: "x-bearer-live-123",
        X_SPACES_QUERY: "Market Bubble"
      },
      {
        requireAllPlatforms: false
      }
    );

    expect(report).toMatchObject({
      ok: true,
      mode: "connectors",
      requireAllPlatforms: false
    });
    expect(report.checks.find((check) => check.platform === "x")).toMatchObject({
      ready: true,
      willStart: true
    });
  });

  it("warns when Kick can start locally but has no public delivery URL", () => {
    const report = evaluateLivePreflight(
      {
        KICK_WEBHOOK_ENABLED: "true",
        KICK_WEBHOOK_PORT: "8788"
      },
      {
        requireAllPlatforms: false
      }
    );

    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: true,
      willStart: true,
      warnings: ["expose http://127.0.0.1:8788/webhooks/kick through a public tunnel for Kick delivery"]
    });
  });

  it("requires a public Kick delivery URL for strict final readiness", () => {
    const report = evaluateLivePreflight({
      ...completeEnv,
      KICK_WEBHOOK_PUBLIC_URL: undefined
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: false,
      willStart: true,
      missing: ["KICK_WEBHOOK_PUBLIC_URL"]
    });
    expect(formatLivePreflightReport(report)).toContain(
      "KICK_WEBHOOK_PUBLIC_URL=https://YOUR-TUNNEL.example/webhooks/kick"
    );
  });

  it("fails Kick readiness when the public webhook URL is not an HTTPS tunnel URL", () => {
    const report = evaluateLivePreflight(
      {
        KICK_WEBHOOK_PUBLIC_URL: "http://127.0.0.1:8788/webhooks/kick"
      },
      {
        requireAllPlatforms: false
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: false,
      willStart: true,
      missing: ["HTTPS KICK_WEBHOOK_PUBLIC_URL"]
    });
  });

  it("fails Kick readiness when the public webhook URL does not point at the configured receiver path", () => {
    const report = evaluateLivePreflight(
      {
        KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/wrong",
        KICK_WEBHOOK_PATH: "/webhooks/kick"
      },
      {
        requireAllPlatforms: false
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.platform === "kick")).toMatchObject({
      ready: false,
      willStart: true,
      missing: ["KICK_WEBHOOK_PUBLIC_URL ending in /webhooks/kick"]
    });
  });
});
