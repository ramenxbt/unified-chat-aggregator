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
    const outputDir = path.join(baseDir, "bundle");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.md"), "# Final QA Report\n\nStatus: passed\n", "utf8");
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), "Live preflight: ready\n", "utf8");

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir
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
    const finalQaReport = await readFile(result.files.finalQaReportMarkdown as string, "utf8");
    const finalQaReportJson = JSON.parse(await readFile(result.files.finalQaReportJson as string, "utf8"));
    const liveRunPlan = await readFile(result.files.liveRunPlan as string, "utf8");
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
        "Exported dashboard recording JSON and CSV, if captured from the browser",
        "Final live run sheet from qa/live-run-plan.txt",
        "Final local rehearsal report from qa/final-report.md"
      ],
      files: {
        finalQaReportMarkdown: result.files.finalQaReportMarkdown,
        finalQaReportJson: result.files.finalQaReportJson,
        liveRunPlan: result.files.liveRunPlan
      }
    });
    expect(formatSubmissionBundleResult(result)).toContain("Final QA report:");
    expect(formatSubmissionBundleResult(result)).toContain("Live run plan:");
  });

  it("flags a partial live run sheet in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const outputDir = path.join(baseDir, "bundle-partial-plan");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      "Platform requirement: at least one live connector\nlive proof gate: npm run proof:gate -- --allow-partial\n",
      "utf8"
    );

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: liveRunPlanDir,
      liveRunPlanDir
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
    const outputDir = path.join(baseDir, "bundle-stale-qa");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(
      path.join(finalQaReportDir, "final-report.json"),
      JSON.stringify(createFinalQaReport({ commit: "stale123" })),
      "utf8"
    );

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir,
      liveRunPlanDir: finalQaReportDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues.some((issue) => issue.includes("was generated for commit stale123"))).toBe(true);
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

function createFinalQaReport({ commit = currentCommit() } = {}) {
  return {
    status: "passed",
    repo: {
      commit
    }
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}
