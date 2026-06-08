import type { LiveRunPlanOptions } from "./liveRunPlan";

export type LiveStackCliOptions = LiveRunPlanOptions & {
  dryRun: boolean;
  obsHandoffDir?: string;
  qaDir?: string;
  requireReady: boolean;
  withProofGate: boolean;
};

export type LivePrepareCliOptions = LiveRunPlanOptions & {
  outPath?: string;
};

export function parseLiveRunCliArgs(args: string[]): LiveRunPlanOptions {
  const parsed: LiveRunPlanOptions = {
    allowPartial: args.includes("--allow-partial")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--feed-port") {
      assignOptionalPositiveNumber(parsed, "feedPort", args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--app-port") {
      assignOptionalPositiveNumber(parsed, "appPort", args[index + 1]);
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

    if (arg === "--clips" || arg === "--clip-queue") {
      parsed.clipQueuePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--qa-dir") {
      parsed.qaDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--kick-tunnel-check") {
      parsed.kickTunnelCheckPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--proof-timeout-ms" || arg === "--timeout-ms") {
      assignOptionalPositiveNumber(parsed, "proofTimeoutMs", args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--proof-interval-ms" || arg === "--interval-ms") {
      assignOptionalPositiveNumber(parsed, "proofIntervalMs", args[index + 1]);
      index += 1;
      continue;
    }
  }

  return parsed;
}

function assignOptionalPositiveNumber(
  target: LiveRunPlanOptions,
  key: "feedPort" | "appPort" | "proofTimeoutMs" | "proofIntervalMs",
  value: string | undefined
) {
  const parsed = parseOptionalPositiveNumber(value);

  if (parsed !== undefined) {
    target[key] = parsed;
  }
}

function parseOptionalPositiveNumber(value: string | undefined) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseLiveStackCliArgs(args: string[]): LiveStackCliOptions {
  const parsed: LiveStackCliOptions = {
    ...parseLiveRunCliArgs(args),
    dryRun: args.includes("--dry-run"),
    requireReady: args.includes("--require-ready"),
    withProofGate: args.includes("--with-proof-gate")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--obs-handoff-dir") {
      parsed.obsHandoffDir = args[index + 1];
      index += 1;
    }
  }

  return parsed;
}

export function parseLivePrepareCliArgs(args: string[]): LivePrepareCliOptions {
  const parsed: LivePrepareCliOptions = parseLiveRunCliArgs(args);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out" || arg === "--output") {
      parsed.outPath = args[index + 1];
      index += 1;
    }
  }

  return parsed;
}
