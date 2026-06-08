import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive, SQLiteFeedArchive } from "./feedArchive";
import { createSubmissionBundle, formatSubmissionBundleResult } from "./submissionBundle";

describe("submission bundle", () => {
  it("writes evidence, replay, csv, and summary files", async () => {
    const { archiveDir, archivePath, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const clipQueuePath = path.join(baseDir, "clip-queue-export.json");
    const outputDir = path.join(baseDir, "bundle");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.md"), "# Final QA Report\n\nStatus: passed\n", "utf8");
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeFile(clipQueuePath, JSON.stringify(createClipQueueExport()), "utf8");

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir,
      clipQueuePath
    });

    expect(result.ok).toBe(true);
    expect(formatSubmissionBundleResult(result)).toContain("Submission bundle: ready");

    const evidenceReport = await readFile(result.files.evidenceReport, "utf8");
    const replayJson = JSON.parse(await readFile(result.files.replayJson, "utf8"));
    const replayCsv = await readFile(result.files.replayCsv, "utf8");
    const submissionNotes = await readFile(result.files.submissionNotes, "utf8");
    expect(result.files.finalQaReportMarkdown).toBeDefined();
    expect(result.files.finalQaReportJson).toBeDefined();
    expect(result.files.liveRunPlan).toBeDefined();
    expect(result.files.obsHandoffMarkdown).toBeDefined();
    expect(result.files.obsHandoffJson).toBeDefined();
    expect(result.files.clipQueueJson).toBeDefined();
    const finalQaReport = await readFile(result.files.finalQaReportMarkdown as string, "utf8");
    const finalQaReportJson = JSON.parse(await readFile(result.files.finalQaReportJson as string, "utf8"));
    const liveRunPlan = await readFile(result.files.liveRunPlan as string, "utf8");
    const obsHandoffMarkdown = await readFile(result.files.obsHandoffMarkdown as string, "utf8");
    const obsHandoffJson = JSON.parse(await readFile(result.files.obsHandoffJson as string, "utf8"));
    const clipQueueJson = JSON.parse(await readFile(result.files.clipQueueJson as string, "utf8"));
    const summary = JSON.parse(await readFile(result.files.summary, "utf8"));

    expect(evidenceReport).toContain("Evidence check: ready");
    expect(evidenceReport).toContain("KICK (MARKETBUBBLE)");
    expect(replayJson.eventCount).toBe(3);
    expect(replayCsv).toContain("occurred_at,received_at,platform,platform_label,kind");
    expect(submissionNotes).toContain("# Unified Chat Aggregator Submission Notes");
    expect(submissionNotes).toContain("Status: ready");
    expect(submissionNotes).toContain("Repo commit:");
    expect(submissionNotes).toContain("## External Artifacts To Attach");
    expect(submissionNotes).toContain("OBS overlay recording with Twitch, Kick, and X source labels visible");
    expect(submissionNotes).toContain("## Clip Queue");
    expect(submissionNotes).toContain("- Clips marked: 2");
    expect(submissionNotes).toContain("- KICK (MARKETBUBBLE)");
    expect(submissionNotes).toContain("- kick: 1 events");
    expect(submissionNotes).toContain("- KICK (MARKETBUBBLE)");
    expect(finalQaReport).toContain("Status: passed");
    expect(finalQaReportJson).toMatchObject({
      status: "passed",
      repo: {
        commit: expect.any(String)
      }
    });
    expect(liveRunPlan).toContain("Live preflight: ready");
    expect(obsHandoffMarkdown).toContain("OBS Browser Source Handoff");
    expect(obsHandoffJson.sources[0]).toMatchObject({
      name: "Unified Chat - All Sources",
      url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14"
    });
    expect(clipQueueJson.clipCount).toBe(2);
    expect(summary.archivePath).toBe(archivePath);
    expect(summary).toMatchObject({
      evidenceOk: true,
      eventCount: 3,
      performance: {
        durationSeconds: expect.any(Number),
        eventsPerSecond: expect.any(Number),
        averageLatencyMs: expect.any(Number),
        p95LatencyMs: expect.any(Number)
      },
      platforms: {
        twitch: 1,
        kick: 1,
        x: 1
      },
      repo: {
        commit: expect.any(String),
        branch: expect.any(String),
        remote: expect.any(String)
      },
      externalArtifacts: [
        "OBS overlay recording with Twitch, Kick, and X source labels visible",
        "Dashboard recording or screenshot showing connector diagnostics and run proof",
        "Exported dashboard recording JSON, CSV, and clip queue JSON, if captured from the browser",
        "Final live run sheet from qa/live-run-plan.txt",
        "OBS browser source handoff from qa/obs/obs-browser-sources.md",
        "Final local rehearsal report from qa/final-report.md"
      ],
      clipQueue: {
        clipCount: 2,
        sourceLabels: ["KICK (MARKETBUBBLE)", "TWITCH (ANSEM)"]
      },
      files: {
        finalQaReportMarkdown: result.files.finalQaReportMarkdown,
        finalQaReportJson: result.files.finalQaReportJson,
        liveRunPlan: result.files.liveRunPlan,
        obsHandoffMarkdown: result.files.obsHandoffMarkdown,
        obsHandoffJson: result.files.obsHandoffJson,
        clipQueueJson: result.files.clipQueueJson
      }
    });
    expect(formatSubmissionBundleResult(result)).toContain("Final QA report:");
    expect(formatSubmissionBundleResult(result)).toContain("Live run plan:");
    expect(formatSubmissionBundleResult(result)).toContain("OBS handoff:");
    expect(formatSubmissionBundleResult(result)).toContain("Clip queue JSON:");
  });

  it("flags a missing provided clip queue export", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const missingClipQueuePath = path.join(baseDir, "missing-clip-queue.json");
    const outputDir = path.join(baseDir, "bundle-missing-clips");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir,
      clipQueuePath: missingClipQueuePath
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      `clip queue JSON ${missingClipQueuePath} is missing; export the clip queue from the dashboard first`
    );
  });

  it("flags a partial live run sheet in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-partial-plan");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      createLiveRunPlan("Platform requirement: at least one live connector\nlive proof gate: npm run proof:gate -- --allow-partial\n"),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });
    const submissionNotes = await readFile(result.files.submissionNotes, "utf8");
    const summary = JSON.parse(await readFile(result.files.summary, "utf8"));
    const formatted = formatSubmissionBundleResult(result);

    expect(result.ok).toBe(false);
    expect(result.evidence.ok).toBe(true);
    expect(result.artifactIssues).toEqual([
      "qa/live-run-plan.txt was generated in partial mode; rerun live:prepare without --allow-partial for final proof"
    ]);
    expect(formatted).toContain("Submission bundle: needs attention");
    expect(formatted).toContain("qa/live-run-plan.txt was generated in partial mode");
    expect(submissionNotes).toContain("Status: needs attention");
    expect(submissionNotes).toContain("## Artifact Issues");
    expect(summary).toMatchObject({
      evidenceOk: true,
      artifactIssues: result.artifactIssues
    });
  });

  it("requires a final QA report for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const outputDir = path.join(baseDir, "bundle-missing-qa");
    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: path.join(baseDir, "missing-qa"),
      liveRunPlanDir: path.join(baseDir, "missing-qa")
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/final-report.json is missing; run npm run qa:final before creating the final bundle"
    );
  });

  it("flags a stale final QA report commit in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-stale-qa");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(
      path.join(finalQaReportDir, "final-report.json"),
      JSON.stringify(createFinalQaReport({ commit: "stale123" })),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues.some((issue) => issue.includes("was generated for commit stale123"))).toBe(true);
  });

  it("flags a stale live run sheet commit in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-stale-run-sheet");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(liveRunPlanDir, "live-run-plan.txt"), createLiveRunPlan("Live preflight: ready\n", "stale123"), "utf8");
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues.some((issue) => issue.includes("qa/live-run-plan.txt was generated for commit stale123"))).toBe(
      true
    );
  });

  it("flags a live run sheet without commit metadata in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-run-sheet-metadata");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(liveRunPlanDir, "live-run-plan.txt"), "Live preflight: ready\n", "utf8");
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing commit metadata; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
  });

  it("flags a live run sheet without the proof gate command in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-proof-gate");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      createLiveRunPlan("Live preflight: ready\n", currentCommit(), undefined, null),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing the live proof gate command; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
  });

  it("flags a live run sheet without launch commands in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-launch-commands");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      createLiveRunPlan(
        "Live preflight: ready\n",
        currentCommit(),
        "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
        defaultProofGateCommand(),
        defaultEvidenceCheckCommand(),
        defaultSubmissionBundleCommand(),
        null,
        null
      ),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing the feed command; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing the dashboard command; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
  });

  it("flags a live run sheet without evidence packaging commands in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-evidence-commands");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      createLiveRunPlan("Live preflight: ready\n", currentCommit(), undefined, defaultProofGateCommand(), null, null),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing the evidence check command; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
    expect(result.artifactIssues).toContain(
      "qa/live-run-plan.txt is missing the submission bundle command; rerun live:prepare -- --out qa/live-run-plan.txt"
    );
  });

  it("flags a dirty-worktree final QA report in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-dirty-qa");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(
      path.join(finalQaReportDir, "final-report.json"),
      JSON.stringify(createFinalQaReport({ trackedFilesClean: false })),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/final-report.json was generated with dirty tracked files; commit or revert changes, then rerun npm run qa:final"
    );
  });

  it("requires OBS handoff files for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const outputDir = path.join(baseDir, "bundle-missing-obs");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir: path.join(baseDir, "missing-obs")
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/obs/obs-browser-sources.md is missing; run npm run obs:handoff -- --out qa/obs before creating the final bundle"
    );
    expect(result.artifactIssues).toContain(
      "qa/obs/obs-browser-sources.json is missing; run npm run obs:handoff -- --out qa/obs before creating the final bundle"
    );
  });

  it("flags malformed OBS handoff JSON in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-bad-obs");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir, { sources: [] });

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/obs/obs-browser-sources.json does not include the expected OBS browser sources; rerun npm run obs:handoff -- --out qa/obs"
    );
    expect(result.artifactIssues).toContain(
      "qa/obs/obs-browser-sources.json is missing the all-source OBS overlay URL; rerun npm run obs:handoff -- --out qa/obs"
    );
  });

  it("flags OBS handoff URLs that do not match the final run sheet", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-mismatched-obs");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(finalQaReportDir, "live-run-plan.txt"),
      createLiveRunPlan("Live preflight: ready\n", currentCommit(), "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14"),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/obs/obs-browser-sources.json all-source URL http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14 does not match qa/live-run-plan.txt http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14; rerun npm run obs:handoff -- --out qa/obs with the same app port"
    );
  });

  it("flags OBS handoff files generated from a stale commit", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-stale-obs");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir, createObsHandoffJson({ commit: "stale123" }));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir,
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      `qa/obs/obs-browser-sources.json was generated for commit stale123, but current commit is ${currentCommit()}; rerun npm run obs:handoff -- --out qa/obs`
    );
  });
});

