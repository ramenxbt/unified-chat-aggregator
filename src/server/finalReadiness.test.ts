import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFinalReadinessReport,
  formatFinalReadinessReport,
  parseFinalReadinessCliArgs,
  writeFinalReadinessReport
} from "./finalReadiness";
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

const defaultProofGateCommand =
  "npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 120000 --interval-ms 1000";
const defaultFeedCommand = "FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed";
const defaultDashboardCommand = "VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173";

describe("final recording readiness", () => {
  it("passes when strict connectors and final artifacts are current", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(true);
    expect(formatted).toContain("Final recording readiness: ready");
    expect(formatted).toContain(`Repo commit: ${currentCommit()}`);
    expect(formatted).toMatch(/Checked at: \d{4}-\d{2}-\d{2}T/);
    expect(formatted).toContain("PASS Strict connector preflight");
    expect(formatted).toContain("PASS Target source labels");
    expect(formatted).toContain("KICK (MARKETBUBBLE), TWITCH (MARKETBUBBLE), X (@MARKETBUBBLE)");
    expect(formatted).toContain("PASS Final QA report");
    expect(formatted).toContain("PASS Visual QA manifest");
    expect(formatted).toContain("PASS Final live run sheet");
    expect(formatted).toContain("PASS OBS handoff");
    expect(formatted).toContain("npm run live:tunnel -- --out");
    expect(formatted).toContain("npm run proof:gate --");
    expect(formatted).toContain("npm run submission:finalize --");
    expect(formatted).toContain("npm run submission:bundle --");
    expect(formatted).toContain("npm run live:stack -- --qa-dir");
    expect(formatted).toContain("--require-ready --with-proof-gate");
  });

  it("fails when strict connector credentials are missing", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      { qaDir }
    );
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Strict connector preflight");
    expect(formatted).toContain("Connector setup details:");
    expect(formatted).toContain("Stream-day .env checklist:");
    expect(formatted).toContain("TWITCH_CLIENT_ID=");
    expect(formatted).toContain("KICK_WEBHOOK_PUBLIC_URL=https://YOUR-TUNNEL.example/webhooks/kick");
  });

  it("fails when readable target source labels are incomplete", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(
      {
        ...completeEnv,
        TWITCH_BROADCASTER_LOGIN: undefined,
        KICK_BROADCASTER_SLUG: undefined,
        X_FILTER_RULES: "from:marketbubble",
        X_SPACES_QUERY: undefined
      },
      { qaDir }
    );
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("PASS Strict connector preflight");
    expect(formatted).toContain("MISS Target source labels");
    expect(formatted).toContain("Add TWITCH_BROADCASTER_LOGIN=marketbubble, KICK_BROADCASTER_SLUG=marketbubble");
    expect(formatted).toContain("Current target labels: X (@MARKETBUBBLE)");
  });

  it("fails when the final run sheet is stale", async () => {
    const qaDir = await createReadyQaDir({ runSheetCommit: "stale123" });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });

    expect(report.ok).toBe(false);
    expect(formatFinalReadinessReport(report)).toContain("was generated for commit stale123");
  });

  it("fails when OBS handoff files are missing", async () => {
    const qaDir = await createReadyQaDir({ withObsHandoff: false });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });

    expect(report.ok).toBe(false);
    expect(formatFinalReadinessReport(report)).toContain("MISS OBS handoff");
  });

  it("fails when the visual QA manifest is missing", async () => {
    const qaDir = await createReadyQaDir({ withVisualQaManifest: false });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Visual QA manifest");
    expect(formatted).toContain("is missing or unreadable");
  });

  it("fails when the visual QA manifest was generated from a stale commit", async () => {
    const qaDir = await createReadyQaDir({ visualQaCommit: "stale123" });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Visual QA manifest");
    expect(formatted).toContain("was generated for commit stale123");
  });

  it("fails when the final run sheet is missing the OBS all-source URL", async () => {
    const qaDir = await createReadyQaDir({ obsAllSourcesUrl: null });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("is missing the OBS all-source URL");
  });

  it("fails when the final run sheet OBS URL does not match current live options", async () => {
    const qaDir = await createReadyQaDir({
      obsAllSourcesUrl: "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14",
      obsHandoffUrl: "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14"
    });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("but current live:ready options expect http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14");
  });

  it("fails when the final run sheet is missing launch commands", async () => {
    const qaDir = await createReadyQaDir({ feedCommand: null, dashboardCommand: null });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("is missing the feed command");
  });

  it("fails when the final run sheet launch commands do not match current options", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(completeEnv, { qaDir, feedPort: 8899 });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("feed command does not match current live:ready launch options");
  });

  it("prints required final commands with the current path and port overrides", async () => {
    const qaDir = await mkdtemp(path.join(os.tmpdir(), "final readiness custom-"));
    const obsHandoffDir = path.join(qaDir, "obs handoff");
    const report = await buildFinalReadinessReport(completeEnv, {
      qaDir,
      obsHandoffDir,
      feedPort: 8899,
      appPort: 5260,
      archiveDir: "data/final sessions",
      databasePath: "data/final proof.sqlite",
      clipQueuePath: "exports/final clips.json",
      proofTimeoutMs: 300000,
      proofIntervalMs: 2000
    });
    const formatted = formatFinalReadinessReport(report);

    expect(formatted).toContain(
      `npm run live:prepare -- --feed-port 8899 --app-port 5260 --archive-dir 'data/final sessions' --db 'data/final proof.sqlite' --clips 'exports/final clips.json' --qa-dir '${qaDir}' --kick-tunnel-check '${path.join(
        qaDir,
        "kick-tunnel-check.txt"
      )}' --proof-timeout-ms 300000 --proof-interval-ms 2000 --out '${path.join(
        qaDir,
        "live-run-plan.txt"
      )}'`
    );
    expect(formatted).toContain(`npm run obs:handoff -- --app-port 5260 --out '${obsHandoffDir}'`);
    expect(formatted).toContain(`npm run live:tunnel -- --out '${path.join(qaDir, "kick-tunnel-check.txt")}'`);
    expect(formatted).toContain(
      "npm run proof:gate -- --archive-dir 'data/final sessions' --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 300000 --interval-ms 2000"
    );
    expect(formatted).toContain(
      `npm run submission:finalize -- --archive-dir 'data/final sessions' --db 'data/final proof.sqlite' --out submission-bundle --clips 'exports/final clips.json' --qa-dir '${qaDir}' --kick-tunnel-check '${path.join(qaDir, "kick-tunnel-check.txt")}'`
    );
    expect(formatted).toContain(
      `npm run submission:bundle -- --archive-dir 'data/final sessions' --db 'data/final proof.sqlite' --out submission-bundle --clips 'exports/final clips.json' --qa-dir '${qaDir}' --kick-tunnel-check '${path.join(qaDir, "kick-tunnel-check.txt")}'`
    );
    expect(formatted).toContain(
      `npm run live:stack -- --feed-port 8899 --app-port 5260 --archive-dir 'data/final sessions' --db 'data/final proof.sqlite' --clips 'exports/final clips.json' --qa-dir '${qaDir}' --proof-timeout-ms 300000 --proof-interval-ms 2000 --obs-handoff-dir '${obsHandoffDir}' --require-ready --with-proof-gate`
    );
  });

  it("parses an output path for saving readiness proof", () => {
    expect(parseFinalReadinessCliArgs(["--qa-dir", "qa/final", "--out", "qa/final-readiness.txt"])).toEqual({
      allowPartial: false,
      qaDir: "qa/final",
      outPath: "qa/final-readiness.txt"
    });

    expect(parseFinalReadinessCliArgs(["--output", "qa/ready.txt"])).toEqual({
      allowPartial: false,
      outPath: "qa/ready.txt"
    });
  });

  it("writes the final readiness report to a proof file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "final-readiness-output-"));
    const reportPath = path.join(tempDir, "qa", "final-readiness.txt");

    await writeFinalReadinessReport(reportPath, "Final recording readiness: ready");

    expect(await readFile(reportPath, "utf8")).toBe("Final recording readiness: ready\n");
  });

  it("fails when the final run sheet is missing the live proof gate command", async () => {
    const qaDir = await createReadyQaDir({ proofGateCommand: null });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("is missing the live proof gate command");
  });

  it("fails when the final run sheet proof gate command does not match current thresholds", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(
      {
        ...completeEnv,
        PROOF_MIN_EVENTS: "100"
      },
      { qaDir }
    );
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("proof gate command does not match current live:ready thresholds");
  });

  it("fails when the final run sheet is missing evidence packaging commands", async () => {
    const qaDir = await createReadyQaDir({ evidenceCheckCommand: null, submissionFinalizeCommand: null, submissionBundleCommand: null });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("is missing the evidence check command");
  });

  it("fails when the final run sheet evidence commands do not match current paths", async () => {
    const qaDir = await createReadyQaDir({
      feedCommand: "FEED_SERVER_PORT=8787 FEED_DB_PATH=data/final.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed"
    });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir, databasePath: "data/final.sqlite" });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS Final live run sheet");
    expect(formatted).toContain("evidence check command does not match current live:ready evidence paths");
  });

  it("fails when OBS handoff URLs do not match the final run sheet", async () => {
    const qaDir = await createReadyQaDir({
      obsAllSourcesUrl: "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14",
      dashboardCommand: "VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5260"
    });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir, appPort: 5260 });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS OBS handoff");
    expect(formatted).toContain("but the run sheet expects http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14");
  });

  it("fails when the OBS handoff was generated from a stale commit", async () => {
    const qaDir = await createReadyQaDir({ obsHandoffCommit: "stale123" });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS OBS handoff");
    expect(formatted).toContain("was generated for commit stale123");
  });
});

