import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { archiveRecordingToCsv, readArchiveRecording } from "./exportFeedArchive";
import { buildEvidenceReport, formatEvidenceReport, type EvidenceReport } from "./evidenceReport";
import { resolveArchivePath } from "./feedArchiveLookup";
import { clipItemSchema } from "../domain/clipQueue";
import { formatPlatformSourceLabel } from "../domain/unifiedEvent";
import { readOptionalArgValue } from "./liveCliArgs";
import {
  checkCurrentRepoHygiene,
  checkFinalQaFreshness,
  readCurrentTrackedChanges,
  type ReadCurrentTrackedChanges
} from "./finalQaFreshness";
import { checkVisualQaFreshness } from "./visualQaFreshness";

export type SubmissionBundleOptions = {
  archivePath?: string;
  archiveDir?: string;
  databasePath?: string;
  outputDir: string;
  requireAllPlatforms?: boolean;
  qaDir?: string;
  finalQaReportDir?: string;
  evidenceCheckPath?: string;
  liveRunPlanDir?: string;
  obsHandoffDir?: string;
  visualQaDir?: string;
  kickTunnelCheckPath?: string;
  clipQueuePath?: string;
  currentTrackedChanges?: ReadCurrentTrackedChanges;
  requireCleanRepo?: boolean;
};

export type SubmissionBundleResult = {
  ok: boolean;
  outputDir: string;
  files: {
    evidenceReport: string;
    replayJson: string;
    replayCsv: string;
    submissionNotes: string;
    summary: string;
    evidenceCheckReport?: string;
    finalQaReportMarkdown?: string;
    finalQaReportJson?: string;
    finalReadinessReport?: string;
    liveRunPlan?: string;
    partialLiveRunPlan?: string;
    obsHandoffMarkdown?: string;
    obsHandoffJson?: string;
    visualQaManifestMarkdown?: string;
    visualQaManifestJson?: string;
    kickTunnelCheck?: string;
    clipQueueJson?: string;
  };
  evidence: EvidenceReport;
  artifactIssues: string[];
};

const clipQueueExportSchema = z.object({
  exportedAt: z.string().datetime(),
  source: z.string(),
  transportState: z.string(),
  clipCount: z.number().int().nonnegative(),
  clips: z.array(clipItemSchema)
});

const requiredFinalReadinessChecks = [
  "Current repo state",
  "Strict connector preflight",
  "Target source labels",
  "Final QA report",
  "Visual QA manifest",
  "Final live run sheet",
  "OBS handoff"
];

const requiredFinalReadinessCommandChecks: Array<[label: string, pattern: RegExp]> = [
  ["live prepare", /npm run live:prepare --/],
  ["OBS handoff", /npm run obs:handoff --/],
  ["Kick tunnel check", /npm run live:tunnel -- --out/],
  ["proof gate", /npm run proof:gate --/],
  ["submission finalize", /npm run submission:finalize --/],
  ["submission bundle", /npm run submission:bundle --/],
  ["final capture stack", /npm run live:stack --[^\n]*--require-ready[^\n]*--with-proof-gate/]
];

type ClipQueueSummary = {
  clipCount: number;
  sourceLabels: string[];
};

