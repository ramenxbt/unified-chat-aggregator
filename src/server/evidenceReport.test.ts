import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import type { SourcePlatform } from "../domain/unifiedEvent";
import { FileFeedArchive, SQLiteFeedArchive, createFeedSessionId } from "./feedArchive";
import {
  buildEvidenceReport,
  formatEvidenceReport,
  parseEvidenceReportCliArgs,
  writeEvidenceReportProof
} from "./evidenceReport";

describe("evidence report", () => {
  it("validates archive and database evidence for all platforms", async () => {
    const { archivePath, databasePath } = await createEvidenceFixture([0, 1, 2, 6], "connectors", {
      statuses: finalConnectorStatuses
    });
    const report = await buildEvidenceReport({
      archivePath,
      databasePath
    });
    const formatted = formatEvidenceReport(report);

    expect(report.ok).toBe(true);
    expect(report.platforms).toMatchObject({
      twitch: 1,
      kick: 1,
      x: 2
    });
    expect(report.database).toMatchObject({
      sessionFound: true,
      eventCount: 4
    });
    expect(report.performance).toMatchObject({
      durationSeconds: expect.any(Number),
      eventsPerSecond: expect.any(Number),
      averageLatencyMs: expect.any(Number),
      p95LatencyMs: expect.any(Number)
    });
    expect(report.performance.eventsPerSecond).toBeGreaterThan(0);
    expect(report.sourceLabels).toContain("KICK (MARKETBUBBLE)");
    expect(report.sourceLabels).toContain("X (@TAPE_READER)");
    expect(report.sourceLabels).toContain("X (@USER1337)");
    expect(formatted).toContain("Evidence check: ready");
    expect(formatted).toContain("Throughput:");
    expect(formatted).toContain("P95 latency:");
    expect(formatted).toContain("Database:");
  });

  it("fails strict mode when a platform is missing", async () => {
    const { archivePath } = await createEvidenceFixture([0, 2], "connectors", {
      statuses: finalConnectorStatuses
    });
    const report = await buildEvidenceReport({
      archivePath
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("missing x events");
  });

  it("fails strict mode when a platform has no account-qualified source label", async () => {
    const { archivePath } = await createEvidenceFixture([0, 1, 2], "connectors", {
      statuses: finalConnectorStatuses,
      stripSourceNameForPlatforms: ["kick"]
    });
    const report = await buildEvidenceReport({
      archivePath
    });
    const formatted = formatEvidenceReport(report);

    expect(report.ok).toBe(false);
    expect(report.sourceLabels).toContain("KICK (USER91)");
    expect(report.issues).toContain("missing kick account-qualified source label");
    expect(formatted).toContain("missing kick account-qualified source label");
  });

  it("fails strict mode when the archive is fixture-mode rehearsal proof", async () => {
    const { archivePath } = await createEvidenceFixture([0, 1, 2, 6], "fixture", {
      statuses: finalConnectorStatuses
    });
    const report = await buildEvidenceReport({
      archivePath
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("archive mode fixture is not connector-mode live proof");
  });

  it("supports partial evidence checks for smoke runs", async () => {
    const { archivePath } = await createEvidenceFixture([5], "fixture", {
      statuses: finalConnectorStatuses
    });
    const report = await buildEvidenceReport({
      archivePath,
      requireAllPlatforms: false
    });

    expect(report.ok).toBe(true);
    expect(report.platforms.x).toBe(1);
  });

  it("can check the latest session in an archive directory", async () => {
    const { archiveDir, archivePath } = await createEvidenceFixture([0, 1, 2], "connectors", {
      statuses: finalConnectorStatuses
    });
    const report = await buildEvidenceReport({
      archiveDir
    });

    expect(report.ok).toBe(true);
    expect(report.archivePath).toBe(archivePath);
  });

  it("parses output paths for saved evidence proof", () => {
    expect(parseEvidenceReportCliArgs(["--archive-dir", "data/feed-sessions", "--db", "data/feed.sqlite", "--out", "qa/evidence-check.txt"])).toEqual({
      archivePath: null,
      archiveDir: "data/feed-sessions",
      databasePath: "data/feed.sqlite",
      outputPath: "qa/evidence-check.txt",
      allowPartial: false
    });

    expect(parseEvidenceReportCliArgs(["--archive", "data/feed-sessions/session", "--output", "qa/evidence.txt", "--allow-partial"])).toEqual({
      archivePath: "data/feed-sessions/session",
      archiveDir: null,
      outputPath: "qa/evidence.txt",
      allowPartial: true
    });
  });

  it("does not consume the next flag when an evidence option value is omitted", () => {
    expect(parseEvidenceReportCliArgs(["--archive-dir", "--db", "data/feed.sqlite", "--out", "--allow-partial"])).toEqual({
      archivePath: null,
      archiveDir: null,
      databasePath: "data/feed.sqlite",
      allowPartial: true
    });
  });

  it("writes formatted evidence proof to disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "feed-evidence-output-"));
    const outputPath = path.join(tempDir, "qa", "evidence-check.txt");

    await writeEvidenceReportProof(outputPath, "Evidence check: ready");

    expect(await readFile(outputPath, "utf8")).toBe("Evidence check: ready\n");
  });

  it("fails strict mode when a latest connector status is not live", async () => {
    const { archivePath } = await createEvidenceFixture([0, 1, 2], "connectors");
    const report = await buildEvidenceReport({
      archivePath
    });
    const formatted = formatEvidenceReport(report);

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("latest x connector status is degraded");
    expect(formatted).toContain("latest x connector status is degraded");
  });

  it("retries when the evidence database is temporarily locked", async () => {
    const { archivePath, databasePath } = await createEvidenceFixture([0, 1, 2], "connectors", {
      statuses: finalConnectorStatuses
    });
    const sqliteModuleName = "node:sqlite";
    const { DatabaseSync } = await import(sqliteModuleName);
    const lock = new DatabaseSync(databasePath);
    let released = false;

    lock.exec("begin exclusive");

    const releaseTimer = setTimeout(() => {
      lock.exec("commit");
      lock.close();
      released = true;
    }, 300);

    try {
      const report = await buildEvidenceReport({
        archivePath,
        databasePath
      });

      expect(report.ok).toBe(true);
      expect(report.database?.eventCount).toBe(3);
      expect(released).toBe(true);
    } finally {
      clearTimeout(releaseTimer);
      if (!released) {
        lock.exec("commit");
        lock.close();
      }
    }
  });
});

async function createEvidenceFixture(
  eventIndexes: number[],
  mode: "fixture" | "connectors" = "fixture",
  options: { statuses?: typeof initialConnectorStatuses; stripSourceNameForPlatforms?: SourcePlatform[] } = {}
) {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "feed-evidence-"));
  const archive = new FileFeedArchive(path.join(baseDir, "feed-sessions"));
  const databasePath = path.join(baseDir, "feed.sqlite");
  const databaseArchive = new SQLiteFeedArchive(databasePath);
  const startedAt = "2026-06-04T22:00:00.000Z";
  const sessionId = createFeedSessionId(startedAt, mode);
  const session = {
    sessionId,
    startedAt,
    mode,
    bufferSize: 250,
    fixtureIntervalMs: 1100,
    connectorPlatforms: mode === "connectors" ? ["twitch", "kick", "x"] : []
  };

  await archive.start(session);
  await databaseArchive.start(session);

  for (const eventIndex of eventIndexes) {
    const event = createFixtureEvent(eventIndex);
    const archivedEvent = options.stripSourceNameForPlatforms?.includes(event.platform)
      ? {
          ...event,
          sourceChannelName: undefined
        }
      : event;

    archive.recordEvent(archivedEvent);
    databaseArchive.recordEvent(archivedEvent);
  }

  for (const status of options.statuses ?? initialConnectorStatuses) {
    archive.recordStatus(status);
    databaseArchive.recordStatus(status);
  }

  await archive.stop("2026-06-04T22:00:10.000Z");
  await databaseArchive.stop("2026-06-04T22:00:10.000Z");

  return {
    archiveDir: path.join(baseDir, "feed-sessions"),
    archivePath: path.join(baseDir, "feed-sessions", sessionId),
    databasePath
  };
}

const finalConnectorStatuses = initialConnectorStatuses.map((status) => ({
  ...status,
  state: "live" as const
}));
