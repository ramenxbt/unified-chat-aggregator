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
    const visualQaDir = path.join(finalQaReportDir, "visual");
    const clipQueuePath = path.join(baseDir, "clip-queue-export.json");
    const outputDir = path.join(baseDir, "bundle");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeEvidenceCheckProof(path.join(finalQaReportDir, "evidence-check.txt"));
    await writeFile(path.join(finalQaReportDir, "final-report.md"), "# Final QA Report\n\nStatus: passed\n", "utf8");
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(finalQaReportDir, "final-readiness.txt"));
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(visualQaDir);
    await writeKickTunnelCheck(path.join(finalQaReportDir, "kick-tunnel-check.txt"));
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
    expect(result.files.evidenceCheckReport).toBeDefined();
    expect(result.files.finalQaReportMarkdown).toBeDefined();
    expect(result.files.finalQaReportJson).toBeDefined();
    expect(result.files.finalReadinessReport).toBeDefined();
    expect(result.files.liveRunPlan).toBeDefined();
    expect(result.files.obsHandoffMarkdown).toBeDefined();
    expect(result.files.obsHandoffJson).toBeDefined();
    expect(result.files.visualQaManifestMarkdown).toBeDefined();
    expect(result.files.visualQaManifestJson).toBeDefined();
    expect(result.files.kickTunnelCheck).toBeDefined();
    expect(result.files.clipQueueJson).toBeDefined();
    const evidenceCheckReport = await readFile(result.files.evidenceCheckReport as string, "utf8");
    const finalQaReport = await readFile(result.files.finalQaReportMarkdown as string, "utf8");
    const finalQaReportJson = JSON.parse(await readFile(result.files.finalQaReportJson as string, "utf8"));
    const finalReadinessReport = await readFile(result.files.finalReadinessReport as string, "utf8");
    const liveRunPlan = await readFile(result.files.liveRunPlan as string, "utf8");
    const obsHandoffMarkdown = await readFile(result.files.obsHandoffMarkdown as string, "utf8");
    const obsHandoffJson = JSON.parse(await readFile(result.files.obsHandoffJson as string, "utf8"));
    const visualQaManifestMarkdown = await readFile(result.files.visualQaManifestMarkdown as string, "utf8");
    const visualQaManifestJson = JSON.parse(await readFile(result.files.visualQaManifestJson as string, "utf8"));
    const kickTunnelCheck = await readFile(result.files.kickTunnelCheck as string, "utf8");
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
    expect(submissionNotes).toContain("Saved evidence check proof from qa/evidence-check.txt");
    expect(submissionNotes).toContain("Visual QA manifest from qa/visual/manifest.md");
    expect(submissionNotes).toContain("## Clip Queue");
    expect(submissionNotes).toContain("- Clips marked: 2");
    expect(submissionNotes).toContain("- KICK (MARKETBUBBLE)");
    expect(submissionNotes).toContain("- kick: 1 events");
    expect(submissionNotes).toContain("- KICK (MARKETBUBBLE)");
    expect(evidenceCheckReport).toContain("Evidence check: ready");
    expect(finalQaReport).toContain("Status: passed");
    expect(finalQaReportJson).toMatchObject({
      status: "passed",
      repo: {
        commit: expect.any(String)
      }
    });
    expect(finalReadinessReport).toContain("Final recording readiness: ready");
    expect(finalReadinessReport).toContain(`Repo commit: ${currentCommit()}`);
    expect(finalReadinessReport).toContain("Checked at: 2026-06-08T16:00:00.000Z");
    expect(liveRunPlan).toContain("Live preflight: ready");
    expect(obsHandoffMarkdown).toContain("OBS Browser Source Handoff");
    expect(obsHandoffJson.sources[0]).toMatchObject({
      name: "Unified Chat - All Sources",
      url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14"
    });
    expect(visualQaManifestMarkdown).toContain("Visual QA Manifest");
    expect(visualQaManifestJson.repo.commit).toBe(currentCommit());
    expect(kickTunnelCheck).toContain("Kick tunnel: ready");
    expect(kickTunnelCheck).toContain(`Repo commit: ${currentCommit()}`);
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
        "Saved evidence check proof from qa/evidence-check.txt",
        "Final live run sheet from qa/live-run-plan.txt",
        "Final readiness proof from qa/final-readiness.txt",
        "OBS browser source handoff from qa/obs/obs-browser-sources.md",
        "Final local rehearsal report from qa/final-report.md",
        "Visual QA manifest from qa/visual/manifest.md",
        "Kick tunnel health proof from qa/kick-tunnel-check.txt"
      ],
      clipQueue: {
        clipCount: 2,
        sourceLabels: ["KICK (MARKETBUBBLE)", "TWITCH (ANSEM)"]
      },
      files: {
        evidenceCheckReport: result.files.evidenceCheckReport,
        finalQaReportMarkdown: result.files.finalQaReportMarkdown,
        finalQaReportJson: result.files.finalQaReportJson,
        finalReadinessReport: result.files.finalReadinessReport,
        liveRunPlan: result.files.liveRunPlan,
        obsHandoffMarkdown: result.files.obsHandoffMarkdown,
        obsHandoffJson: result.files.obsHandoffJson,
        visualQaManifestMarkdown: result.files.visualQaManifestMarkdown,
        visualQaManifestJson: result.files.visualQaManifestJson,
        kickTunnelCheck: result.files.kickTunnelCheck,
        clipQueueJson: result.files.clipQueueJson
      }
    });
    expect(formatSubmissionBundleResult(result)).toContain("Evidence check proof:");
    expect(formatSubmissionBundleResult(result)).toContain("Final QA report:");
    expect(formatSubmissionBundleResult(result)).toContain("Final readiness report:");
    expect(formatSubmissionBundleResult(result)).toContain("Live run plan:");
    expect(formatSubmissionBundleResult(result)).toContain("OBS handoff:");
    expect(formatSubmissionBundleResult(result)).toContain("Visual QA manifest:");
    expect(formatSubmissionBundleResult(result)).toContain("Kick tunnel proof:");
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

  it("uses qaDir as the default source for final evidence artifacts", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "final qa");
    const outputDir = path.join(baseDir, "bundle-custom-qa");
    await mkdir(qaDir, { recursive: true });
    await writeEvidenceCheckProof(path.join(qaDir, "evidence-check.txt"));
    await writeFile(path.join(qaDir, "final-report.md"), "# Final QA Report\n\nStatus: passed\n", "utf8");
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(qaDir, "final-readiness.txt"));
    await writeFile(
      path.join(qaDir, "live-run-plan.txt"),
      createLiveRunPlan(undefined, undefined, undefined, undefined, undefined, defaultSubmissionBundleCommandForQa(qaDir)),
      "utf8"
    );
    await writeObsHandoff(path.join(qaDir, "obs"));
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir
    });

    expect(result.ok).toBe(true);
    expect(result.files.evidenceCheckReport).toBe(path.join(outputDir, "evidence-check.txt"));
    expect(result.files.finalQaReportJson).toBe(path.join(outputDir, "final-qa-report.json"));
    expect(result.files.finalReadinessReport).toBe(path.join(outputDir, "final-readiness.txt"));
    expect(result.files.liveRunPlan).toBe(path.join(outputDir, "live-run-plan.txt"));
    expect(result.files.obsHandoffJson).toBe(path.join(outputDir, "obs-browser-sources.json"));
    expect(result.files.visualQaManifestJson).toBe(path.join(outputDir, "visual-qa-manifest.json"));
    expect(result.files.kickTunnelCheck).toBe(path.join(outputDir, "kick-tunnel-check.txt"));
  });

  it("uses an explicit evidence proof path when provided", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "qa");
    const evidenceCheckPath = path.join(baseDir, "custom evidence", "proof.txt");
    const outputDir = path.join(baseDir, "bundle-custom-evidence-proof");
    await mkdir(path.dirname(evidenceCheckPath), { recursive: true });
    await mkdir(qaDir, { recursive: true });
    await writeEvidenceCheckProof(evidenceCheckPath);
    await writeFile(path.join(qaDir, "final-report.md"), "# Final QA Report\n\nStatus: passed\n", "utf8");
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(qaDir, "final-readiness.txt"));
    await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(path.join(qaDir, "obs"));
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir,
      evidenceCheckPath
    });

    expect(result.ok).toBe(true);
    expect(result.files.evidenceCheckReport).toBe(path.join(outputDir, "evidence-check.txt"));
    expect(await readFile(result.files.evidenceCheckReport as string, "utf8")).toContain("Evidence check: ready");
  });

  it("flags a partial live run sheet in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const liveRunPlanDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(liveRunPlanDir, "obs");
    const outputDir = path.join(baseDir, "bundle-partial-plan");
    await mkdir(liveRunPlanDir, { recursive: true });
    await writeEvidenceCheckProof(path.join(liveRunPlanDir, "evidence-check.txt"));
    await writeFile(path.join(liveRunPlanDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(liveRunPlanDir, "final-readiness.txt"));
    await writeFile(
      path.join(liveRunPlanDir, "live-run-plan.txt"),
      createLiveRunPlan("Platform requirement: at least one live connector\nlive proof gate: npm run proof:gate -- --allow-partial\n"),
      "utf8"
    );
    await writeObsHandoff(obsHandoffDir);
    await writeKickTunnelCheck(path.join(liveRunPlanDir, "kick-tunnel-check.txt"));

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

  it("flags a stale final readiness proof when it is bundled", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(qaDir, "obs");
    const outputDir = path.join(baseDir, "bundle-stale-readiness");
    await mkdir(qaDir, { recursive: true });
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(qaDir, "final-readiness.txt"), { commit: "stale123" });
    await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      `qa/final-readiness.txt was generated for commit stale123, but current commit is ${currentCommit()}; rerun npm run live:ready -- --out qa/final-readiness.txt`
    );
  });

  it("requires saved evidence proof for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(qaDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-evidence-proof");
    await mkdir(qaDir, { recursive: true });
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(qaDir, "final-readiness.txt"));
    await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/evidence-check.txt is missing; run npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt before creating the final bundle"
    );
  });

  it("flags non-ready saved evidence proof in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(qaDir, "obs");
    const outputDir = path.join(baseDir, "bundle-bad-evidence-proof");
    await mkdir(qaDir, { recursive: true });
    await writeFile(path.join(qaDir, "evidence-check.txt"), "Evidence check: needs attention\n", "utf8");
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFinalReadinessProof(path.join(qaDir, "final-readiness.txt"));
    await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/evidence-check.txt does not say Evidence check: ready; rerun npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt"
    );
    expect(result.artifactIssues).toContain(
      "qa/evidence-check.txt is missing throughput or latency metrics; rerun npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt"
    );
  });

  it("requires a final readiness proof for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const qaDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(qaDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-readiness");
    await mkdir(qaDir, { recursive: true });
    await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(path.join(qaDir, "visual"));
    await writeKickTunnelCheck(path.join(qaDir, "kick-tunnel-check.txt"));

    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      qaDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/final-readiness.txt is missing; run npm run live:ready -- --out qa/final-readiness.txt before creating the final bundle"
    );
  });

  it("requires a Kick tunnel proof for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-missing-kick-tunnel");
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
      obsHandoffDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      "qa/kick-tunnel-check.txt is missing; run npm run live:tunnel -- --out qa/kick-tunnel-check.txt after the capture stack starts"
    );
  });

  it("flags stale Kick tunnel proof in a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const outputDir = path.join(baseDir, "bundle-stale-kick-tunnel");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeKickTunnelCheck(path.join(finalQaReportDir, "kick-tunnel-check.txt"), { commit: "stale123" });

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
      `qa/kick-tunnel-check.txt was generated for commit stale123, but current commit is ${currentCommit()}; rerun npm run live:tunnel -- --out qa/kick-tunnel-check.txt`
    );
  });

  it("requires a final QA report for a strict final bundle", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const outputDir = path.join(baseDir, "bundle-missing-qa");
    const missingQaDir = path.join(baseDir, "missing-qa");
    const result = await createSubmissionBundle({
      archiveDir,
      databasePath,
      outputDir,
      finalQaReportDir: missingQaDir,
      liveRunPlanDir: missingQaDir
    });

    expect(result.ok).toBe(false);
    expect(result.artifactIssues).toContain(
      `${path.join(missingQaDir, "final-report.json")} is missing; run npm run qa:final before creating the final bundle`
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
      createLiveRunPlan("Live preflight: ready\n", currentCommit(), undefined, defaultProofGateCommand(), null, null, undefined, undefined, null),
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
      "qa/live-run-plan.txt is missing the submission finalize command; rerun live:prepare -- --out qa/live-run-plan.txt"
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
    const missingObsDir = path.join(baseDir, "missing-obs");
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
      obsHandoffDir: missingObsDir
    });

    expect(result.ok).toBe(false);
    const missingObsIssues = result.artifactIssues.filter((issue) => issue.includes("missing-obs/obs-browser-sources"));
    expect(missingObsIssues.some((issue) => issue.includes("missing-obs/obs-browser-sources.md is missing"))).toBe(true);
    expect(missingObsIssues.some((issue) => issue.includes("missing-obs/obs-browser-sources.json is missing"))).toBe(true);
    expect(missingObsIssues.every((issue) => issue.includes("npm run obs:handoff -- --out"))).toBe(true);
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
      "qa/obs/obs-browser-sources.json all-source URL http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14 does not match the live run sheet http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14; rerun npm run obs:handoff -- --out qa/obs with the same app port"
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

  it("flags visual QA manifests generated from a stale commit", async () => {
    const { archiveDir, databasePath, baseDir } = await createBundleFixture();
    const finalQaReportDir = path.join(baseDir, "qa");
    const obsHandoffDir = path.join(finalQaReportDir, "obs");
    const visualQaDir = path.join(finalQaReportDir, "visual");
    const outputDir = path.join(baseDir, "bundle-stale-visual");
    await mkdir(finalQaReportDir, { recursive: true });
    await writeFile(path.join(finalQaReportDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
    await writeFile(path.join(finalQaReportDir, "live-run-plan.txt"), createLiveRunPlan(), "utf8");
    await writeObsHandoff(obsHandoffDir);
    await writeVisualQaManifest(visualQaDir, createVisualQaManifestJson({ commit: "stale123" }));

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
      `qa/visual/manifest.json was generated for commit stale123, but current commit is ${currentCommit()}; rerun npm run qa:visual`
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
  dashboardCommand: string | null = defaultDashboardCommand(),
  submissionFinalizeCommand: string | null = defaultSubmissionFinalizeCommand()
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
    if (!proofGateCommand && !evidenceCheckCommand && !submissionFinalizeCommand) lines.push("", "Evidence outputs:");
    if (submissionFinalizeCommand) lines.push(`  submission finalize: ${submissionFinalizeCommand}`);
    lines.push(`  submission bundle: ${submissionBundleCommand}`);
  } else if (submissionFinalizeCommand) {
    if (!proofGateCommand && !evidenceCheckCommand) lines.push("", "Evidence outputs:");
    lines.push(`  submission finalize: ${submissionFinalizeCommand}`);
  }

  return lines.join("\n");
}

function defaultProofGateCommand() {
  return "npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000 --timeout-ms 120000 --interval-ms 1000";
}

function defaultEvidenceCheckCommand() {
  return "npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt";
}

function defaultSubmissionBundleCommand() {
  return "npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt";
}

function defaultSubmissionFinalizeCommand() {
  return "npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt";
}

function defaultSubmissionBundleCommandForQa(qaDir: string) {
  return `npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir '${qaDir}' --kick-tunnel-check '${path.join(
    qaDir,
    "kick-tunnel-check.txt"
  )}'`;
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

async function writeVisualQaManifest(visualQaDir: string, json: unknown = createVisualQaManifestJson()) {
  await mkdir(visualQaDir, { recursive: true });
  await writeFile(path.join(visualQaDir, "manifest.md"), "# Visual QA Manifest\n", "utf8");
  await writeFile(path.join(visualQaDir, "manifest.json"), JSON.stringify(json), "utf8");
}

async function writeFinalReadinessProof(filePath: string, { commit = currentCommit(), ready = true } = {}) {
  await writeFile(
    filePath,
    [
      `Final recording readiness: ${ready ? "ready" : "needs setup"}`,
      `Repo commit: ${commit}`,
      "Checked at: 2026-06-08T16:00:00.000Z"
    ].join("\n"),
    "utf8"
  );
}

async function writeEvidenceCheckProof(filePath: string) {
  await writeFile(
    filePath,
    [
      "Evidence check: ready",
      "Session: 2026-06-04T23-00-00-000Z-connectors",
      "Mode: connectors",
      "Archive: data/feed-sessions/2026-06-04T23-00-00-000Z-connectors",
      "Events: 3",
      "Statuses: 3",
      "Duration: 10s",
      "Throughput: 0.3 events/s",
      "Average latency: 100ms",
      "P95 latency: 150ms"
    ].join("\n"),
    "utf8"
  );
}

async function writeKickTunnelCheck(filePath: string, { commit = currentCommit(), ready = true } = {}) {
  await writeFile(
    filePath,
    [
      `Kick tunnel: ${ready ? "ready" : "needs setup"}`,
      "URL: https://market-bubble-tunnel.example/webhooks/kick",
      `Repo commit: ${commit}`,
      "Checked at: 2026-06-08T00:00:00.000Z",
      ready ? "Kick tunnel reaches the local receiver at /webhooks/kick." : "KICK_WEBHOOK_PUBLIC_URL is not configured."
    ].join("\n"),
    "utf8"
  );
}

function createVisualQaManifestJson({ commit = currentCommit() } = {}) {
  return {
    repo: {
      commit
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