export async function createSubmissionBundle(options: SubmissionBundleOptions): Promise<SubmissionBundleResult> {
  const archivePath = await resolveArchivePath(options);
  const evidence = await buildEvidenceReport({
    archivePath,
    databasePath: options.databasePath,
    requireAllPlatforms: options.requireAllPlatforms
  });
  const recording = await readArchiveRecording(archivePath);
  const repo = collectRepoMetadata();
  const externalArtifacts = buildExternalArtifactChecklist();
  const bundleDir = path.resolve(options.outputDir);
  const qaDir = options.qaDir ?? "qa";
  const finalQaReportDir = options.finalQaReportDir ?? qaDir;
  const evidenceCheckReport = await findEvidenceCheckReport(finalQaReportDir, bundleDir, options.evidenceCheckPath);
  const finalQaReports = await findFinalQaReports(finalQaReportDir, bundleDir);
  const finalReadinessReport = await findFinalReadinessReport(finalQaReportDir, bundleDir);
  const liveRunPlans = await findLiveRunPlans(options.liveRunPlanDir ?? qaDir, bundleDir);
  const obsHandoff = await findObsHandoff(options.obsHandoffDir ?? path.join(qaDir, "obs"), bundleDir);
  const visualQaManifest = await findVisualQaManifest(options.visualQaDir ?? path.join(finalQaReportDir, "visual"), bundleDir);
  const kickTunnelCheck = await findKickTunnelCheck(options.kickTunnelCheckPath ?? path.join(finalQaReportDir, "kick-tunnel-check.txt"), bundleDir);
  const clipQueue = await findClipQueue(options.clipQueuePath, bundleDir);
  const clipQueueValidation = await validateClipQueue(clipQueue);
  const requireAllPlatforms = options.requireAllPlatforms ?? true;
  const artifactIssues = [
    ...(requireAllPlatforms && options.requireCleanRepo ? validateCurrentRepoState(options.currentTrackedChanges) : []),
    ...(await validateCopiedArtifacts(
      evidenceCheckReport,
      finalQaReports,
      finalReadinessReport,
      liveRunPlans,
      obsHandoff,
      visualQaManifest,
      kickTunnelCheck,
      requireAllPlatforms,
      repo
    )),
    ...clipQueueValidation.issues
  ];
  const bundleReady = evidence.ok && artifactIssues.length === 0;
  const files = {
    evidenceReport: path.join(bundleDir, "evidence-report.txt"),
    replayJson: path.join(bundleDir, "replay.json"),
    replayCsv: path.join(bundleDir, "replay.csv"),
    submissionNotes: path.join(bundleDir, "submission-notes.md"),
    summary: path.join(bundleDir, "summary.json"),
    ...evidenceCheckReport.files,
    ...finalQaReports.files,
    ...finalReadinessReport.files,
    ...liveRunPlans.files,
    ...obsHandoff.files,
    ...visualQaManifest.files,
    ...kickTunnelCheck.files,
    ...clipQueue.files
  };

  await mkdir(bundleDir, { recursive: true });
  await Promise.all([
    writeFile(files.evidenceReport, `${formatEvidenceReport(evidence)}\n`, "utf8"),
    writeFile(files.replayJson, `${JSON.stringify(recording, null, 2)}\n`, "utf8"),
    writeFile(files.replayCsv, archiveRecordingToCsv(recording), "utf8"),
    writeFile(
      files.submissionNotes,
      `${formatSubmissionNotes(evidence, repo, externalArtifacts, artifactIssues, clipQueueValidation.summary)}\n`,
      "utf8"
    ),
    writeFile(
      files.summary,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          ok: bundleReady,
          status: bundleReady ? "ready" : "needs_attention",
          archivePath,
          databasePath: options.databasePath,
          repo,
          evidenceOk: evidence.ok,
          sessionId: evidence.sessionId,
          mode: evidence.mode,
          eventCount: evidence.eventCount,
          statusCount: evidence.statusCount,
          platforms: evidence.platforms,
          statusPlatforms: evidence.statusPlatforms,
          sourceLabels: evidence.sourceLabels,
          performance: evidence.performance,
          clipQueue: clipQueueValidation.summary,
          externalArtifacts,
          artifactIssues,
          files
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    ...evidenceCheckReport.copyTasks.map((copyTask) => copyTask()),
    ...finalQaReports.copyTasks.map((copyTask) => copyTask()),
    ...finalReadinessReport.copyTasks.map((copyTask) => copyTask()),
    ...liveRunPlans.copyTasks.map((copyTask) => copyTask()),
    ...obsHandoff.copyTasks.map((copyTask) => copyTask()),
    ...visualQaManifest.copyTasks.map((copyTask) => copyTask()),
    ...kickTunnelCheck.copyTasks.map((copyTask) => copyTask()),
    ...clipQueue.copyTasks.map((copyTask) => copyTask())
  ]);

  return {
    ok: bundleReady,
    outputDir: bundleDir,
    files,
    evidence,
    artifactIssues
  };
}

function validateCurrentRepoState(readTrackedChanges: ReadCurrentTrackedChanges = readCurrentTrackedChanges) {
  const trackedChanges = readTrackedChanges();

  return trackedChanges.length > 0
    ? [`Current tracked files are dirty; commit or stash before creating the final bundle: ${trackedChanges.slice(0, 3).join(", ")}`]
    : [];
}

export function formatSubmissionBundleResult(result: SubmissionBundleResult) {
  const lines = [
    `Submission bundle: ${result.ok ? "ready" : "needs attention"}`,
    `Output: ${result.outputDir}`,
    `Evidence report: ${result.files.evidenceReport}`,
    `Replay JSON: ${result.files.replayJson}`,
    `Replay CSV: ${result.files.replayCsv}`,
    `Submission notes: ${result.files.submissionNotes}`,
    `Summary: ${result.files.summary}`,
    ...(result.files.evidenceCheckReport ? [`Evidence check proof: ${result.files.evidenceCheckReport}`] : []),
    ...(result.files.finalQaReportMarkdown ? [`Final QA report: ${result.files.finalQaReportMarkdown}`] : []),
    ...(result.files.finalQaReportJson ? [`Final QA JSON: ${result.files.finalQaReportJson}`] : []),
    ...(result.files.finalReadinessReport ? [`Final readiness report: ${result.files.finalReadinessReport}`] : []),
    ...(result.files.liveRunPlan ? [`Live run plan: ${result.files.liveRunPlan}`] : []),
    ...(result.files.partialLiveRunPlan ? [`Partial live run plan: ${result.files.partialLiveRunPlan}`] : []),
    ...(result.files.obsHandoffMarkdown ? [`OBS handoff: ${result.files.obsHandoffMarkdown}`] : []),
    ...(result.files.obsHandoffJson ? [`OBS handoff JSON: ${result.files.obsHandoffJson}`] : []),
    ...(result.files.visualQaManifestMarkdown ? [`Visual QA manifest: ${result.files.visualQaManifestMarkdown}`] : []),
    ...(result.files.visualQaManifestJson ? [`Visual QA manifest JSON: ${result.files.visualQaManifestJson}`] : []),
    ...(result.files.kickTunnelCheck ? [`Kick tunnel proof: ${result.files.kickTunnelCheck}`] : []),
    ...(result.files.clipQueueJson ? [`Clip queue JSON: ${result.files.clipQueueJson}`] : [])
  ];

  const issues = [...result.evidence.issues, ...result.artifactIssues];

  if (issues.length > 0) {
    lines.push("", "Issues:", ...issues.map((issue) => `  ${issue}`));
  }

  return lines.join("\n");
}

export function formatSubmissionNotes(
  evidence: EvidenceReport,
  repo = collectRepoMetadata(),
  externalArtifacts = buildExternalArtifactChecklist(),
  artifactIssues: string[] = [],
  clipQueue?: ClipQueueSummary
) {
  const ready = evidence.ok && artifactIssues.length === 0;
  const lines = [
    "# Unified Chat Aggregator Submission Notes",
    "",
    `Status: ${ready ? "ready" : "needs attention"}`,
    `Session: ${evidence.sessionId}`,
    `Mode: ${evidence.mode}`,
    `Repo commit: ${repo.commit ?? "unknown"}`,
    `Repo remote: ${repo.remote ?? "unknown"}`,
    "",
    "## Proof Metrics",
    "",
    `- Events captured: ${evidence.eventCount}`,
    `- Connector status samples: ${evidence.statusCount}`,
    `- Duration: ${formatNumber(evidence.performance.durationSeconds)}s`,
    `- Throughput: ${formatNumber(evidence.performance.eventsPerSecond)} events/s`,
    `- Average latency: ${formatNumber(evidence.performance.averageLatencyMs)}ms`,
    `- P95 latency: ${formatNumber(evidence.performance.p95LatencyMs)}ms`,
    "",
    "## Platform Coverage",
    "",
    ...(["twitch", "kick", "x"] as const).map((platform) => `- ${platform}: ${evidence.platforms[platform]} events`),
    "",
    "## Source Labels",
    "",
    ...(evidence.sourceLabels.length > 0
      ? evidence.sourceLabels.map((label) => `- ${label}`)
      : ["- No source labels captured"]),
    ...(clipQueue
      ? [
          "",
          "## Clip Queue",
          "",
          `- Clips marked: ${clipQueue.clipCount}`,
          ...(clipQueue.sourceLabels.length > 0
            ? clipQueue.sourceLabels.map((label) => `- ${label}`)
            : ["- No clip source labels captured"])
        ]
      : []),
    "",
    "## Evidence Files",
    "",
    `- Archive: ${evidence.archivePath}`,
    evidence.databasePath ? `- Database: ${evidence.databasePath}` : "- Database: not provided",
    "",
    "## External Artifacts To Attach",
    "",
    ...externalArtifacts.map((artifact) => `- [ ] ${artifact}`)
  ];

  if (evidence.issues.length > 0) {
    lines.push("", "## Issues", "", ...evidence.issues.map((issue) => `- ${issue}`));
  }

  if (artifactIssues.length > 0) {
    lines.push("", "## Artifact Issues", "", ...artifactIssues.map((issue) => `- ${issue}`));
  }

  return lines.join("\n");
}

function collectRepoMetadata() {
  return {
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    remote: runGit(["remote", "get-url", "origin"])
  };
}

function runGit(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function buildExternalArtifactChecklist() {
  return [
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
  ];
}

async function findEvidenceCheckReport(reportDir: string, bundleDir: string, evidenceCheckPath?: string) {
  if (evidenceCheckPath) {
    const sourcePath = path.resolve(evidenceCheckPath);
    const targetPath = path.join(bundleDir, "evidence-check.txt");

    if (!(await pathExists(sourcePath))) {
      return {
        files: {} as Record<string, string>,
        sourceFiles: {} as Record<string, string>,
        expectedFiles: { evidenceCheckReport: sourcePath },
        copyTasks: [] as Array<() => Promise<void>>
      };
    }

    return {
      files: { evidenceCheckReport: targetPath },
      sourceFiles: { evidenceCheckReport: sourcePath },
      expectedFiles: { evidenceCheckReport: sourcePath },
      copyTasks: [() => copyFile(sourcePath, targetPath)]
    };
  }

  return findOptionalFiles(reportDir, bundleDir, [["evidence-check.txt", "evidence-check.txt", "evidenceCheckReport"]]);
}

async function findFinalQaReports(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["final-report.md", "final-qa-report.md", "finalQaReportMarkdown"],
    ["final-report.json", "final-qa-report.json", "finalQaReportJson"]
  ]);
}

