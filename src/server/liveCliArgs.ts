import type { LiveRunPlanOptions } from "./liveRunPlan";

export type LiveStackCliOptions = LiveRunPlanOptions & {
  dryRun: boolean;
  withProofGate: boolean;
};

export function parseLiveRunCliArgs(args: string[]): LiveRunPlanOptions {
  const parsed: LiveRunPlanOptions = {
    allowPartial: args.includes("--allow-partial")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--feed-port") {
      parsed.feedPort = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--app-port") {
      parsed.appPort = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--archive-dir") {
      parsed.archiveDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--db" || arg === "--database-path") {
      parsed.databasePath = args[index + 1];
      index += 1;
      continue;
    }
  }

  return parsed;
}

export function parseLiveStackCliArgs(args: string[]): LiveStackCliOptions {
  return {
    ...parseLiveRunCliArgs(args),
    dryRun: args.includes("--dry-run"),
    withProofGate: args.includes("--with-proof-gate")
  };
}
