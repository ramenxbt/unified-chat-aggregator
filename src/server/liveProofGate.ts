import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  formatPlatformSourceLabel,
  sourcePlatformSchema,
  unifiedEventSchema,
  type SourcePlatform,
  type UnifiedEvent
} from "../domain/unifiedEvent";

const archivedStatusSchema = z.object({
  recordedAt: z.string().datetime(),
  status: z.object({
    platform: sourcePlatformSchema,
    state: z.string(),
    sourceName: z.string(),
    eventCount: z.number().int().nonnegative(),
    droppedCount: z.number().int().nonnegative(),
    reconnectCount: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative().optional()
  })
});

const requiredPlatforms: SourcePlatform[] = ["twitch", "kick", "x"];

export type LiveProofGateOptions = {
  archivePath?: string;
  archiveDir?: string;
  requireAllPlatforms?: boolean;
  minEvents?: number;
  minSourceLabels?: number;
  maxP95LatencyMs?: number;
  watch?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
};

export type LiveProofGateReport = {
  ok: boolean;
  archivePath: string;
  eventCount: number;
  statusCount: number;
  platformCounts: Record<SourcePlatform, number>;
  statusPlatformCounts: Record<SourcePlatform, number>;
  sourceLabels: string[];
  performance: {
    durationSeconds: number;
    eventsPerSecond: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  checks: {
    name: string;
    ok: boolean;
    detail: string;
  }[];
};

type ArchivedStatus = z.infer<typeof archivedStatusSchema>;

export async function buildLiveProofGateReport(options: LiveProofGateOptions): Promise<LiveProofGateReport> {
  const archivePath = options.archivePath ?? (await findLatestArchivePath(options.archiveDir ?? "data/feed-sessions"));
  const events = await readArchiveEvents(archivePath);
  const statuses = await readArchiveStatuses(archivePath);
  const requireAllPlatforms = options.requireAllPlatforms ?? true;
  const minEvents = options.minEvents ?? 25;
  const minSourceLabels = options.minSourceLabels ?? 3;
  const maxP95LatencyMs = options.maxP95LatencyMs ?? 5000;
  const platformCounts = countEventPlatforms(events);
  const statusPlatformCounts = countStatusPlatforms(statuses);
  const sourceLabels = [...new Set(events.map(formatPlatformSourceLabel))].sort();
  const performance = calculatePerformanceMetrics(events);
  const missingEventPlatforms = requiredPlatforms.filter((platform) => platformCounts[platform] === 0);
  const missingStatusPlatforms = requiredPlatforms.filter((platform) => statusPlatformCounts[platform] === 0);
  const checks = [
    {
      name: "Event volume",
      ok: events.length >= minEvents,
      detail: `${events.length}/${minEvents} events captured`
    },
    {
      name: "Event platforms",
      ok: requireAllPlatforms ? missingEventPlatforms.length === 0 : events.length > 0,
      detail:
        missingEventPlatforms.length === 0
          ? "Twitch, Kick, and X events present"
          : `missing ${missingEventPlatforms.join(", ")} events`
    },
    {
      name: "Connector statuses",
      ok: requireAllPlatforms ? missingStatusPlatforms.length === 0 : statuses.length > 0,
      detail:
        missingStatusPlatforms.length === 0
          ? "Twitch, Kick, and X status samples present"
          : `missing ${missingStatusPlatforms.join(", ")} status samples`
    },
    {
      name: "Source labels",
      ok: sourceLabels.length >= minSourceLabels,
      detail: `${sourceLabels.length}/${minSourceLabels} source labels visible`
    },
    {
      name: "P95 latency",
      ok: performance.p95LatencyMs <= maxP95LatencyMs,
      detail: `${formatNumber(performance.p95LatencyMs)}ms <= ${maxP95LatencyMs}ms`
    }
  ];

  return {
    ok: checks.every((check) => check.ok),
    archivePath,
    eventCount: events.length,
    statusCount: statuses.length,
    platformCounts,
    statusPlatformCounts,
    sourceLabels,
    performance,
    checks
  };
}

export async function watchLiveProofGate(options: LiveProofGateOptions): Promise<LiveProofGateReport> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  let lastReport: LiveProofGateReport | null = null;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      lastReport = await buildLiveProofGateReport(options);
      if (lastReport.ok) return lastReport;
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  if (lastReport) return lastReport;
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for live proof gate");
}

