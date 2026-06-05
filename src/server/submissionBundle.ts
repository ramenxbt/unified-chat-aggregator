import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { archiveRecordingToCsv, readArchiveRecording } from "./exportFeedArchive";
import { buildEvidenceReport, formatEvidenceReport, type EvidenceReport } from "./evidenceReport";

export type SubmissionBundleOptions = {
  archivePath: string;
  databasePath?: string;
  outputDir: string;
  requireAllPlatforms?: boolean;
};

export type SubmissionBundleResult = {
  ok: boolean;
  outputDir: string;
  files: {
    evidenceReport: string;
    replayJson: string;
    replayCsv: string;
    summary: string;
  };
  evidence: EvidenceReport;
};

export async function createSubmissionBundle(options: SubmissionBundleOptions): Promise<SubmissionBundleResult> {
  const evidence = await buildEvidenceReport({
    archivePath: options.archivePath,
    databasePath: options.databasePath,
    requireAllPlatforms: options.requireAllPlatforms
  });
  const recording = await readArchiveRecording(options.archivePath);
  const bundleDir = path.resolve(options.outputDir);
  const files = {
    evidenceReport: path.join(bundleDir, "evidence-report.txt"),
    replayJson: path.join(bundleDir, "replay.json"),
    replayCsv: path.join(bundleDir, "replay.csv"),
    summary: path.join(bundleDir, "summary.json")
  };

  await mkdir(bundleDir, { recursive: true });
  await Promise.all([
    writeFile(files.evidenceReport, `${formatEvidenceReport(evidence)}\n`, "utf8"),
    writeFile(files.replayJson, `${JSON.stringify(recording, null, 2)}\n`, "utf8"),
    writeFile(files.replayCsv, archiveRecordingToCsv(recording), "utf8"),
    writeFile(
      files.summary,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          archivePath: options.archivePath,
          databasePath: options.databasePath,
          evidenceOk: evidence.ok,
          sessionId: evidence.sessionId,
          mode: evidence.mode,
          eventCount: evidence.eventCount,
          statusCount: evidence.statusCount,
          platforms: evidence.platforms,
          statusPlatforms: evidence.statusPlatforms,
          sourceLabels: evidence.sourceLabels,
          files
        },
        null,
        2
      )}\n`,
      "utf8"
    )
  ]);

  return {
    ok: evidence.ok,
    outputDir: bundleDir,
    files,
    evidence
  };
}

export function formatSubmissionBundleResult(result: SubmissionBundleResult) {
  const lines = [
    `Submission bundle: ${result.ok ? "ready" : "needs attention"}`,
    `Output: ${result.outputDir}`,
    `Evidence report: ${result.files.evidenceReport}`,
    `Replay JSON: ${result.files.replayJson}`,
    `Replay CSV: ${result.files.replayCsv}`,
    `Summary: ${result.files.summary}`
  ];

  if (result.evidence.issues.length > 0) {
    lines.push("", "Issues:", ...result.evidence.issues.map((issue) => `  ${issue}`));
  }

  return lines.join("\n");
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.archivePath) {
    console.error(
      "Usage: npm run submission:bundle -- --archive <session-path> [--db data/feed.sqlite] [--out submission-bundle] [--allow-partial]"
    );
    process.exitCode = 1;
    return;
  }

  const result = await createSubmissionBundle({
    archivePath: args.archivePath,
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
  databasePath?: string;
  outputDir?: string;
  allowPartial: boolean;
};

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    archivePath: null,
    allowPartial: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--archive") {
      parsed.archivePath = args[index + 1] ?? null;
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
