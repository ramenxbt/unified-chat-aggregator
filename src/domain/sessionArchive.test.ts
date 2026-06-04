import { afterEach, describe, expect, it } from "vitest";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import {
  createSavedSession,
  deleteArchivedSession,
  readSessionArchive,
  savedSessionToRecording,
  saveSessionArchive
} from "./sessionArchive";
import type { RecordingExport } from "./recording";

function createRecording(sequence: number): RecordingExport {
  const event = createFixtureEvent(sequence, new Date("2026-06-04T18:00:00.000Z"));

  return {
    exportedAt: "2026-06-04T18:00:01.000Z",
    source: "Fixture stream",
    transportState: "fixture",
    eventCount: 1,
    events: [event]
  };
}

describe("session archive", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("saves, reads, and deletes validated sessions", () => {
    const session = createSavedSession({
      id: "session-1",
      name: "Fixture stream - 1 event",
      recording: createRecording(1),
      savedAt: "2026-06-04T18:00:02.000Z"
    });

    expect(saveSessionArchive(session)).toEqual([session]);
    expect(readSessionArchive()).toEqual([session]);
    expect(savedSessionToRecording(session)).toMatchObject({
      eventCount: 1,
      source: "Fixture stream"
    });
    expect(deleteArchivedSession("session-1")).toEqual([]);
  });

  it("ignores corrupted storage payloads", () => {
    window.localStorage.setItem("market-bubble-feed-sessions:v1", "{not-json");

    expect(readSessionArchive()).toEqual([]);
  });

  it("keeps the latest 12 sessions", () => {
    for (let index = 0; index < 14; index += 1) {
      saveSessionArchive(
        createSavedSession({
          id: `session-${index}`,
          name: `Session ${index}`,
          recording: createRecording(index),
          savedAt: new Date(Date.UTC(2026, 5, 4, 18, index)).toISOString()
        })
      );
    }

    const sessions = readSessionArchive();

    expect(sessions).toHaveLength(12);
    expect(sessions[0].id).toBe("session-13");
    expect(sessions.at(-1)?.id).toBe("session-2");
  });
});
