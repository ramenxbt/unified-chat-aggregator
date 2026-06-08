import { z } from "zod";
import { unifiedEventSchema } from "./unifiedEvent";

const clipQueueStorageKey = "market-bubble-clip-queue:v1";
const maxClipQueueItems = 24;

export const clipItemSchema = z.object({
  clippedAt: z.string().datetime(),
  event: unifiedEventSchema
});

const clipQueueSchema = z.object({
  version: z.literal(1),
  clips: z.array(clipItemSchema)
});

export type ClipItem = z.infer<typeof clipItemSchema>;

export function readClipQueue(storage = getStorage()): ClipItem[] {
  if (!storage) return [];

  try {
    const rawQueue = storage.getItem(clipQueueStorageKey);

    if (!rawQueue) return [];

    return normalizeClipQueue(clipQueueSchema.parse(JSON.parse(rawQueue)).clips);
  } catch {
    return [];
  }
}

export function writeClipQueue(clips: ClipItem[], storage = getStorage()) {
  const cappedClips = normalizeClipQueue(clips);

  if (!storage) return cappedClips;

  storage.setItem(
    clipQueueStorageKey,
    JSON.stringify({
      version: 1,
      clips: cappedClips
    })
  );

  return cappedClips;
}

function normalizeClipQueue(clips: ClipItem[]) {
  return [...clips]
    .sort((left, right) => Date.parse(right.clippedAt) - Date.parse(left.clippedAt))
    .slice(0, maxClipQueueItems);
}

function getStorage() {
  try {
    return (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}
