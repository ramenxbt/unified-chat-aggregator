import { z } from "zod";
import { platformLabels, scoreEventSignal, unifiedEventSchema, type UnifiedEvent } from "./unifiedEvent";

export const recordingExportSchema = z.object({
  exportedAt: z.string().datetime(),
  source: z.string(),
  transportState: z.string().optional(),
  eventCount: z.number().int().nonnegative(),
  events: z.array(unifiedEventSchema)
});

export type RecordingExport = z.infer<typeof recordingExportSchema>;

const recordingCsvColumns = [
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
];

export function recordingEventsToCsv(events: UnifiedEvent[]): string {
  const rows = events.map((event) => [
    event.occurredAt,
    event.receivedAt,
    event.platform,
    platformLabels[event.platform],
    event.kind,
    event.sourceChannelId ?? "",
    event.sourceChannelName ?? "",
    event.authorId ?? "",
    event.authorName ?? "",
    event.badges.map((badge) => badge.label).join("|"),
    String(scoreEventSignal(event)),
    event.text ?? "",
    event.platformEventId,
    event.id
  ]);

  return [recordingCsvColumns, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