async function findFinalReadinessReport(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [["final-readiness.txt", "final-readiness.txt", "finalReadinessReport"]]);
}

async function findLiveRunPlans(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["live-run-plan.txt", "live-run-plan.txt", "liveRunPlan"],
    ["live-run-plan.partial.txt", "live-run-plan.partial.txt", "partialLiveRunPlan"]
  ]);
}

async function findObsHandoff(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["obs-browser-sources.md", "obs-browser-sources.md", "obsHandoffMarkdown"],
    ["obs-browser-sources.json", "obs-browser-sources.json", "obsHandoffJson"]
  ]);
}

async function findVisualQaManifest(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["manifest.md", "visual-qa-manifest.md", "visualQaManifestMarkdown"],
    ["manifest.json", "visual-qa-manifest.json", "visualQaManifestJson"]
  ]);
}

async function findKickTunnelCheck(sourcePath: string, bundleDir: string) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const targetPath = path.join(bundleDir, "kick-tunnel-check.txt");

  if (!(await pathExists(resolvedSourcePath))) {
    return {
      files: {} as Record<string, string>,
      sourceFiles: { kickTunnelCheck: resolvedSourcePath },
      copyTasks: [] as Array<() => Promise<void>>
    };
  }

  return {
    files: { kickTunnelCheck: targetPath },
    sourceFiles: { kickTunnelCheck: resolvedSourcePath },
    copyTasks: [() => copyFile(resolvedSourcePath, targetPath)]
  };
}

