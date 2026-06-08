import { describe, expect, it, vi } from "vitest";
import { buildLiveStackLaunchPlan, runLiveStack } from "./runLiveStack";
import type { LiveDoctorCheck } from "./liveDoctor";
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

describe("live stack runner", () => {
  it("builds feed and dashboard launch commands from the checked live plan", async () => {
    const plan = await buildLiveStackLaunchPlan(completeEnv, {
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });

    expect(plan.ok).toBe(true);
    expect(plan.processes.feed).toMatchObject({
      command: "npm",
      args: ["run", "feed"],
      env: {
        FEED_SERVER_PORT: "8787",
        FEED_DB_PATH: "data/feed.sqlite",
        FEED_ARCHIVE_DIR: "data/feed-sessions"
      }
    });
    expect(plan.processes.dashboard).toMatchObject({
      command: "npm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
      env: {
        VITE_FEED_WS_URL: "ws://127.0.0.1:8787"
      }
    });
    expect(plan.processes.proofGate).toMatchObject({
      command: "npm",
      args: [
        "run",
        "proof:gate",
        "--",
        "--archive-dir",
        "data/feed-sessions",
        "--watch",
        "--min-events",
        "25",
        "--min-source-labels",
        "3",
        "--max-p95-latency-ms",
        "5000"
      ],
      env: {}
    });
  });

  it("carries custom planned ports into spawned process settings", async () => {
    const plan = await buildLiveStackLaunchPlan(completeEnv, {
      appPort: 5260,
      feedPort: 8899,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });

    expect(plan.processes.feed.env.FEED_SERVER_PORT).toBe("8899");
    expect(plan.processes.dashboard.args).toEqual(["run", "dev", "--", "--host", "127.0.0.1", "--port", "5260"]);
    expect(plan.processes.dashboard.env.VITE_FEED_WS_URL).toBe("ws://127.0.0.1:8899");
  });

  it("dry-runs without spawning long-lived processes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });

    expect(exitCode).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("Live stack dry run: ready");

    log.mockRestore();
  });

  it("can include the proof gate in the dry-run launch plan", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      withProofGate: true,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const output = log.mock.calls.flat().join("\n");

    expect(exitCode).toBe(0);
    expect(output).toContain("proof gate: npm run proof:gate -- --archive-dir data/feed-sessions --watch");

    log.mockRestore();
  });

  it("refuses to launch when the doctor report is not ready", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exitCode = await runLiveStack(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      {
        dryRun: true,
        checkPort: readyPortCheck,
        checkWritableDirectory: readyDirectoryCheck
      }
    );

    expect(exitCode).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain("Live doctor: needs setup");

    log.mockRestore();
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