async function createBundleFixture() {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "submission-bundle-"));
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

  for (const status of initialConnectorStatuses) {
    archive.recordStatus(status);
    databaseArchive.recordStatus(status);
  }

  await archive.stop("2026-06-04T23:00:10.000Z");
  await databaseArchive.stop("2026-06-04T23:00:10.000Z");

  return {
    archiveDir: path.join(baseDir, "feed-sessions"),
    archivePath: path.join(baseDir, "feed-sessions", sessionId),
    databasePath,
    baseDir
  };
}

function createFinalQaReport({ commit = currentCommit(), trackedFilesClean = true } = {}) {
  return {
    status: "passed",
    repo: {
      commit,
      trackedFilesClean
    }
  };
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

function createLiveRunPlan(
  body = "Live preflight: ready\n",
  commit = currentCommit(),
  obsAllSourcesUrl = "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
  proofGateCommand: string | null = defaultProofGateCommand(),
  evidenceCheckCommand: string | null = defaultEvidenceCheckCommand(),
  submissionBundleCommand: string | null = defaultSubmissionBundleCommand(),
  feedCommand: string | null = defaultFeedCommand(),
  dashboardCommand: string | null = defaultDashboardCommand()
) {
  const lines = [
    "Live run sheet:",
    "generated at: 2026-06-08T00:00:00.000Z",
    `commit: ${commit}`,
    "branch: main",
    "",
    body,
    "",
    "Open:",
    `  OBS all sources: ${obsAllSourcesUrl}`
  ];

  if (feedCommand || dashboardCommand) {
    lines.push("", "Final run commands:");
    if (feedCommand) lines.push(`  feed: ${feedCommand}`);
    if (dashboardCommand) lines.push(`  dashboard: ${dashboardCommand}`);
  }

  if (proofGateCommand) {
    lines.push("", "Evidence outputs:", `  live proof gate: ${proofGateCommand}`);
  }

  if (evidenceCheckCommand) {
    if (!proofGateCommand) lines.push("", "Evidence outputs:");
    lines.push(`  evidence check: ${evidenceCheckCommand}`);
  }

  if (submissionBundleCommand) {
    if (!proofGateCommand && !evidenceCheckCommand) lines.push("", "Evidence outputs:");
    lines.push(`  submission bundle: ${submissionBundleCommand}`);
  }

  return lines.join("\n");
}

function defaultProofGateCommand() {
  return "npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 120000 --interval-ms 1000";
}

function defaultEvidenceCheckCommand() {
  return "npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite";
}

function defaultSubmissionBundleCommand() {
  return "npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle";
}

function defaultFeedCommand() {
  return "FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed";
}

function defaultDashboardCommand() {
  return "VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173";
}

async function writeObsHandoff(obsHandoffDir: string, json: unknown = createObsHandoffJson()) {
  await mkdir(obsHandoffDir, { recursive: true });
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.md"), "# OBS Browser Source Handoff\n", "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.json"), JSON.stringify(json), "utf8");
}

function createObsHandoffJson({ commit = currentCommit() } = {}) {
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