async function findClipQueue(clipQueuePath: string | undefined, bundleDir: string) {
  if (!clipQueuePath) {
    return {
      files: {} as Record<string, string>,
      sourceFiles: {} as Record<string, string>,
      copyTasks: [] as Array<() => Promise<void>>
    };
  }

  const sourcePath = path.resolve(clipQueuePath);
  const targetPath = path.join(bundleDir, "clip-queue.json");

  if (!(await pathExists(sourcePath))) {
    return {
      files: {} as Record<string, string>,
      sourceFiles: { clipQueueJson: sourcePath },
      copyTasks: [] as Array<() => Promise<void>>
    };
  }

  return {
    files: { clipQueueJson: targetPath },
    sourceFiles: { clipQueueJson: sourcePath },
    copyTasks: [() => copyFile(sourcePath, targetPath)]
  };
}

async function findOptionalFiles(
  sourceDir: string,
  bundleDir: string,
  candidates: Array<[sourceName: string, targetName: string, key: string]>
) {
  const files: Record<string, string> = {};
  const sourceFiles: Record<string, string> = {};
  const expectedFiles: Record<string, string> = {};
  const copyTasks: Array<() => Promise<void>> = [];

  for (const [sourceName, targetName, key] of candidates) {
    const sourcePath = path.resolve(sourceDir, sourceName);
    const targetPath = path.join(bundleDir, targetName);
    expectedFiles[key] = sourcePath;

    if (await pathExists(sourcePath)) {
      files[key] = targetPath;
      sourceFiles[key] = sourcePath;
      copyTasks.push(() => copyFile(sourcePath, targetPath));
    }
  }

  return { files, sourceFiles, expectedFiles, copyTasks };
}

async function validateClipQueue(clipQueue: Awaited<ReturnType<typeof findClipQueue>>) {
  if (!clipQueue.sourceFiles.clipQueueJson) {
    return { issues: [], summary: undefined };
  }

  if (!clipQueue.files.clipQueueJson) {
    return {
      issues: [`clip queue JSON ${clipQueue.sourceFiles.clipQueueJson} is missing; export the clip queue from the dashboard first`],
      summary: undefined
    };
  }

  try {
    const parsed = clipQueueExportSchema.parse(JSON.parse(await readFile(clipQueue.sourceFiles.clipQueueJson, "utf8")));
    const sourceLabels = [...new Set(parsed.clips.map((clip) => formatPlatformSourceLabel(clip.event)))].sort();

    if (parsed.clipCount !== parsed.clips.length) {
      return {
        issues: [`clip queue JSON clipCount ${parsed.clipCount} does not match ${parsed.clips.length} clips`],
        summary: undefined
      };
    }

    return {
      issues: [],
      summary: {
        clipCount: parsed.clips.length,
        sourceLabels
      }
    };
  } catch {
    return {
      issues: [`clip queue JSON ${clipQueue.sourceFiles.clipQueueJson} could not be parsed; export it again from the dashboard`],
      summary: undefined
    };
  }
}

