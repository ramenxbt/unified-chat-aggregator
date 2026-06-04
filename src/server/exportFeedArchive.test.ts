import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive } from "./feedArchive";
import { archiveRecordingToCsv, readArchiveRecording } from "./exportFeedArchive";

describe("archive export", () => {
  it("converts a feed archive into replay JSON", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "feed-archive-export-"));
    const startedAt = "2026-06-04T21:00:00.000Z";
    const sessionId = createFeedSessionId(startedAt, "fixture");
    const archive = new FileFeedArchive(baseDir);
    const first = createFixtureEvent(1);
    const second = createFixtureEvent(2);

    await archive.start({
      sessionId,
      startedAt,
      mode: "fixture",
      bufferSize: 250,
      fixtureIntervalMs: 1100,
      connectorPlatforms: []
    });
    archive.recordEvent(first);
    archive.recordEvent(second);
    await archive.stop("2026-06-04T21:00:02.000Z");

    const recording = await readArchiveRecording(
      path.join(baseDir, sessionId),
      "2026-06-04T21:00:03.000Z"
    );

    expect(recording).toMatchObject({
      exportedAt: "2026-06-04T21:00:03.000Z",
      source: `Feed archive ${sessionId}`,
      transportState: "fixture",
      eventCount: 2
    });
    expect(recording.events.map((event) => event.id)).toEqual([first.id, second.id]);
  });

  it("converts archive replay events into CSV", async () => {
    const recording = {
      exportedAt: "2026-06-04T21:00:03.000Z",
      source: "Feed archive test",
      transportState: "fixture",
      eventCount: 1,
      events: [createFixtureEvent(2, new Date("2026-06-04T21:00:00.000Z"))]
    };

    const csv = archiveRecordingToCsv(recording);

    expect(csv).toContain("occurred_at,received_at,platform,platform_label");
    expect(csv).toContain("Ansem is cooking again");
  });
});
