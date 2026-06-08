import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive, SQLiteFeedArchive } from "./feedArchive";
import { finalizeSubmission, parseFinalizeSubmissionCliArgs } from "./finalizeSubmission";

describe("submission finalizer", () => {
  it("parses finalization paths and partial mode", () => {
    expect(
      parseFinalizeSubmissionCliArgs([
        "--archive-dir",
        "data/feed-sessions",
        "--db",
        "data/feed.sqlite",
        "--out",
        "submission-bundle",
        "--qa-dir",
        "qa",
        "--evidence-out",
        "qa/evidence-check.txt",
        "--clips",
        "clip-queue.json",
        "--obs-handoff-dir",
        "qa/obs",
        "--visual-qa-dir",
        "qa/visual",
        "--kick-tunnel-check",
        "qa/kick-tunnel-check.txt",
        "--allow-partial"
      ])
    ).toEqual({
      archivePath: null,
      archiveDir: "data/feed-sessions",
      databasePath: "data/feed.sqlite",
      outputDir: "submission-bundle",
      qaDir: "qa",
      evidenceOutputPath: "qa/evidence-check.txt",
      clipQueuePath: "clip-queue.json",
      obsHandoffDir: "qa/obs",
      visualQaDir: "qa/visual",
      kickTunnelCheckPath: "qa/kick-tunnel-check.txt",
      allowPartial: true
    });
  });

  it("writes evidence proof and builds a strict submission bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createFinalizerFixture();
    const qaDir = path.join(baseDir, "qa");
    const outputDir = path.join(baseDir, "submission-bundle");
    const clipQueuePath = path.join(baseDir, "clip-queue.json");

    await writeStrictQaArtifacts(qaDir);
    await writeFile(clipQueuePath, JSON.stringify(createClipQueueExport()), "utf8");

    const result = await finalizeSubmission([
      "--archive-dir",
      archiveDir,
      "--db",
      databasePath,
      "--out",
      outputDir,
      "--qa-dir",
      qaDir,
      "--clips",
      clipQueuePath,
      "--kick-tunnel-check",
      path.join(qaDir, "kick-tunnel-check.txt")
    ]);

    expect(result.bundle.ok).toBe(true);
    expect(result.evidenceOutputPath).toBe(path.join(qaDir, "evidence-check.txt"));
    expect(result.evidenceOutput).toContain("Evidence check: ready");
    expect(result.evidenceOutput).toContain("P95 latency:");
    expect(await readFile(path.join(qaDir, "evidence-check.txt"), "utf8")).toContain("Evidence check: ready");
    expect(result.bundle.files.evidenceCheckReport).toBe(path.join(outputDir, "evidence-check.txt"));
    expect(await readFile(result.bundle.files.evidenceCheckReport as string, "utf8")).toContain("Throughput:");
  });

  it("builds the final bundle from custom OBS and visual artifact directories", async () => {
    const { archiveDir, databasePath, baseDir } = await createFinalizerFixture();
    const qaDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(baseDir, "obs handoff");
    const visualQaDir = path.join(baseDir, "visual proof");
    const outputDir = path.join(baseDir, "submission-bundle");

    await writeStrictQaArtifacts(qaDir, { obsHandoffDir, visualQaDir });

    const result = await finalizeSubmission([
      "--archive-dir",
      archiveDir,
      "--db",
      databasePath,
      "--out",
      outputDir,
      "--qa-dir",
      qaDir,
      "--obs-handoff-dir",
      obsHandoffDir,
      "--visual-qa-dir",
      visualQaDir,
      "--kick-tunnel-check",
      path.join(qaDir, "kick-tunnel-check.txt")
    ]);

    expect(result.bundle.ok).toBe(true);
    expect(result.bundle.files.obsHandoffJson).toBe(path.join(outputDir, "obs-browser-sources.json"));
    expect(result.bundle.files.visualQaManifestJson).toBe(path.join(outputDir, "visual-qa-manifest.json"));
    expect(await readFile(result.bundle.files.obsHandoffMarkdown as string, "utf8")).toContain("OBS Browser Source Handoff");
    expect(await readFile(result.bundle.files.visualQaManifestMarkdown as string, "utf8")).toContain("Visual QA Manifest");
  });

  it("copies a custom evidence proof path into the final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createFinalizerFixture();
    const qaDir = path.join(baseDir, "qa");
    const evidenceOutputPath = path.join(baseDir, "custom evidence", "proof.txt");
    const outputDir = path.join(baseDir, "submission-bundle");

    await writeStrictQaArtifacts(qaDir);

    const result = await finalizeSubmission([
      "--archive-dir",
      archiveDir,
      "--db",
      databasePath,
      "--out",
      outputDir,
      "--qa-dir",
      qaDir,
      "--evidence-out",
      evidenceOutputPath,
      "--kick-tunnel-check",
      path.join(qaDir, "kick-tunnel-check.txt")
    ]);

    expect(result.bundle.ok).toBe(true);
    expect(result.evidenceOutputPath).toBe(evidenceOutputPath);
    expect(await readFile(evidenceOutputPath, "utf8")).toContain("Evidence check: ready");
    expect(result.bundle.files.evidenceCheckReport).toBe(path.join(outputDir, "evidence-check.txt"));
    expect(await readFile(result.bundle.files.evidenceCheckReport as string, "utf8")).toContain("Throughput:");
  });
});