async function validateCopiedArtifacts(
  evidenceCheckReport: Awaited<ReturnType<typeof findEvidenceCheckReport>>,
  finalQaReports: Awaited<ReturnType<typeof findFinalQaReports>>,
  finalReadinessReport: Awaited<ReturnType<typeof findFinalReadinessReport>>,
  liveRunPlans: Awaited<ReturnType<typeof findLiveRunPlans>>,
  obsHandoff: Awaited<ReturnType<typeof findObsHandoff>>,
  visualQaManifest: Awaited<ReturnType<typeof findVisualQaManifest>>,
  kickTunnelCheck: Awaited<ReturnType<typeof findKickTunnelCheck>>,
  requireAllPlatforms: boolean,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  if (!requireAllPlatforms) {
    return [];
  }

  const issues: string[] = [];
  const liveRunPlanValidation = await validateLiveRunPlan(liveRunPlans, repo);

  issues.push(...(await validateEvidenceCheckReport(evidenceCheckReport)));
  issues.push(...(await validateFinalQaReport(finalQaReports, repo)));
  issues.push(...(await validateFinalReadinessReport(finalReadinessReport, repo)));
  issues.push(...liveRunPlanValidation.issues);
  issues.push(...(await validateObsHandoff(obsHandoff, liveRunPlanValidation.expectedObsAllSourcesUrl, repo)));
  issues.push(...(await validateVisualQaManifest(visualQaManifest, repo)));
  issues.push(...(await validateKickTunnelCheck(kickTunnelCheck, repo)));

  return issues;
}

async function validateEvidenceCheckReport(evidenceCheckReport: Awaited<ReturnType<typeof findEvidenceCheckReport>>) {
  const reportPath = displayPath(evidenceCheckReport.sourceFiles.evidenceCheckReport ?? evidenceCheckReport.expectedFiles.evidenceCheckReport);

  if (!evidenceCheckReport.sourceFiles.evidenceCheckReport) {
    return [
      `${reportPath} is missing; run npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out ${shellQuote(
        reportPath
      )} before creating the final bundle`
    ];
  }

  const content = await readFile(evidenceCheckReport.sourceFiles.evidenceCheckReport, "utf8");
  const issues: string[] = [];

  if (!/^Evidence check:\s*ready$/m.test(content)) {
    issues.push(
      `${reportPath} does not say Evidence check: ready; rerun npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out ${shellQuote(
        reportPath
      )}`
    );
  }

  if (!/^Throughput:\s*\S+/m.test(content) || !/^P95 latency:\s*\S+/m.test(content)) {
    issues.push(
      `${reportPath} is missing throughput or latency metrics; rerun npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out ${shellQuote(
        reportPath
      )}`
    );
  }

  return issues;
}

async function validateFinalQaReport(
  finalQaReports: Awaited<ReturnType<typeof findFinalQaReports>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  const reportPath = displayPath(finalQaReports.sourceFiles.finalQaReportJson ?? finalQaReports.expectedFiles.finalQaReportJson);

  if (!finalQaReports.sourceFiles.finalQaReportJson) {
    return [`${reportPath} is missing; run npm run qa:final before creating the final bundle`];
  }

  const issues: string[] = [];

  try {
    const report = JSON.parse(await readFile(finalQaReports.sourceFiles.finalQaReportJson, "utf8")) as {
      status?: string;
      repo?: {
        commit?: string | null;
        trackedFilesClean?: boolean;
      };
    };

    if (report.status !== "passed") {
      issues.push(`${reportPath} status is ${report.status ?? "unknown"}; rerun npm run qa:final and resolve failures`);
    }

    if (report.repo?.trackedFilesClean !== true) {
      issues.push(`${reportPath} was generated with dirty tracked files; commit or revert changes, then rerun npm run qa:final`);
    }

    const freshness = repo.commit ? checkFinalQaFreshness(report.repo?.commit, repo.commit, runGit) : null;

    if (freshness?.state === "unknown") {
      issues.push(
        `${reportPath} was generated for commit ${report.repo?.commit ?? "unknown"}, but current commit is ${repo.commit}; rerun npm run qa:final`
      );
    }

    if (freshness?.state === "stale") {
      const changedFiles = freshness.changedFiles.slice(0, 3).join(", ");
      issues.push(
        `${reportPath} was generated for commit ${report.repo?.commit ?? "unknown"}, but final-QA-relevant files changed before current commit ${repo.commit}: ${changedFiles}; rerun npm run qa:final`
      );
    }

    if (freshness?.state === "unchanged") {
      const hygiene = checkCurrentRepoHygiene();

      if (!hygiene.ok) {
        issues.push(`${reportPath} is older than the current commit and current repo hygiene failed: ${hygiene.issues.join("; ")}`);
      }
    }
  } catch {
    issues.push(`${reportPath} could not be parsed; rerun npm run qa:final before creating the final bundle`);
  }

  return issues;
}

