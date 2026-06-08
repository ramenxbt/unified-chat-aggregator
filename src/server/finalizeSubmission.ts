import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildEvidenceReport, formatEvidenceReport, writeEvidenceReportProof } from "./evidenceReport";
import { createSubmissionBundle, formatSubmissionBundleResult } from "./submissionBundle";

export type FinalizeSubmissionResult = {
  evidenceOutputPath: string;
  evidenceOutput: string;
  bundle: Awaited<ReturnType<typeof createSubmissionBundle>>;
};

export async function finalizeSubmission(args: string[] = []): Promise<FinalizeSubmissionResult> {
  const parsed = parseFinalizeSubmissionCliArgs(args);

  if (!parsed.archivePath && !parsed.archiveDir) {
    throw new Error(
      "Usage: npm run submission:finalize -- (--archive <session-path> | --archive-dir data/feed-sessions) [--db data/feed.sqlite] [--out submission-bundle] [--qa-dir qa] [--clips clip-queue.json] [--obs-handoff-dir qa/obs] [--visual-qa-dir qa/visual] [--kick-tunnel-check qa/kick-tunnel-check.txt] [--allow-partial]"
    );
  }

  const requireAllPlatforms = !parsed.allowPartial;
  const qaDir = parsed.qaDir ?? "qa";
  const evidenceOutputPath = parsed.evidenceOutputPath ?? path.join(qaDir, "evidence-check.txt");
  const archiveOptions = {
    archivePath: parsed.archivePath ?? undefined,
    archiveDir: parsed.archiveDir ?? undefined
  };
  const evidence = await buildEvidenceReport({
    ...archiveOptions,
    databasePath: parsed.databasePath,
    requireAllPlatforms
  });
  const evidenceOutput = formatEvidenceReport(evidence);

  await writeEvidenceReportProof(evidenceOutputPath, evidenceOutput);

  const bundle = await createSubmissionBundle({
    ...archiveOptions,
    databasePath: parsed.databasePath,
    outputDir: parsed.outputDir ?? "submission-bundle",
    requireAllPlatforms,
    qaDir,
    evidenceCheckPath: evidenceOutputPath,
    obsHandoffDir: parsed.obsHandoffDir,
    visualQaDir: parsed.visualQaDir,
    kickTunnelCheckPath: parsed.kickTunnelCheckPath,
    clipQueuePath: parsed.clipQueuePath
  });

  return {
    evidenceOutputPath,
    evidenceOutput,
    bundle
  };
}

type ParsedFinalizeArgs = {
  archivePath: string | null;
  archiveDir: string | null;
  databasePath?: string;
  outputDir?: string;
  qaDir?: string;
  evidenceOutputPath?: string;
  obsHandoffDir?: string;
  visualQaDir?: string;
  kickTunnelCheckPath?: string;
  clipQueuePath?: string;
  allowPartial: boolean;
};

export function parseFinalizeSubmissionCliArgs(args: string[]): ParsedFinalizeArgs {
  const parsed: ParsedFinalizeArgs = {
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

    if (arg === "--db" || arg === "--database-path") {
      parsed.databasePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out") {
      parsed.outputDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--qa-dir") {
      parsed.qaDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--evidence-out") {
      parsed.evidenceOutputPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--obs-handoff-dir") {
      parsed.obsHandoffDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--visual-qa-dir") {
      parsed.visualQaDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--kick-tunnel-check") {
      parsed.kickTunnelCheckPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--clips") {
      parsed.clipQueuePath = args[index + 1];
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

async function runCli() {
  try {
    const result = await finalizeSubmission(process.argv.slice(2));
    console.log(result.evidenceOutput);
    console.log(`\nWrote evidence proof: ${result.evidenceOutputPath}`);
    console.log(`\n${formatSubmissionBundleResult(result.bundle)}`);

    if (!result.bundle.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
