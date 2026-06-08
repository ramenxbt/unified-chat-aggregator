import { describe, expect, it } from "vitest";
import { buildLiveDoctorReport, formatLiveDoctorReport, type LiveDoctorCheck } from "./liveDoctor";
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
  X_SPACES_QUERY: "Market Bubble",
  FEED_DB_PATH: "data/feed.sqlite"
};

describe("live doctor", () => {
  it("passes when strict connector and local recording checks are ready", async () => {
    const report = await buildLiveDoctorReport(completeEnv, {
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const formatted = formatLiveDoctorReport(report);

    expect(report.ok).toBe(true);
    expect(formatted).toContain("Live doctor: ready");
    expect(formatted).toContain("PASS Connector preflight");
    expect(formatted).toContain("PASS Feed WebSocket port");
    expect(formatted).toContain("PASS Dashboard dev port");
    expect(formatted).toContain("PASS Kick webhook port");
    expect(formatted).toContain("PASS QA evidence directory");
    expect(formatted).toContain("Final run commands:");
  });

  it("fails when connector preflight is missing strict credentials", async () => {
    const report = await buildLiveDoctorReport(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      {
        checkPort: readyPortCheck,
        checkWritableDirectory: readyDirectoryCheck
      }
    );

    expect(report.ok).toBe(false);
    expect(formatLiveDoctorReport(report)).toContain("Live preflight: needs setup");
  });

  it("fails when a required local port is already in use", async () => {
    const report = await buildLiveDoctorReport(completeEnv, {
      checkPort: async (label, port) => ({
        name: label,
        state: label === "Dashboard dev port" ? "setup" : "ready",
        detail: label === "Dashboard dev port" ? `Port ${port} is already in use.` : `Port ${port} is available.`
      }),
      checkWritableDirectory: readyDirectoryCheck
    });

    expect(report.ok).toBe(false);
    expect(formatLiveDoctorReport(report)).toContain("MISS Dashboard dev port: Port 5173 is already in use.");
  });

  it("fails when configured ports conflict with each other", async () => {
    const report = await buildLiveDoctorReport(
      {
        ...completeEnv,
        FEED_SERVER_PORT: "8788",
        KICK_WEBHOOK_PORT: "8788"
      },
      {
        checkPort: readyPortCheck,
        checkWritableDirectory: readyDirectoryCheck
      }
    );

    expect(report.ok).toBe(false);
    expect(formatLiveDoctorReport(report)).toContain("MISS Local port conflict");
  });

  it("fails when the server evidence archive is disabled", async () => {
    const report = await buildLiveDoctorReport(
      {
        ...completeEnv,
        FEED_ARCHIVE_ENABLED: "false"
      },
      {
        checkPort: readyPortCheck,
        checkWritableDirectory: readyDirectoryCheck
      }
    );

    expect(report.ok).toBe(false);
    expect(formatLiveDoctorReport(report)).toContain("FEED_ARCHIVE_ENABLED=false disables the JSONL evidence archive");
  });

  it("fails when the QA evidence directory is not writable", async () => {
    const report = await buildLiveDoctorReport(completeEnv, {
      qaDir: "locked-qa",
      checkPort: readyPortCheck,
      checkWritableDirectory: async (label, directoryPath) => ({
        name: label,
        state: label === "QA evidence directory" ? "setup" : "ready",
        detail: label === "QA evidence directory" ? `${directoryPath} is not writable.` : `${directoryPath} is writable.`
      })
    });

    expect(report.ok).toBe(false);
    expect(formatLiveDoctorReport(report)).toContain("MISS QA evidence directory: locked-qa is not writable.");
  });
});

async function readyPortCheck(label: string, port: number): Promise<LiveDoctorCheck> {
  return {
    name: label,
    state: "ready",
    detail: `Port ${port} is available.`
  };
}

async function readyDirectoryCheck(label: string, directoryPath: string): Promise<LiveDoctorCheck> {
  return {
    name: label,
    state: "ready",
    detail: `${directoryPath} is writable.`
  };
}