async function validateFinalReadinessReport(
  finalReadinessReport: Awaited<ReturnType<typeof findFinalReadinessReport>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  if (!finalReadinessReport.sourceFiles.finalReadinessReport) {
    const reportPath = displayPath(
      finalReadinessReport.sourceFiles.finalReadinessReport ?? finalReadinessReport.expectedFiles.finalReadinessReport
    );

    return [
      `${reportPath} is missing; run npm run live:ready -- --out ${shellQuote(reportPath)} before creating the final bundle`
    ];
  }

  const reportPath = displayPath(finalReadinessReport.sourceFiles.finalReadinessReport);
  const content = await readFile(finalReadinessReport.sourceFiles.finalReadinessReport, "utf8");
  const commit = content.match(/^Repo commit:\s*(\S+)/m)?.[1] ?? null;
  const checkedAt = content.match(/^Checked at:\s*(\S+)/m)?.[1] ?? null;
  const issues: string[] = [];

  if (!/^Final recording readiness:\s*ready$/m.test(content)) {
    issues.push(`${reportPath} does not say Final recording readiness: ready; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
  }

  if (!commit || commit === "unknown") {
    issues.push(`${reportPath} is missing commit metadata; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
  } else if (repo.commit && commit !== repo.commit) {
    issues.push(
      `${reportPath} was generated for commit ${commit}, but current commit is ${repo.commit}; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`
    );
  }

  if (!checkedAt) {
    issues.push(`${reportPath} is missing timestamp metadata; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
  }

  for (const checkName of requiredFinalReadinessChecks) {
    if (!content.includes(`PASS ${checkName}:`)) {
      issues.push(`${reportPath} is missing PASS ${checkName}; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
    }
  }

  if (!content.includes("Required final commands:")) {
    issues.push(`${reportPath} is missing Required final commands; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
  }

  for (const [label, pattern] of requiredFinalReadinessCommandChecks) {
    if (!pattern.test(content)) {
      issues.push(`${reportPath} is missing final command ${label}; rerun npm run live:ready -- --out ${shellQuote(reportPath)}`);
    }
  }

  return issues;
}

async function validateLiveRunPlan(
  liveRunPlans: Awaited<ReturnType<typeof findLiveRunPlans>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  if (!liveRunPlans.sourceFiles.liveRunPlan) {
    return { issues: [] };
  }

  const issues: string[] = [];
  const runSheetPath = displayPath(liveRunPlans.sourceFiles.liveRunPlan);
  const liveRunPlan = await readFile(liveRunPlans.sourceFiles.liveRunPlan, "utf8");
  const commit = extractLiveRunPlanCommit(liveRunPlan);
  const expectedFeedCommand = extractLiveRunPlanFeedCommand(liveRunPlan);
  const expectedDashboardCommand = extractLiveRunPlanDashboardCommand(liveRunPlan);
  const expectedObsAllSourcesUrl = extractLiveRunPlanObsAllSourcesUrl(liveRunPlan);
  const expectedProofGateCommand = extractLiveRunPlanProofGateCommand(liveRunPlan);
  const expectedEvidenceCheckCommand = extractLiveRunPlanEvidenceCheckCommand(liveRunPlan);
  const expectedSubmissionFinalizeCommand = extractLiveRunPlanSubmissionFinalizeCommand(liveRunPlan);
  const expectedSubmissionBundleCommand = extractLiveRunPlanSubmissionBundleCommand(liveRunPlan);

  if (isPartialLiveRunPlan(liveRunPlan)) {
    issues.push(
      `${runSheetPath} was generated in partial mode; rerun live:prepare without --allow-partial for final proof`
    );
  }

  if (!commit || commit === "unknown") {
    issues.push(`${runSheetPath} is missing commit metadata; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  } else if (repo.commit && commit !== repo.commit) {
    issues.push(
      `${runSheetPath} was generated for commit ${commit}, but current commit is ${repo.commit}; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`
    );
  }

  if (!expectedObsAllSourcesUrl) {
    issues.push(`${runSheetPath} is missing the OBS all-source URL; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedFeedCommand) {
    issues.push(`${runSheetPath} is missing the feed command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedDashboardCommand) {
    issues.push(`${runSheetPath} is missing the dashboard command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedProofGateCommand) {
    issues.push(`${runSheetPath} is missing the live proof gate command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedEvidenceCheckCommand) {
    issues.push(`${runSheetPath} is missing the evidence check command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedSubmissionFinalizeCommand) {
    issues.push(`${runSheetPath} is missing the submission finalize command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!expectedSubmissionBundleCommand) {
    issues.push(`${runSheetPath} is missing the submission bundle command; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  if (!liveRunPlan.includes("Proof signal checklist:")) {
    issues.push(`${runSheetPath} is missing the proof signal checklist; rerun live:prepare -- --out ${shellQuote(runSheetPath)}`);
  }

  return {
    issues,
    expectedObsAllSourcesUrl
  };
}

function extractLiveRunPlanCommit(content: string) {
  return content.match(/^commit:\s*(\S+)/m)?.[1] ?? null;
}

function extractLiveRunPlanObsAllSourcesUrl(content: string) {
  return content.match(/^\s*OBS all sources:\s*(\S+)/m)?.[1];
}

function extractLiveRunPlanFeedCommand(content: string) {
  return content.match(/^\s*feed:\s*(.+)$/m)?.[1];
}

function extractLiveRunPlanDashboardCommand(content: string) {
  return content.match(/^\s*dashboard:\s*(.+)$/m)?.[1];
}

function extractLiveRunPlanProofGateCommand(content: string) {
  return content.match(/^\s*live proof gate:\s*(.+)$/m)?.[1];
}

function extractLiveRunPlanEvidenceCheckCommand(content: string) {
  return content.match(/^\s*evidence check:\s*(.+)$/m)?.[1];
}

function extractLiveRunPlanSubmissionBundleCommand(content: string) {
  return content.match(/^\s*submission bundle:\s*(.+)$/m)?.[1];
}

function extractLiveRunPlanSubmissionFinalizeCommand(content: string) {
  return content.match(/^\s*submission finalize:\s*(.+)$/m)?.[1];
}

function isPartialLiveRunPlan(content: string) {
  return content.includes("Platform requirement: at least one live connector") || content.includes("--allow-partial");
}

async function validateObsHandoff(
  obsHandoff: Awaited<ReturnType<typeof findObsHandoff>>,
  expectedObsAllSourcesUrl: string | undefined,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  const issues: string[] = [];
  const obsMarkdownPath = displayPath(obsHandoff.sourceFiles.obsHandoffMarkdown ?? obsHandoff.expectedFiles.obsHandoffMarkdown);
  const obsJsonPath = displayPath(obsHandoff.sourceFiles.obsHandoffJson ?? obsHandoff.expectedFiles.obsHandoffJson);
  const obsHandoffDir = displayPath(path.dirname(obsHandoff.expectedFiles.obsHandoffJson));

  if (!obsHandoff.sourceFiles.obsHandoffMarkdown) {
    issues.push(`${obsMarkdownPath} is missing; run npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)} before creating the final bundle`);
  }

  if (!obsHandoff.sourceFiles.obsHandoffJson) {
    issues.push(`${obsJsonPath} is missing; run npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)} before creating the final bundle`);
    return issues;
  }

  try {
    const handoff = JSON.parse(await readFile(obsHandoff.sourceFiles.obsHandoffJson, "utf8")) as {
      browserSourceSettings?: {
        width?: number;
        height?: number;
        fps?: number;
        customCss?: string;
      };
      sources?: Array<{
        name?: string;
        url?: string;
      }>;
      repo?: {
        commit?: string | null;
      };
    };

    if (!Array.isArray(handoff.sources) || handoff.sources.length < 3) {
      issues.push(`${obsJsonPath} does not include the expected OBS browser sources; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)}`);
    }

    const allSource = handoff.sources?.find((source) => source.name === "Unified Chat - All Sources");

    if (!allSource?.url?.includes("obs=1")) {
      issues.push(`${obsJsonPath} is missing the all-source OBS overlay URL; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)}`);
    }

    if (expectedObsAllSourcesUrl && allSource?.url && allSource.url !== expectedObsAllSourcesUrl) {
      issues.push(
        `${obsJsonPath} all-source URL ${allSource.url} does not match the live run sheet ${expectedObsAllSourcesUrl}; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)} with the same app port`
      );
    }

    if (repo.commit && handoff.repo?.commit !== repo.commit) {
      issues.push(
        `${obsJsonPath} was generated for commit ${handoff.repo?.commit ?? "unknown"}, but current commit is ${repo.commit}; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)}`
      );
    }

    const settings = handoff.browserSourceSettings;

    if (settings?.width !== 1280 || settings.height !== 720 || settings.fps !== 30 || !settings.customCss?.includes("rgba(0, 0, 0, 0)")) {
      issues.push(`${obsJsonPath} has unexpected browser source settings; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)}`);
    }
  } catch {
    issues.push(`${obsJsonPath} could not be parsed; rerun npm run obs:handoff -- --out ${shellQuote(obsHandoffDir)}`);
  }

  return issues;
}

async function validateVisualQaManifest(
  visualQaManifest: Awaited<ReturnType<typeof findVisualQaManifest>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  const issues: string[] = [];
  const visualMarkdownPath = displayPath(visualQaManifest.sourceFiles.visualQaManifestMarkdown ?? visualQaManifest.expectedFiles.visualQaManifestMarkdown);
  const visualJsonPath = displayPath(visualQaManifest.sourceFiles.visualQaManifestJson ?? visualQaManifest.expectedFiles.visualQaManifestJson);

  if (!visualQaManifest.sourceFiles.visualQaManifestJson) {
    return issues;
  }

  if (!visualQaManifest.sourceFiles.visualQaManifestMarkdown) {
    issues.push(`${visualMarkdownPath} is missing; rerun npm run qa:visual`);
  }

  try {
    const manifest = JSON.parse(await readFile(visualQaManifest.sourceFiles.visualQaManifestJson, "utf8")) as {
      repo?: {
        commit?: string | null;
      };
      captures?: unknown[];
    };

    const freshness = repo.commit ? checkVisualQaFreshness(manifest.repo?.commit, repo.commit, runGit) : null;

    if (freshness?.state === "unknown") {
      issues.push(
        `${visualJsonPath} was generated for commit ${manifest.repo?.commit ?? "unknown"}, but current commit is ${repo.commit}; rerun npm run qa:visual`
      );
    }

    if (freshness?.state === "stale") {
      const changedFiles = freshness.changedFiles.slice(0, 3).join(", ");
      issues.push(
        `${visualJsonPath} was generated for commit ${manifest.repo?.commit ?? "unknown"}, but UI-relevant files changed before current commit ${repo.commit}: ${changedFiles}; rerun npm run qa:visual`
      );
    }

    if (!Array.isArray(manifest.captures) || manifest.captures.length < 3) {
      issues.push(`${visualJsonPath} does not include the expected desktop, mobile, and OBS captures; rerun npm run qa:visual`);
    }
  } catch {
    issues.push(`${visualJsonPath} could not be parsed; rerun npm run qa:visual`);
  }

  return issues;
}

async function validateKickTunnelCheck(
  kickTunnelCheck: Awaited<ReturnType<typeof findKickTunnelCheck>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  const tunnelPath = displayPath(kickTunnelCheck.sourceFiles.kickTunnelCheck);

  if (!kickTunnelCheck.files.kickTunnelCheck) {
    return [
      `${tunnelPath} is missing; run npm run live:tunnel -- --out ${shellQuote(tunnelPath)} after the capture stack starts`
    ];
  }

  const issues: string[] = [];
  const content = await readFile(kickTunnelCheck.sourceFiles.kickTunnelCheck, "utf8");
  const commit = content.match(/^Repo commit:\s*(\S+)/m)?.[1] ?? null;

  if (!/^Kick tunnel:\s*ready$/m.test(content)) {
    issues.push(`${tunnelPath} does not say Kick tunnel: ready; rerun npm run live:tunnel -- --out ${shellQuote(tunnelPath)}`);
  }

  if (!/^URL:\s*https:\/\/\S+/m.test(content)) {
    issues.push(`${tunnelPath} is missing the public HTTPS tunnel URL; rerun npm run live:tunnel -- --out ${shellQuote(tunnelPath)}`);
  }

  if (!commit || commit === "unknown") {
    issues.push(`${tunnelPath} is missing commit metadata; rerun npm run live:tunnel -- --out ${shellQuote(tunnelPath)}`);
  } else if (repo.commit && commit !== repo.commit) {
    issues.push(
      `${tunnelPath} was generated for commit ${commit}, but current commit is ${repo.commit}; rerun npm run live:tunnel -- --out ${shellQuote(tunnelPath)}`
    );
  }

  return issues;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function displayPath(filePath: string | undefined) {
  if (!filePath) return "unknown";

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), resolvedPath);

  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  const parts = resolvedPath.split(path.sep);
  const qaIndex = parts.lastIndexOf("qa");

  return qaIndex >= 0 ? parts.slice(qaIndex).join(path.sep) : resolvedPath;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.archivePath && !args.archiveDir) {
    console.error(
      "Usage: npm run submission:bundle -- (--archive <session-path> | --archive-dir data/feed-sessions) [--db data/feed.sqlite] [--out submission-bundle] [--qa-dir qa] [--evidence-check qa/evidence-check.txt] [--clips clip-queue.json] [--visual-qa-dir qa/visual] [--kick-tunnel-check qa/kick-tunnel-check.txt] [--allow-partial]"
    );
    process.exitCode = 1;
    return;
  }

  const result = await createSubmissionBundle({
    archivePath: args.archivePath ?? undefined,
    archiveDir: args.archiveDir ?? undefined,
    databasePath: args.databasePath,
    outputDir: args.outputDir ?? "submission-bundle",
    requireAllPlatforms: !args.allowPartial,
    qaDir: args.qaDir,
    evidenceCheckPath: args.evidenceCheckPath,
    obsHandoffDir: args.obsHandoffDir,
    visualQaDir: args.visualQaDir,
    kickTunnelCheckPath: args.kickTunnelCheckPath,
    clipQueuePath: args.clipQueuePath,
    requireCleanRepo: true
  });

  console.log(formatSubmissionBundleResult(result));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

type ParsedArgs = {
  archivePath: string | null;
  archiveDir: string | null;
  databasePath?: string;
  outputDir?: string;
  qaDir?: string;
  evidenceCheckPath?: string;
  obsHandoffDir?: string;
  visualQaDir?: string;
  kickTunnelCheckPath?: string;
  clipQueuePath?: string;
  allowPartial: boolean;
};

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    archivePath: null,
    archiveDir: null,
    allowPartial: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--archive") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.archivePath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--archive-dir") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.archiveDir = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--db") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.databasePath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--out") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.outputDir = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--qa-dir") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.qaDir = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--evidence-check" || arg === "--evidence-out") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.evidenceCheckPath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--obs-handoff-dir") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.obsHandoffDir = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--visual-qa-dir") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.visualQaDir = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--kick-tunnel-check") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.kickTunnelCheckPath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--clips") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.clipQueuePath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--allow-partial") {
      parsed.allowPartial = true;
      continue;
    }
  }

  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
