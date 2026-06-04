import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, createInitialFixtureState } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive, SQLiteFeedArchive } from "./feedArchive";

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

describe("SQLiteFeedArchive", () => {
  it("persists sessions, sources, events, and connector statuses", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "feed-db-"));
    const dbPath = path.join(baseDir, "feed.sqlite");
    const archive = new SQLiteFeedArchive(dbPath);
    const startedAt = "2026-06-04T20:00:00.000Z";
    const sessionId = createFeedSessionId(startedAt, "fixture");
    const event = {
      ...createFixtureEvent(1),
      id: "kick:kick-db-test",
      platform: "kick" as const,
      platformEventId: "kick-db-test",
      sourceChannelId: "kick-channel-ansem",
      sourceChannelName: "ansem"
    };

    await archive.start({
      sessionId,
      startedAt,
      mode: "fixture",
      bufferSize: 250,
      fixtureIntervalMs: 1100,
      connectorPlatforms: []
    });
    archive.recordEvent(event);
    archive.recordStatus({
      platform: "kick",
      state: "live",
      label: "Webhook fixture",
      sourceName: "ansem",
      lastEventAt: event.receivedAt,
      eventCount: 1,
      droppedCount: 0,
      reconnectCount: 0,
      latencyMs: 80
    });
    await archive.stop("2026-06-04T20:00:03.000Z");

    const sqliteModuleName = "node:sqlite";
    const { DatabaseSync } = await import(sqliteModuleName);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const session = db.prepare("select id, mode, ended_at from sessions").get();
    const source = db
      .prepare(
        "select platform, source_channel_id, source_name, display_label from sources where source_key = 'kick:kick-channel-ansem'"
      )
      .get();
    const persistedEvent = db
      .prepare("select platform, source_key, source_channel_name, signal_score from events")
      .get();
    const status = db
      .prepare("select platform, state, source_name, event_count, latency_ms from connector_statuses")
      .get();
    db.close();

    expect(session).toMatchObject({
      id: sessionId,
      mode: "fixture",
      ended_at: "2026-06-04T20:00:03.000Z"
    });
    expect(source).toMatchObject({
      platform: "kick",
      source_channel_id: "kick-channel-ansem",
      source_name: "ansem",
      display_label: "KICK (ANSEM)"
    });
    expect(persistedEvent).toMatchObject({
      platform: "kick",
      source_key: "kick:kick-channel-ansem",
      source_channel_name: "ansem"
    });
    expect(status).toMatchObject({
      platform: "kick",
      state: "live",
      source_name: "ansem",
      event_count: 1,
      latency_ms: 80
    });
  });
});