async function createFinalizerFixture() {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "submission-finalizer-"));
  const archive = new FileFeedArchive(path.join(baseDir, "feed-sessions"));
  const databasePath = path.join(baseDir, "feed.sqlite");
  const databaseArchive = new SQLiteFeedArchive(databasePath);
  const startedAt = "2026-06-04T23:00:00.000Z";
  const sessionId = createFeedSessionId(startedAt, "connectors");
  const session = {
    sessionId,
    startedAt,
    mode: "connectors" as const,
    bufferSize: 250,
    fixtureIntervalMs: 1100,
    connectorPlatforms: ["twitch", "kick", "x"]
  };

  await archive.start(session);
  await databaseArchive.start(session);

  for (const eventIndex of [0, 1, 2]) {
    const event = createFixtureEvent(eventIndex);
    archive.recordEvent(event);
    databaseArchive.recordEvent(event);
  }

  for (const status of finalConnectorStatuses) {
    archive.recordStatus(status);
    databaseArchive.recordStatus(status);
  }

  await archive.stop("2026-06-04T23:00:10.000Z");
  await databaseArchive.stop("2026-06-04T23:00:10.000Z");

  return {
    archiveDir: path.join(baseDir, "feed-sessions"),
    databasePath,
    baseDir
  };
}

async function writeStrictQaArtifacts(
  qaDir: string,
  {
    obsHandoffDir = path.join(qaDir, "obs"),
    visualQaDir = path.join(qaDir, "visual")
  }: {
    obsHandoffDir?: string;
    visualQaDir?: string;
  } = {}
) {
  await mkdir(qaDir, { recursive: true });
  await mkdir(obsHandoffDir, { recursive: true });
  await mkdir(visualQaDir, { recursive: true });
  await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
  await writeFile(path.join(qaDir, "final-readiness.txt"), createFinalReadinessProof(), "utf8");
  await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.md"), "# OBS Browser Source Handoff\n", "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.json"), JSON.stringify(createObsHandoffJson()), "utf8");
  await writeFile(path.join(visualQaDir, "manifest.md"), "# Visual QA Manifest\n", "utf8");
  await writeFile(path.join(visualQaDir, "manifest.json"), JSON.stringify(createVisualQaManifestJson()), "utf8");
  await writeFile(path.join(qaDir, "kick-tunnel-check.txt"), createKickTunnelCheck(), "utf8");
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

function createFinalReadinessProof() {
  return [
    "Final recording readiness: ready",
    `Repo commit: ${currentCommit()}`,
    "Checked at: 2026-06-08T16:00:00.000Z",
    "",
    "Checks:",
    "  PASS Strict connector preflight: Twitch, Kick, and X are ready for a connector-mode capture.",
    "  PASS Target source labels: KICK (MARKETBUBBLE), TWITCH (MARKETBUBBLE), X (@MARKETBUBBLE)",
    "  PASS Final QA report: qa/final-report.json passed for the current commit.",
    "  PASS Visual QA manifest: qa/visual has current captures.",
    "  PASS Final live run sheet: qa/live-run-plan.txt is strict and current.",
    "  PASS OBS handoff: qa/obs has browser source presets.",
    "",
    "Required final commands:",
    "  npm run qa:final",
    "  npm run live:prepare -- --out qa/live-run-plan.txt",
    "  npm run obs:handoff -- --app-port 5173 --out qa/obs",
    "  npm run live:tunnel -- --out qa/kick-tunnel-check.txt",
    "  npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 120000 --interval-ms 1000",
    "  npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt",
    "  npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt",
    "  npm run live:stack -- --require-ready --with-proof-gate"
  ].join("\n");
}

function createLiveRunPlan() {
  return [
    "Live run sheet:",
    "generated at: 2026-06-08T00:00:00.000Z",
    `commit: ${currentCommit()}`,
    "branch: main",
    "",
    "Live preflight: ready",
    "",
    "Open:",
    "  OBS all sources: http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
    "",
    "Final run commands:",
    "  feed: FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed",
    "  dashboard: VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173",
    "",
    "Evidence outputs:",
    "  live proof gate: npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000",
    "  evidence check: npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt",
    "  submission finalize: npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt",
    "  submission bundle: npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt"
  ].join("\n");
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

function createVisualQaManifestJson() {
  return {
    repo: {
      commit: currentCommit()
    },
    captures: [
      {
        file: "qa/visual/desktop-dashboard.png"
      },
      {
        file: "qa/visual/mobile-dashboard.png"
      },
      {
        file: "qa/visual/obs-overlay.png"
      }
    ]
  };
}

function createKickTunnelCheck() {
  return [
    "Kick tunnel: ready",
    "URL: https://market-bubble-tunnel.example/webhooks/kick",
    `Repo commit: ${currentCommit()}`,
    "Checked at: 2026-06-08T00:00:00.000Z",
    "Kick tunnel reaches the local receiver at /webhooks/kick."
  ].join("\n");
}

function createClipQueueExport() {
  const clips = [createFixtureEvent(0), createFixtureEvent(2)].map((event, index) => ({
    clippedAt: new Date(Date.UTC(2026, 5, 4, 23, index)).toISOString(),
    event
  }));

  return {
    exportedAt: "2026-06-04T23:00:03.000Z",
    source: "Live feed server",
    transportState: "live",
    clipCount: clips.length,
    clips
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

const finalConnectorStatuses = initialConnectorStatuses.map((status) => ({
  ...status,
  state: "live" as const
}));
