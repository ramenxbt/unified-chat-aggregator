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

    return clipQueueSchema.parse(JSON.parse(rawQueue)).clips.slice(0, maxClipQueueItems);
  } catch {
    return [];
  }
}

export function writeClipQueue(clips: ClipItem[], storage = getStorage()) {
  const cappedClips = clips.slice(0, maxClipQueueItems);

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

function getStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