async function createReadyQaDir({
  obsAllSourcesUrl = "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
  obsHandoffUrl = "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
  feedCommand = defaultFeedCommand,
  dashboardCommand = defaultDashboardCommand,
  proofGateCommand = defaultProofGateCommand,
  evidenceCheckCommand,
  submissionFinalizeCommand,
  submissionBundleCommand,
  obsHandoffCommit = currentCommit(),
  visualQaCommit = currentCommit(),
  runSheetCommit = currentCommit(),
  withObsHandoff = true,
  withVisualQaManifest = true
}: {
  obsAllSourcesUrl?: string | null;
  obsHandoffUrl?: string;
  feedCommand?: string | null;
  dashboardCommand?: string | null;
  proofGateCommand?: string | null;
  evidenceCheckCommand?: string | null;
  submissionFinalizeCommand?: string | null;
  submissionBundleCommand?: string | null;
  obsHandoffCommit?: string;
  visualQaCommit?: string;
  runSheetCommit?: string;
  withObsHandoff?: boolean;
  withVisualQaManifest?: boolean;
} = {}) {
  const qaDir = await mkdtemp(path.join(os.tmpdir(), "final-readiness-"));
  const resolvedSubmissionBundleCommand =
    submissionBundleCommand === undefined ? defaultSubmissionBundleCommand(path.join(qaDir, "kick-tunnel-check.txt")) : submissionBundleCommand;
  const resolvedEvidenceCheckCommand =
    evidenceCheckCommand === undefined ? defaultEvidenceCheckCommandForQa(qaDir) : evidenceCheckCommand;
  const resolvedSubmissionFinalizeCommand =
    submissionFinalizeCommand === undefined ? defaultSubmissionFinalizeCommand(path.join(qaDir, "kick-tunnel-check.txt")) : submissionFinalizeCommand;

  await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
  await writeFile(
    path.join(qaDir, "live-run-plan.txt"),
    createLiveRunPlan(
      runSheetCommit,
      obsAllSourcesUrl,
      feedCommand,
      dashboardCommand,
      proofGateCommand,
      resolvedEvidenceCheckCommand,
      resolvedSubmissionFinalizeCommand,
      resolvedSubmissionBundleCommand
    ),
    "utf8"
  );

  if (withObsHandoff) {
    await writeObsHandoff(path.join(qaDir, "obs"), obsHandoffCommit, obsHandoffUrl);
  }

  if (withVisualQaManifest) {
    await writeVisualQaManifest(path.join(qaDir, "visual"), visualQaCommit);
  }

  return qaDir;
}

