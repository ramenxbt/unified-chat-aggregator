import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { archiveRecordingToCsv, readArchiveRecording } from "./exportFeedArchive";
import { buildEvidenceReport, formatEvidenceReport, type EvidenceReport } from "./evidenceReport";
import { resolveArchivePath } from "./feedArchiveLookup";

export type SubmissionBundleOptions = {
  archivePath?: string;
  archiveDir?: string;
  databasePath?: string;
  outputDir: string;
  requireAllPlatforms?: boolean;
  finalQaReportDir?: string;
  liveRunPlanDir?: string;
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
    finalQaReportMarkdown?: string;
    finalQaReportJson?: string;
    liveRunPlan?: string;
    partialLiveRunPlan?: string;
  };
  evidence: EvidenceReport;
  artifactIssues: string[];
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
  const finalQaReports = await findFinalQaReports(options.finalQaReportDir ?? "qa", bundleDir);
  const liveRunPlans = await findLiveRunPlans(options.liveRunPlanDir ?? "qa", bundleDir);
  const requireAllPlatforms = options.requireAllPlatforms ?? true;
  const artifactIssues = await validateCopiedArtifacts(finalQaReports, liveRunPlans, requireAllPlatforms, repo);
  const files = {
    evidenceReport: path.join(bundleDir, "evidence-report.txt"),
    replayJson: path.join(bundleDir, "replay.json"),
    replayCsv: path.join(bundleDir, "replay.csv"),
    submissionNotes: path.join(bundleDir, "submission-notes.md"),
    summary: path.join(bundleDir, "summary.json"),
    ...finalQaReports.files,
    ...liveRunPlans.files
  };

  await mkdir(bundleDir, { recursive: true });
  await Promise.all([
    writeFile(files.evidenceReport, `${formatEvidenceReport(evidence)}\n`, "utf8"),
    writeFile(files.replayJson, `${JSON.stringify(recording, null, 2)}\n`, "utf8"),
    writeFile(files.replayCsv, archiveRecordingToCsv(recording), "utf8"),
    writeFile(files.submissionNotes, `${formatSubmissionNotes(evidence, repo, externalArtifacts, artifactIssues)}\n`, "utf8"),
    writeFile(
      files.summary,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
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
          externalArtifacts,
          artifactIssues,
          files
        },
        null,
        2
      )}\n`,
      "utf8"
    ),
    ...finalQaReports.copyTasks.map((copyTask) => copyTask()),
    ...liveRunPlans.copyTasks.map((copyTask) => copyTask())
  ]);

  return {
    ok: evidence.ok && artifactIssues.length === 0,
    outputDir: bundleDir,
    files,
    evidence,
    artifactIssues
  };
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
    ...(result.files.finalQaReportMarkdown ? [`Final QA report: ${result.files.finalQaReportMarkdown}`] : []),
    ...(result.files.finalQaReportJson ? [`Final QA JSON: ${result.files.finalQaReportJson}`] : []),
    ...(result.files.liveRunPlan ? [`Live run plan: ${result.files.liveRunPlan}`] : []),
    ...(result.files.partialLiveRunPlan ? [`Partial live run plan: ${result.files.partialLiveRunPlan}`] : [])
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
  artifactIssues: string[] = []
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
    "Exported dashboard recording JSON and CSV, if captured from the browser",
    "Final live run sheet from qa/live-run-plan.txt",
    "Final local rehearsal report from qa/final-report.md"
  ];
}

async function findFinalQaReports(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["final-report.md", "final-qa-report.md", "finalQaReportMarkdown"],
    ["final-report.json", "final-qa-report.json", "finalQaReportJson"]
  ]);
}

async function findLiveRunPlans(reportDir: string, bundleDir: string) {
  return findOptionalFiles(reportDir, bundleDir, [
    ["live-run-plan.txt", "live-run-plan.txt", "liveRunPlan"],
    ["live-run-plan.partial.txt", "live-run-plan.partial.txt", "partialLiveRunPlan"]
  ]);
}

async function findOptionalFiles(
  sourceDir: string,
  bundleDir: string,
  candidates: Array<[sourceName: string, targetName: string, key: string]>
) {
  const files: Record<string, string> = {};
  const sourceFiles: Record<string, string> = {};
  const copyTasks: Array<() => Promise<void>> = [];

  for (const [sourceName, targetName, key] of candidates) {
    const sourcePath = path.resolve(sourceDir, sourceName);
    const targetPath = path.join(bundleDir, targetName);

    if (await pathExists(sourcePath)) {
      files[key] = targetPath;
      sourceFiles[key] = sourcePath;
      copyTasks.push(() => copyFile(sourcePath, targetPath));
    }
  }

  return { files, sourceFiles, copyTasks };
}

async function validateCopiedArtifacts(
  finalQaReports: Awaited<ReturnType<typeof findFinalQaReports>>,
  liveRunPlans: Awaited<ReturnType<typeof findLiveRunPlans>>,
  requireAllPlatforms: boolean,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  if (!requireAllPlatforms) {
    return [];
  }

  const issues: string[] = [];

  issues.push(...(await validateFinalQaReport(finalQaReports, repo)));

  if (liveRunPlans.sourceFiles.liveRunPlan) {
    const liveRunPlan = await readFile(liveRunPlans.sourceFiles.liveRunPlan, "utf8");

    if (isPartialLiveRunPlan(liveRunPlan)) {
      issues.push(
        "qa/live-run-plan.txt was generated in partial mode; rerun live:prepare without --allow-partial for final proof"
      );
    }
  }

  return issues;
}

async function validateFinalQaReport(
  finalQaReports: Awaited<ReturnType<typeof findFinalQaReports>>,
  repo: ReturnType<typeof collectRepoMetadata>
) {
  if (!finalQaReports.sourceFiles.finalQaReportJson) {
    return ["qa/final-report.json is missing; run npm run qa:final before creating the final bundle"];
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
      issues.push(`qa/final-report.json status is ${report.status ?? "unknown"}; rerun npm run qa:final and resolve failures`);
    }

    if (report.repo?.commit && repo.commit && report.repo.commit !== repo.commit) {
      issues.push(
        `qa/final-report.json was generated for commit ${report.repo.commit}, but current commit is ${repo.commit}; rerun npm run qa:final`
      );
    }

    if (report.repo?.trackedFilesClean !== true) {
      issues.push("qa/final-report.json was generated with dirty tracked files; commit or revert changes, then rerun npm run qa:final");
    }
  } catch {
    issues.push("qa/final-report.json could not be parsed; rerun npm run qa:final before creating the final bundle");
  }

  return issues;
}

function isPartialLiveRunPlan(content: string) {
  return content.includes("Platform requirement: at least one live connector") || content.includes("--allow-partial");
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

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.archivePath && !args.archiveDir) {
    console.error(
      "Usage: npm run submission:bundle -- (--archive <session-path> | --archive-dir data/feed-sessions) [--db data/feed.sqlite] [--out submission-bundle] [--allow-partial]"
    );
    process.exitCode = 1;
    return;
  }

  const result = await createSubmissionBundle({
    archivePath: args.archivePath ?? undefined,
    archiveDir: args.archiveDir ?? undefined,
    databasePath: args.databasePath,
    outputDir: args.outputDir ?? "submission-bundle",
    requireAllPlatforms: !args.allowPartial
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
      parsed.archivePath = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--archive-dir") {
      parsed.archiveDir = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--db") {
      parsed.databasePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out") {
      parsed.outputDir = args[index + 1];
      index += 1;
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
