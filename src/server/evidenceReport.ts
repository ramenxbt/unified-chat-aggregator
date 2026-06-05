import { readFile } from "node:fs/promises";
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
import { resolveArchivePath } from "./feedArchiveLookup";

const archiveManifestSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  mode: z.enum(["fixture", "connectors"]),
  eventCount: z.number().int().nonnegative(),
  statusCount: z.number().int().nonnegative(),
  files: z.object({
    events: z.string(),
    statuses: z.string()
  })
});

const archivedStatusSchema = z.object({
  recordedAt: z.string().datetime(),
  status: z.object({
    platform: sourcePlatformSchema,
    state: z.string(),
    sourceName: z.string(),
    eventCount: z.number().int().nonnegative(),
    droppedCount: z.number().int().nonnegative(),
    reconnectCount: z.number().int().nonnegative()
  })
});

const requiredPlatforms: SourcePlatform[] = ["twitch", "kick", "x"];

export type EvidenceReportOptions = {
  archivePath?: string;
  archiveDir?: string;
  databasePath?: string;
  requireAllPlatforms?: boolean;
};

export type EvidenceReport = {
  ok: boolean;
  sessionId: string;
  mode: "fixture" | "connectors";
  archivePath: string;
  databasePath?: string;
  eventCount: number;
  statusCount: number;
  platforms: Record<SourcePlatform, number>;
  statusPlatforms: Record<SourcePlatform, number>;
  sourceLabels: string[];
  performance: {
    durationSeconds: number;
    eventsPerSecond: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  database?: {
    sessionFound: boolean;
    eventCount: number;
    sourceCount: number;
    statusCount: number;
    sourceLabels: string[];
  };
  issues: string[];
};

type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

type SQLiteValue = string | number | bigint | Uint8Array | null;

type SQLiteStatement = {
  all(...values: SQLiteValue[]): unknown[];
  get(...values: SQLiteValue[]): unknown;
};

type SQLiteDatabase = {
  prepare(sql: string): SQLiteStatement;
  close(): void;
};

export async function buildEvidenceReport(options: EvidenceReportOptions): Promise<EvidenceReport> {
  const archivePath = await resolveArchivePath(options);
  const requireAllPlatforms = options.requireAllPlatforms ?? true;
  const manifest = await readArchiveManifest(archivePath);
  const events = await readArchiveEvents(archivePath, manifest);
  const statuses = await readArchiveStatuses(archivePath, manifest);
  const platforms = countEventPlatforms(events);
  const statusPlatforms = countStatusPlatforms(statuses);
  const sourceLabels = [...new Set(events.map(formatPlatformSourceLabel))].sort();
  const performance = calculatePerformanceMetrics(events);
  const issues: string[] = [];

  if (events.length !== manifest.eventCount) {
    issues.push(`archive manifest eventCount ${manifest.eventCount} does not match ${events.length} parsed events`);
  }

  if (statuses.length !== manifest.statusCount) {
    issues.push(`archive manifest statusCount ${manifest.statusCount} does not match ${statuses.length} parsed statuses`);
  }

  addPlatformIssues(issues, platforms, requireAllPlatforms, "events");
  addPlatformIssues(issues, statusPlatforms, requireAllPlatforms, "connector statuses");

  const database = options.databasePath ? await readDatabaseEvidence(options.databasePath, manifest.sessionId) : undefined;

  if (database) {
    if (!database.sessionFound) {
      issues.push(`database is missing session ${manifest.sessionId}`);
    }
    if (database.eventCount !== events.length) {
      issues.push(`database event count ${database.eventCount} does not match archive event count ${events.length}`);
    }
    for (const label of sourceLabels) {
      if (!database.sourceLabels.includes(label)) {
        issues.push(`database is missing source label ${label}`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    sessionId: manifest.sessionId,
    mode: manifest.mode,
    archivePath,
    databasePath: options.databasePath,
    eventCount: events.length,
    statusCount: statuses.length,
    platforms,
    statusPlatforms,
    sourceLabels,
    performance,
    database,
    issues
  };
}

export function formatEvidenceReport(report: EvidenceReport) {
  const lines = [
    `Evidence check: ${report.ok ? "ready" : "needs attention"}`,
    `Session: ${report.sessionId}`,
    `Mode: ${report.mode}`,
    `Archive: ${report.archivePath}`,
    `Events: ${report.eventCount}`,
    `Statuses: ${report.statusCount}`,
    `Duration: ${formatNumber(report.performance.durationSeconds)}s`,
    `Throughput: ${formatNumber(report.performance.eventsPerSecond)} events/s`,
    `Average latency: ${formatNumber(report.performance.averageLatencyMs)}ms`,
    `P95 latency: ${formatNumber(report.performance.p95LatencyMs)}ms`,
    "",
    "Event platforms:",
    ...requiredPlatforms.map((platform) => `  ${platform}: ${report.platforms[platform]}`),
    "",
    "Status platforms:",
    ...requiredPlatforms.map((platform) => `  ${platform}: ${report.statusPlatforms[platform]}`),
    "",
    "Source labels:",
    ...report.sourceLabels.map((label) => `  ${label}`)
  ];

  if (report.database) {
    lines.push(
      "",
      `Database: ${report.databasePath}`,
      `  session found: ${report.database.sessionFound ? "yes" : "no"}`,
      `  events: ${report.database.eventCount}`,
      `  sources: ${report.database.sourceCount}`,
      `  statuses: ${report.database.statusCount}`,
      "  source labels:",
      ...report.database.sourceLabels.map((label) => `    ${label}`)
    );
  }

  if (report.issues.length > 0) {
    lines.push("", "Issues:", ...report.issues.map((issue) => `  ${issue}`));
  }

  return lines.join("\n");
}

async function readArchiveManifest(archivePath: string) {
  return archiveManifestSchema.parse(JSON.parse(await readFile(path.join(archivePath, "manifest.json"), "utf8")));
}

async function readArchiveEvents(archivePath: string, manifest: ArchiveManifest) {
  const eventsFile = await readFile(path.join(archivePath, manifest.files.events), "utf8");

  return parseJsonl(eventsFile, unifiedEventSchema.parse);
}

async function readArchiveStatuses(archivePath: string, manifest: ArchiveManifest) {
  const statusesFile = await readFile(path.join(archivePath, manifest.files.statuses), "utf8");

  return parseJsonl(statusesFile, archivedStatusSchema.parse);
}

function parseJsonl<T>(content: string, parse: (value: unknown) => T) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parse(JSON.parse(line)));
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

function countStatusPlatforms(statuses: z.infer<typeof archivedStatusSchema>[]) {
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

function addPlatformIssues(
  issues: string[],
  counts: Record<SourcePlatform, number>,
  requireAllPlatforms: boolean,
  label: string
) {
  if (requireAllPlatforms) {
    for (const platform of requiredPlatforms) {
      if (counts[platform] === 0) {
        issues.push(`missing ${platform} ${label}`);
      }
    }
    return;
  }

  if (requiredPlatforms.every((platform) => counts[platform] === 0)) {
    issues.push(`missing live ${label}`);
  }
}

function calculatePerformanceMetrics(events: UnifiedEvent[]) {
  const eventTimes = events.map((event) => new Date(event.receivedAt).getTime()).sort((left, right) => left - right);
  const latencies = events
    .map((event) => new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime())
    .filter((latency) => Number.isFinite(latency) && latency >= 0)
    .sort((left, right) => left - right);
  const durationMs =
    eventTimes.length > 1 ? Math.max(0, eventTimes[eventTimes.length - 1] - eventTimes[0]) : 0;
  const durationSeconds = durationMs / 1000;
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

function percentile(values: number[], percentileRank: number) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const index = Math.ceil(values.length * percentileRank) - 1;

  return values[Math.min(values.length - 1, Math.max(0, index))];
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

async function readDatabaseEvidence(databasePath: string, sessionId: string) {
  const db = await openSQLiteDatabase(databasePath);

  try {
    const session = db.prepare("select id from sessions where id = ?").get(sessionId);
    const eventCount = readCount(db, "select count(*) as count from events where session_id = ?", sessionId);
    const sourceCount = readCount(db, "select count(*) as count from sources");
    const statusCount = readCount(db, "select count(*) as count from connector_statuses where session_id = ?", sessionId);
    const sourceLabels = db
      .prepare(
        `select distinct sources.display_label as label
        from sources
        join events on events.source_key = sources.source_key
        where events.session_id = ?
        order by sources.display_label`
      )
      .all(sessionId)
      .map((row) => String((row as { label: string }).label));

    return {
      sessionFound: Boolean(session),
      eventCount,
      sourceCount,
      statusCount,
      sourceLabels
    };
  } finally {
    db.close();
  }
}

function readCount(db: SQLiteDatabase, sql: string, ...values: SQLiteValue[]) {
  const row = db.prepare(sql).get(...values) as { count: number } | undefined;

  return Number(row?.count ?? 0);
}

async function openSQLiteDatabase(databasePath: string) {
  const sqliteModuleName = "node:sqlite";
  const { DatabaseSync } = await import(sqliteModuleName);

  return new DatabaseSync(databasePath, { readOnly: true }) as SQLiteDatabase;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.archivePath && !args.archiveDir) {
    console.error(
      "Usage: npm run evidence:check -- (--archive <session-path> | --archive-dir data/feed-sessions) [--db data/feed.sqlite] [--allow-partial]"
    );
    process.exitCode = 1;
    return;
  }

  const report = await buildEvidenceReport({
    archivePath: args.archivePath ?? undefined,
    archiveDir: args.archiveDir ?? undefined,
    databasePath: args.databasePath,
    requireAllPlatforms: !args.allowPartial
  });

  console.log(formatEvidenceReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

type ParsedArgs = {
  archivePath: string | null;
  archiveDir: string | null;
  databasePath?: string;
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
