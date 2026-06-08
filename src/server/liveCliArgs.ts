import type { LiveRunPlanOptions } from "./liveRunPlan";

export type LiveStackCliOptions = LiveRunPlanOptions & {
  dryRun: boolean;
  obsHandoffDir?: string;
  qaDir?: string;
  requireReady: boolean;
  visualQaDir?: string;
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
      if (assignOptionalPositiveNumber(parsed, "feedPort", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--app-port") {
      if (assignOptionalPositiveNumber(parsed, "appPort", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--archive-dir") {
      if (assignOptionalString(parsed, "archiveDir", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--db" || arg === "--database-path") {
      if (assignOptionalString(parsed, "databasePath", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--clips" || arg === "--clip-queue") {
      if (assignOptionalString(parsed, "clipQueuePath", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--qa-dir") {
      if (assignOptionalString(parsed, "qaDir", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--evidence-check" || arg === "--evidence-out") {
      if (assignOptionalString(parsed, "evidenceCheckPath", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--kick-tunnel-check") {
      if (assignOptionalString(parsed, "kickTunnelCheckPath", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--proof-timeout-ms" || arg === "--timeout-ms") {
      if (assignOptionalPositiveNumber(parsed, "proofTimeoutMs", readOptionalArgValue(args, index))) index += 1;
      continue;
    }

    if (arg === "--proof-interval-ms" || arg === "--interval-ms") {
      if (assignOptionalPositiveNumber(parsed, "proofIntervalMs", readOptionalArgValue(args, index))) index += 1;
      continue;
    }
  }

  return parsed;
}

export function readOptionalArgValue(args: string[], index: number) {
  const value = args[index + 1];

  return value && !value.startsWith("--") ? value : undefined;
}

function assignOptionalString(
  target: LiveRunPlanOptions,
  key: "archiveDir" | "clipQueuePath" | "databasePath" | "evidenceCheckPath" | "kickTunnelCheckPath" | "qaDir",
  value: string | undefined
) {
  if (value === undefined) return false;

  target[key] = value;
  return true;
}

function assignOptionalPositiveNumber(
  target: LiveRunPlanOptions,
  key: "feedPort" | "appPort" | "proofTimeoutMs" | "proofIntervalMs",
  value: string | undefined
) {
  const parsed = parseOptionalPositiveNumber(value);

  if (parsed !== undefined) {
    target[key] = parsed;
    return true;
  }

  return false;
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
  }

  return parsed;
}

export function parseLivePrepareCliArgs(args: string[]): LivePrepareCliOptions {
  const parsed: LivePrepareCliOptions = parseLiveRunCliArgs(args);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out" || arg === "--output") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        parsed.outPath = value;
        index += 1;
      }
    }
  }

  return parsed;
}
