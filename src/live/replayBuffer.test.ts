import { describe, expect, it } from "vitest";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import { ReplayBuffer } from "./replayBuffer";

describe("ReplayBuffer", () => {
  it("dedupes events by platform and platform event id", () => {
    const buffer = new ReplayBuffer(10);
    const event = createFixtureEvent(1);

    expect(buffer.add(event)).toBe(true);
    expect(buffer.add({ ...event, id: "different-id" })).toBe(false);
    expect(buffer.snapshot()).toEqual([event]);
  });

  it("keeps the newest bounded events", () => {
    const buffer = new ReplayBuffer(2);
    const first = createFixtureEvent(1);
    const second = createFixtureEvent(2);
    const third = createFixtureEvent(3);

    buffer.add(first);
    buffer.add(second);
    buffer.add(third);

    expect(buffer.snapshot()).toEqual([third, second]);
  });

  it("allows an evicted platform event id to re-enter the bounded buffer", () => {
    const buffer = new ReplayBuffer(1);
    const first = createFixtureEvent(1);
    const second = createFixtureEvent(2);

    expect(buffer.add(first)).toBe(true);
    expect(buffer.add(second)).toBe(true);
    expect(buffer.add(first)).toBe(true);
    expect(buffer.snapshot()).toEqual([first]);
  });

  it("returns immutable snapshots", () => {
    const buffer = new ReplayBuffer(3);
    const event = createFixtureEvent(1);

    buffer.add(event);

    const snapshot = buffer.snapshot();
    snapshot.length = 0;

    expect(buffer.snapshot()).toEqual([event]);
  });
});
