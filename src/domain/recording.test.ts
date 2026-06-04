import { describe, expect, it } from "vitest";
import { createFixtureEvent } from "../fixtures/fixtureEvents";
import { recordingEventsToCsv } from "./recording";

describe("recording CSV export", () => {
  it("serializes normalized events with stable columns", () => {
    const csv = recordingEventsToCsv([createFixtureEvent(2, new Date("2026-06-04T18:00:00.000Z"))]);
    const [header, row] = csv.split("\n");

    expect(header).toBe(
      [
        "occurred_at",
        "received_at",
        "platform",
        "platform_label",
        "kind",
        "source_channel_id",
        "source_channel_name",
        "author_id",
        "author_name",
        "badges",
        "signal_score",
        "text",
        "platform_event_id",
        "event_id"
      ].join(",")
    );
    expect(row).toContain("twitch,Twitch,chat_message,twitch_ansem,ansem,tw_67,user67,Mod,2");
    expect(row).toContain("Ansem is cooking again");
  });

  it("escapes csv cells with commas, quotes, and line breaks", () => {
    const event = {
      ...createFixtureEvent(1, new Date("2026-06-04T18:00:00.000Z")),
      text: "quote \"this\", then\nline"
    };
    const csv = recordingEventsToCsv([event]);

    expect(csv).toContain('"quote ""this"", then\nline"');
  });
});
