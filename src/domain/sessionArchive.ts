import { z } from "zod";
import { recordingExportSchema, type RecordingExport } from "./recording";

const archiveStorageKey = "market-bubble-feed-sessions:v1";
const maxSavedSessions = 12;

export const savedSessionSchema = recordingExportSchema.extend({
  id: z.string(),
  name: z.string(),
  savedAt: z.string().datetime()
});

const sessionArchiveSchema = z.object({
  version: z.literal(1),
  sessions: z.array(savedSessionSchema)
});

export type SavedSession = z.infer<typeof savedSessionSchema>;

export function readSessionArchive(storage = getStorage()): SavedSession[] {
  if (!storage) return [];

  try {
    const rawArchive = storage.getItem(archiveStorageKey);

    if (!rawArchive) return [];

    return sessionArchiveSchema.parse(JSON.parse(rawArchive)).sessions;
  } catch {
    return [];
  }
}

export function saveSessionArchive(session: SavedSession, storage = getStorage()): SavedSession[] {
  if (!storage) return [session];

  const sessions = [session, ...readSessionArchive(storage).filter((savedSession) => savedSession.id !== session.id)]
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, maxSavedSessions);

  writeSessionArchive(sessions, storage);

  return sessions;
}

export function deleteArchivedSession(id: string, storage = getStorage()): SavedSession[] {
  if (!storage) return [];

  const sessions = readSessionArchive(storage).filter((session) => session.id !== id);

  writeSessionArchive(sessions, storage);

  return sessions;
}

export function createSavedSession({
  id = createSessionId(),
  name,
  recording,
  savedAt = new Date().toISOString()
}: {
  id?: string;
  name: string;
  recording: RecordingExport;
  savedAt?: string;
}): SavedSession {
  return savedSessionSchema.parse({
    ...recording,
    id,
    name,
    savedAt
  });
}

export function savedSessionToRecording(session: SavedSession): RecordingExport {
  return recordingExportSchema.parse(session);
}

function writeSessionArchive(sessions: SavedSession[], storage: Storage) {
  storage.setItem(
    archiveStorageKey,
    JSON.stringify({
      version: 1,
      sessions
    })
  );
}

function getStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
