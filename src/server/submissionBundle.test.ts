import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive, SQLiteFeedArchive } from "./feedArchive";
import { createSubmissionBundle, formatSubmissionBundleResult } from "./submissionBundle";

describe("submission bundle", () => {
  it("writes evidence, replay, csv, and summary files", async () => {
    const { archivePath, databasePath, baseDir } = await createBundleFixture();
    const outputDir = path.join(baseDir, "bundle");
    const result = await createSubmissionBundle({
      archivePath,
      databasePath,
      outputDir
    });

    expect(result.ok).toBe(true);
    expect(formatSubmissionBundleResult(result)).toContain("Submission bundle: ready");

    const evidenceReport = await readFile(result.files.evidenceReport, "utf8");
    const replayJson = JSON.parse(await readFile(result.files.replayJson, "utf8"));
    const replayCsv = await readFile(result.files.replayCsv, "utf8");
    const summary = JSON.parse(await readFile(result.files.summary, "utf8"));

    expect(evidenceReport).toContain("Evidence check: ready");
    expect(evidenceReport).toContain("KICK (MARKETBUBBLE)");
    expect(replayJson.eventCount).toBe(3);
    expect(replayCsv).toContain("occurred_at,received_at,platform,platform_label,kind");
    expect(summary).toMatchObject({
      evidenceOk: true,
      eventCount: 3,
      platforms: {
        twitch: 1,
        kick: 1,
        x: 1
      }
    });
  });
});

async function createBundleFixture() {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "submission-bundle-"));
  const archive = new FileFeedArchive(path.join(baseDir, "feed-sessions"));
  const databasePath = path.join(baseDir, "feed.sqlite");
  const databaseArchive = new SQLiteFeedArchive(databasePath);
  const startedAt = "2026-06-04T23:00:00.000Z";
  const sessionId = createFeedSessionId(startedAt, "fixture");
  const session = {
    sessionId,
    startedAt,
    mode: "fixture" as const,
    bufferSize: 250,
    fixtureIntervalMs: 1100,
    connectorPlatforms: []
  };

  await archive.start(session);
  await databaseArchive.start(session);

  for (const eventIndex of [0, 1, 2]) {
    const event = createFixtureEvent(eventIndex);
    archive.recordEvent(event);
    databaseArchive.recordEvent(event);
  }

  for (const status of initialConnectorStatuses) {
    archive.recordStatus(status);
    databaseArchive.recordStatus(status);
  }

  await archive.stop("2026-06-04T23:00:10.000Z");
  await databaseArchive.stop("2026-06-04T23:00:10.000Z");

  return {
    archivePath: path.join(baseDir, "feed-sessions", sessionId),
    databasePath,
    baseDir
  };
}