export function formatLiveProofGateReport(report: LiveProofGateReport) {
  const lines = [
    `Live proof gate: ${report.ok ? "ready" : "needs more signal"}`,
    `Archive: ${report.archivePath}`,
    `Events: ${report.eventCount}`,
    `Statuses: ${report.statusCount}`,
    `Duration: ${formatNumber(report.performance.durationSeconds)}s`,
    `Throughput: ${formatNumber(report.performance.eventsPerSecond)} events/s`,
    `Average latency: ${formatNumber(report.performance.averageLatencyMs)}ms`,
    `P95 latency: ${formatNumber(report.performance.p95LatencyMs)}ms`,
    "",
    "Checks:",
    ...report.checks.map((check) => `  ${check.ok ? "PASS" : "WAIT"} ${check.name}: ${check.detail}`),
    "",
    "Event platforms:",
    ...requiredPlatforms.map((platform) => `  ${platform}: ${report.platformCounts[platform]}`),
    "",
    "Status platforms:",
    ...requiredPlatforms.map((platform) => `  ${platform}: ${report.statusPlatformCounts[platform]}`),
    "",
    "Source labels:",
    ...report.sourceLabels.map((label) => `  ${label}`)
  ];

  return lines.join("\n");
}

async function findLatestArchivePath(archiveDir: string) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const sessionDirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionPath = path.join(archiveDir, entry.name);
        const stats = await stat(sessionPath);

        return {
          path: sessionPath,
          modifiedAt: stats.mtimeMs
        };
      })
  );

  const latestSession = sessionDirs.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (!latestSession) {
    throw new Error(`No feed archive sessions found in ${archiveDir}`);
  }

  return latestSession.path;
}

async function readArchiveEvents(archivePath: string) {
  return readJsonl(path.join(archivePath, "events.jsonl"), unifiedEventSchema.parse);
}

async function readArchiveStatuses(archivePath: string) {
  return readJsonl(path.join(archivePath, "statuses.jsonl"), archivedStatusSchema.parse);
}

async function readJsonl<T>(filePath: string, parse: (value: unknown) => T) {
  try {
    const content = await readFile(filePath, "utf8");

    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parse(JSON.parse(line)));
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function countEventPlatforms(events: UnifiedEvent[]) {
  return requiredPlatforms.reduce(
    (counts, platform) => ({
      ...counts,
      [platform]: events.filter((event) => event.platform === platform).length
    }),
    createPlatformCounts()
  );
}

function countStatusPlatforms(statuses: ArchivedStatus[]) {
  return requiredPlatforms.reduce(
    (counts, platform) => ({
      ...counts,
      [platform]: statuses.filter((status) => status.status.platform === platform).length
    }),
    createPlatformCounts()
  );
}

function createPlatformCounts(): Record<SourcePlatform, number> {
  return {
    twitch: 0,
    kick: 0,
    x: 0
  };
}

function calculatePerformanceMetrics(events: UnifiedEvent[]) {
  const eventTimes = events.map((event) => new Date(event.receivedAt).getTime()).sort((left, right) => left - right);
  const latencies = events
    .map((event) => new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime())
    .filter((latency) => Number.isFinite(latency) && latency >= 0);
  const durationSeconds =
    eventTimes.length > 1 ? Math.max(0, (eventTimes[eventTimes.length - 1] - eventTimes[0]) / 1000) : 0;
  const eventsPerSecond = durationSeconds > 0 ? events.length / durationSeconds : events.length;
  const averageLatencyMs =
    latencies.length > 0 ? latencies.reduce((total, latency) => total + latency, 0) / latencies.length : 0;

  return {
    durationSeconds,
    eventsPerSecond,
    averageLatencyMs,
    p95LatencyMs: percentile(latencies, 0.95)
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;

  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1));

  return sortedValues[index];
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2), process.env);
  const report = args.watch ? await watchLiveProofGate(args) : await buildLiveProofGateReport(args);

  console.log(formatLiveProofGateReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[], env: NodeJS.ProcessEnv = process.env): LiveProofGateOptions {
  const parsed: LiveProofGateOptions = {
    minEvents: parseOptionalNumber(env.PROOF_MIN_EVENTS),
    minSourceLabels: parseOptionalNumber(env.PROOF_MIN_SOURCE_LABELS),
    maxP95LatencyMs: parseOptionalNumber(env.PROOF_MAX_P95_LATENCY_MS)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--archive") {
      parsed.archivePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--archive-dir") {
      parsed.archiveDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--min-events") {
      parsed.minEvents = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--min-source-labels") {
      parsed.minSourceLabels = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--max-p95-latency-ms") {
      parsed.maxP95LatencyMs = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--interval-ms") {
      parsed.intervalMs = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--allow-partial") {
      parsed.requireAllPlatforms = false;
      continue;
    }

    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }
  }

  return parsed;
}

function parseOptionalNumber(value: string | undefined) {
  if (!value) return undefined;

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
