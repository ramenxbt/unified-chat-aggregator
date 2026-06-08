import { afterEach, describe, expect, it } from "vitest";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import { readClipQueue, writeClipQueue, type ClipItem } from "./clipQueue";

function createClip(sequence: number): ClipItem {
  return {
    clippedAt: new Date(Date.UTC(2026, 5, 4, 18, sequence)).toISOString(),
    event: createFixtureEvent(sequence, new Date("2026-06-04T18:00:00.000Z"))
  };
}

describe("clip queue", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("persists validated clips", () => {
    const clip = createClip(1);

    expect(writeClipQueue([clip])).toEqual([clip]);
    expect(readClipQueue()).toEqual([clip]);
  });

  it("ignores corrupted storage payloads", () => {
    window.localStorage.setItem("market-bubble-clip-queue:v1", "{not-json");

    expect(readClipQueue()).toEqual([]);
  });

  it("keeps the latest 24 clips", () => {
    const clips = Array.from({ length: 26 }, (_, index) => createClip(index));

    writeClipQueue(clips);

    const restoredClips = readClipQueue();

    expect(restoredClips).toHaveLength(24);
    expect(restoredClips[0].event.id).toBe(clips[25].event.id);
    expect(restoredClips.at(-1)?.event.id).toBe(clips[2].event.id);
  });

  it("normalizes restored clips to newest first", () => {
    const clips = [createClip(1), createClip(3), createClip(2)];

    writeClipQueue(clips);

    expect(readClipQueue().map((clip) => clip.event.id)).toEqual([
      clips[1].event.id,
      clips[2].event.id,
      clips[0].event.id
    ]);
  });
});
