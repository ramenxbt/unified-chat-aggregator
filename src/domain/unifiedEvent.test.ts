import { describe, expect, it } from "vitest";
import {
  buildUnifiedEventId,
  dedupeEvents,
  isSignalEvent,
  scoreEventSignal,
  unifiedEventSchema,
  type UnifiedEvent
} from "./unifiedEvent";
import { createFixtureEvent } from "../fixtures/fixtureEvents";

describe("unified event schema", () => {
  it("validates fixture events", () => {
    const event = createFixtureEvent(0);
    const result = unifiedEventSchema.safeParse(event);

    expect(result.success).toBe(true);
  });

  it("builds stable platform event ids", () => {
    expect(buildUnifiedEventId("twitch", "message-1")).toBe("twitch:message-1");
  });

  it("dedupes by platform and platform event id", () => {
    const baseEvent = createFixtureEvent(2);
    const duplicate: UnifiedEvent = {
      ...baseEvent,
      id: "different-local-id",
      text: "duplicate body"
    };

    expect(dedupeEvents([baseEvent, duplicate])).toEqual([baseEvent]);
  });

  it("keeps events from different platforms even when external ids match", () => {
    const twitchEvent = createFixtureEvent(2);
    const kickEvent: UnifiedEvent = {
      ...twitchEvent,
      id: "kick:shared",
      platform: "kick",
      platformEventId: twitchEvent.platformEventId
    };

    expect(dedupeEvents([twitchEvent, kickEvent])).toHaveLength(2);
  });
});

describe("signal scoring", () => {
  it("scores market keywords and privileged badges as signal", () => {
    const event = createFixtureEvent(3);

    expect(scoreEventSignal(event)).toBeGreaterThanOrEqual(3);
    expect(isSignalEvent(event)).toBe(true);
  });

  it("keeps routine chat below the signal threshold", () => {
    const event = {
      ...createFixtureEvent(0),
      badges: [],
      text: "gm everyone"
    };

    expect(isSignalEvent(event)).toBe(false);
  });
});

