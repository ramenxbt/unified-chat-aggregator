import { describe, expect, it } from "vitest";
import { evaluateLivePreflight, formatLivePreflightReport, type LivePreflightEnv } from "./livePreflight";

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

describe("live preflight", () => {
  it("reports fixture mode when live connector env is missing", () => {
    const report = evaluateLivePreflight({});

    expect(report).toMatchObject({
      ok: false,
      mode: "fixture"
    });
    expect(report.checks.every((check) => check.ready)).toBe(false);
    expect(formatLivePreflightReport(report)).toContain("missing: TWITCH_CLIENT_ID");
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

  it("allows a partial live connector run when requested", () => {
    const report = evaluateLivePreflight(
      {
        X_BEARER_TOKEN: "x-token",
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
