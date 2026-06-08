import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const defaultProofGateCommand =
  "npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 120000 --interval-ms 1000";
const defaultFeedCommand = "FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed";
const defaultDashboardCommand = "VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173";

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
        "5000",
        "--timeout-ms",
        "120000",
        "--interval-ms",
        "1000"
      ],
      env: {}
    });
  });

  it("carries custom planned ports into spawned process settings", async () => {
    const plan = await buildLiveStackLaunchPlan(completeEnv, {
      appPort: 5260,
      feedPort: 8899,
      archiveDir: "data/final sessions",
      databasePath: "data/final proof.sqlite",
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });

    expect(plan.processes.feed.env.FEED_SERVER_PORT).toBe("8899");
    expect(plan.processes.feed.env.FEED_ARCHIVE_DIR).toBe("data/final sessions");
    expect(plan.processes.feed.env.FEED_DB_PATH).toBe("data/final proof.sqlite");
    expect(plan.processes.dashboard.args).toEqual(["run", "dev", "--", "--host", "127.0.0.1", "--port", "5260"]);
    expect(plan.processes.dashboard.env.VITE_FEED_WS_URL).toBe("ws://127.0.0.1:8899");
    expect(plan.processes.proofGate.args).toContain("data/final sessions");
    expect(plan.processes.proofGate.args).toContain("120000");
    expect(plan.processes.proofGate.args).toContain("1000");
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

  it("requires final readiness before launching when requested", async () => {
    const qaDir = await createReadyQaDir();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      requireReady: true,
      withProofGate: true,
      qaDir,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const output = log.mock.calls.flat().join("\n");

    expect(exitCode).toBe(0);
    expect(output).toContain("Final recording readiness: ready");
    expect(output).toContain("Live stack dry run: ready");

    log.mockRestore();
  });

  it("refuses require-ready capture without the proof gate", async () => {
    const qaDir = await createReadyQaDir();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      requireReady: true,
      qaDir,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const output = log.mock.calls.flat().join("\n");

    expect(exitCode).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("Final capture requires --with-proof-gate");
    expect(output).not.toContain("Final recording readiness:");
    expect(output).not.toContain("Live stack dry run: ready");

    log.mockRestore();
    error.mockRestore();
  });

  it("passes custom visual QA directory into required final readiness", async () => {
    const qaDir = await createReadyQaDir({ withDefaultVisualQa: false });
    const visualQaDir = path.join(qaDir, "custom visual");
    await writeVisualQaManifest(visualQaDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      requireReady: true,
      withProofGate: true,
      qaDir,
      visualQaDir,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const output = log.mock.calls.flat().join("\n");

    expect(exitCode).toBe(0);
    expect(output).toContain("PASS Visual QA manifest");
    expect(output).toContain("Live stack dry run: ready");

    log.mockRestore();
  });

  it("refuses to launch when final readiness is required but artifacts are missing", async () => {
    const qaDir = await mkdtemp(path.join(os.tmpdir(), "live-stack-missing-ready-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runLiveStack(completeEnv, {
      dryRun: true,
      requireReady: true,
      withProofGate: true,
      qaDir,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });
    const output = log.mock.calls.flat().join("\n");

    expect(exitCode).toBe(1);
    expect(output).toContain("Final recording readiness: needs setup");
    expect(output).not.toContain("Live stack dry run: ready");

    log.mockRestore();
  });

  it("passes partial mode through to the proof gate launch plan", async () => {
    const plan = await buildLiveStackLaunchPlan(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      {
        allowPartial: true,
        checkPort: readyPortCheck,
        checkWritableDirectory: readyDirectoryCheck
      }
    );

    expect(plan.ok).toBe(true);
    expect(plan.processes.proofGate.args).toContain("--allow-partial");
  });

  it("keeps the feed and dashboard running when the proof gate exits non-zero", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const children: FakeChildProcess[] = [];
    const spawnProcess = vi.fn((command: string, args: string[]) => {
      const child = new FakeChildProcess(command, args);
      children.push(child);
      return child;
    });
    const runPromise = runLiveStack(completeEnv, {
      withProofGate: true,
      spawnProcess: spawnProcess as never,
      checkPort: readyPortCheck,
      checkWritableDirectory: readyDirectoryCheck
    });

    await waitFor(() => children.length === 3);
    expect(children).toHaveLength(3);

    children[2].emitExit(1);
    await Promise.resolve();

    expect(children[0].killed).toBe(false);
    expect(children[1].killed).toBe(false);
    expect(stderr.mock.calls.flat().join("\n")).toContain("Feed and dashboard remain running for capture.");

    children[0].emitExit(0);
    expect(await runPromise).toBe(0);

    stderr.mockRestore();
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

async function createReadyQaDir({ withDefaultVisualQa = true } = {}) {
  const qaDir = await mkdtemp(path.join(os.tmpdir(), "live-stack-ready-"));

  await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
  await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(qaDir), "utf8");
  await writeObsHandoff(path.join(qaDir, "obs"));
  if (withDefaultVisualQa) {
    await writeVisualQaManifest(path.join(qaDir, "visual"));
  }

  return qaDir;
}

function createFinalQaReport() {
  return {
    status: "passed",
    repo: {
      commit: currentCommit(),
      trackedFilesClean: true
    }
  };
}

function createLiveRunPlan(qaDir: string) {
  return [
    "Live run sheet:",
    "generated at: 2026-06-08T00:00:00.000Z",
    `commit: ${currentCommit()}`,
    "branch: main",
    "",
    "Live preflight: ready",
    "",
    "Final run commands:",
    `  feed: ${defaultFeedCommand}`,
    `  dashboard: ${defaultDashboardCommand}`,
    "",
    "Open:",
    "  OBS all sources: http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
    "",
    "Evidence outputs:",
    `  live proof gate: ${defaultProofGateCommand}`,
    `  evidence check: ${defaultEvidenceCheckCommandForQa(qaDir)}`,
    `  submission finalize: ${defaultSubmissionFinalizeCommand(path.join(qaDir, "kick-tunnel-check.txt"))}`,
    `  submission bundle: ${defaultSubmissionBundleCommand(path.join(qaDir, "kick-tunnel-check.txt"))}`
  ].join("\n");
}

function defaultSubmissionBundleCommand(kickTunnelCheckPath: string) {
  return `npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir ${shellQuote(
    path.dirname(kickTunnelCheckPath)
  )} --evidence-check ${shellQuote(path.join(path.dirname(kickTunnelCheckPath), "evidence-check.txt"))} --kick-tunnel-check ${shellQuote(
    kickTunnelCheckPath
  )}`;
}

function defaultSubmissionFinalizeCommand(kickTunnelCheckPath: string) {
  return `npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir ${shellQuote(
    path.dirname(kickTunnelCheckPath)
  )} --evidence-out ${shellQuote(path.join(path.dirname(kickTunnelCheckPath), "evidence-check.txt"))} --kick-tunnel-check ${shellQuote(
    kickTunnelCheckPath
  )}`;
}

function defaultEvidenceCheckCommandForQa(qaDir: string) {
  return `npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out ${shellQuote(
    path.join(qaDir, "evidence-check.txt")
  )}`;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writeObsHandoff(obsHandoffDir: string) {
  await mkdir(obsHandoffDir, { recursive: true });
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.md"), "# OBS Browser Source Handoff\n", "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.json"), JSON.stringify(createObsHandoffJson()), "utf8");
}

function createObsHandoffJson() {
  return {
    repo: {
      commit: currentCommit()
    },
    browserSourceSettings: {
      width: 1280,
      height: 720,
      fps: 30,
      customCss: "body { background: rgba(0, 0, 0, 0); overflow: hidden; }"
    },
    sources: [
      {
        name: "Unified Chat - All Sources",
        url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14"
      },
      {
        name: "Unified Chat - Twitch + Kick",
        url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick&limit=12"
      },
      {
        name: "Unified Chat - Signals",
        url: "http://127.0.0.1:5173/?obs=1&signal=1&limit=10"
      }
    ]
  };
}

async function writeVisualQaManifest(visualQaDir: string) {
  await mkdir(visualQaDir, { recursive: true });
  await writeFile(path.join(visualQaDir, "manifest.md"), "# Visual QA Manifest\n", "utf8");
  await writeFile(path.join(visualQaDir, "manifest.json"), JSON.stringify(createVisualQaManifestJson()), "utf8");
}

function createVisualQaManifestJson() {
  return {
    repo: {
      commit: currentCommit()
    },
    captures: [
      {
        route: "/",
        file: "qa/visual/desktop-dashboard.png"
      },
      {
        route: "/",
        file: "qa/visual/mobile-dashboard.png"
      },
      {
        route: "/?obs=1&sources=twitch,kick,x&limit=14",
        file: "qa/visual/obs-overlay.png"
      }
    ]
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;

  constructor(
    readonly command: string,
    readonly args: string[]
  ) {
    super();
  }

  kill() {
    this.killed = true;
    this.exitCode = this.exitCode ?? 143;

    return true;
  }

  emitExit(code: number) {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error("Timed out waiting for test condition");
}
