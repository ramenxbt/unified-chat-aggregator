import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, createInitialFixtureState } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive } from "./feedArchive";

describe("FileFeedArchive", () => {
  it("writes a session manifest, events, and statuses", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "feed-archive-"));
    const startedAt = "2026-06-04T20:00:00.000Z";
    const archive = new FileFeedArchive(baseDir);
    const sessionId = createFeedSessionId(startedAt, "fixture");
    const initialState = createInitialFixtureState(1);

    await archive.start({
      sessionId,
      startedAt,
      mode: "fixture",
      bufferSize: 250,
      fixtureIntervalMs: 1100,
      connectorPlatforms: []
    });

    const event = createFixtureEvent(1);

    archive.recordEvent(event);
    archive.recordStatus(initialState.statuses[0]);
    await archive.stop("2026-06-04T20:00:03.000Z");

    const sessionPath = path.join(baseDir, sessionId);
    const manifest = JSON.parse(await readFile(path.join(sessionPath, "manifest.json"), "utf8"));
    const events = await readFile(path.join(sessionPath, "events.jsonl"), "utf8");
    const statuses = await readFile(path.join(sessionPath, "statuses.jsonl"), "utf8");

    expect(manifest).toMatchObject({
      sessionId,
      mode: "fixture",
      eventCount: 1,
      statusCount: 1,
      endedAt: "2026-06-04T20:00:03.000Z"
    });
    expect(JSON.parse(events.trim())).toMatchObject({
      platform: event.platform,
      sourceChannelName: event.sourceChannelName
    });
    expect(JSON.parse(statuses.trim())).toMatchObject({
      status: {
        platform: "twitch"
      }
    });
  });

  it("can be disabled through env", async () => {
    const { createFeedArchiveFromEnv } = await import("./feedArchive");

    expect(createFeedArchiveFromEnv({ FEED_ARCHIVE_ENABLED: "false" })).toBeNull();
  });
});
