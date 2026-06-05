import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import { FileFeedArchive, SQLiteFeedArchive, createFeedSessionId } from "./feedArchive";
import { buildEvidenceReport, formatEvidenceReport } from "./evidenceReport";

describe("evidence report", () => {
  it("validates archive and database evidence for all platforms", async () => {
    const { archivePath, databasePath } = await createEvidenceFixture([0, 1, 2, 6], "connectors");
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
    const { archivePath } = await createEvidenceFixture([0, 2], "connectors");
    const report = await buildEvidenceReport({
      archivePath
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("missing x events");
  });

  it("fails strict mode when the archive is fixture-mode rehearsal proof", async () => {
    const { archivePath } = await createEvidenceFixture([0, 1, 2, 6]);
    const report = await buildEvidenceReport({
      archivePath
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("archive mode fixture is not connector-mode live proof");
  });

  it("supports partial evidence checks for smoke runs", async () => {
    const { archivePath } = await createEvidenceFixture([5]);
    const report = await buildEvidenceReport({
      archivePath,
      requireAllPlatforms: false
    });

    expect(report.ok).toBe(true);
    expect(report.platforms.x).toBe(1);
  });

  it("can check the latest session in an archive directory", async () => {
    const { archiveDir, archivePath } = await createEvidenceFixture([0, 1, 2], "connectors");
    const report = await buildEvidenceReport({
      archiveDir
    });

    expect(report.ok).toBe(true);
    expect(report.archivePath).toBe(archivePath);
  });
});

async function createEvidenceFixture(eventIndexes: number[], mode: "fixture" | "connectors" = "fixture") {
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
    archive.recordEvent(event);
    databaseArchive.recordEvent(event);
  }

  for (const status of initialConnectorStatuses) {
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