function defaultSubmissionBundleCommand(kickTunnelCheckPath: string) {
  return `npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir ${shellQuote(
    path.dirname(kickTunnelCheckPath)
  )} --kick-tunnel-check ${shellQuote(
    kickTunnelCheckPath
  )}`;
}

function defaultSubmissionFinalizeCommand(kickTunnelCheckPath: string) {
  return `npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir ${shellQuote(
    path.dirname(kickTunnelCheckPath)
  )} --kick-tunnel-check ${shellQuote(
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

function createFinalQaReport() {
  return {
    status: "passed",
    repo: {
      commit: currentCommit(),
      trackedFilesClean: true
    }
  };
}

function createLiveRunPlan(
  commit: string,
  obsAllSourcesUrl: string | null,
  feedCommand: string | null,
  dashboardCommand: string | null,
  proofGateCommand: string | null,
  evidenceCheckCommand: string | null,
  submissionFinalizeCommand: string | null,
  submissionBundleCommand: string | null
) {
  const lines = [
    "Live run sheet:",
    "generated at: 2026-06-08T00:00:00.000Z",
    `commit: ${commit}`,
    "branch: main",
    "",
    "Live preflight: ready"
  ];

  if (feedCommand || dashboardCommand) {
    lines.push("", "Final run commands:");
    if (feedCommand) lines.push(`  feed: ${feedCommand}`);
    if (dashboardCommand) lines.push(`  dashboard: ${dashboardCommand}`);
  }

  if (obsAllSourcesUrl) {
    lines.push("", "Open:", `  OBS all sources: ${obsAllSourcesUrl}`);
  }

  if (proofGateCommand) {
    lines.push("", "Evidence outputs:", `  live proof gate: ${proofGateCommand}`);
  }

  if (evidenceCheckCommand) {
    if (!proofGateCommand) lines.push("", "Evidence outputs:");
    lines.push(`  evidence check: ${evidenceCheckCommand}`);
  }

  if (submissionBundleCommand) {
    if (!proofGateCommand && !evidenceCheckCommand && !submissionFinalizeCommand) lines.push("", "Evidence outputs:");
    if (submissionFinalizeCommand) lines.push(`  submission finalize: ${submissionFinalizeCommand}`);
    lines.push(`  submission bundle: ${submissionBundleCommand}`);
  } else if (submissionFinalizeCommand) {
    if (!proofGateCommand && !evidenceCheckCommand) lines.push("", "Evidence outputs:");
    lines.push(`  submission finalize: ${submissionFinalizeCommand}`);
  }

  return lines.join("\n");
}

async function writeObsHandoff(obsHandoffDir: string, commit: string, obsHandoffUrl: string) {
  await mkdir(obsHandoffDir, { recursive: true });
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.md"), "# OBS Browser Source Handoff\n", "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.json"), JSON.stringify(createObsHandoffJson(commit, obsHandoffUrl)), "utf8");
}

function createObsHandoffJson(commit: string, obsHandoffUrl: string) {
  return {
    repo: {
      commit
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
        url: obsHandoffUrl
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

async function writeVisualQaManifest(visualQaDir: string, commit: string) {
  await mkdir(visualQaDir, { recursive: true });
  await writeFile(path.join(visualQaDir, "manifest.md"), "# Visual QA Manifest\n", "utf8");
  await writeFile(path.join(visualQaDir, "manifest.json"), JSON.stringify(createVisualQaManifestJson(commit)), "utf8");
}

function createVisualQaManifestJson(commit: string) {
  return {
    repo: {
      commit
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
