import { z } from "zod";

const operatorNotesStorageKey = "market-bubble-operator-notes:v1";
const maxOperatorNotes = 48;

export const operatorNoteSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  notedAt: z.string().datetime()
});

const operatorNotesSchema = z.object({
  version: z.literal(1),
  notes: z.array(operatorNoteSchema)
});

export type OperatorNote = z.infer<typeof operatorNoteSchema>;

export function createOperatorNote(text: string, notedAt = new Date().toISOString()): OperatorNote {
  return {
    id: `note-${notedAt}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    notedAt
  };
}

export function readOperatorNotes(storage = getStorage()): OperatorNote[] {
  if (!storage) return [];

  try {
    const rawNotes = storage.getItem(operatorNotesStorageKey);

    if (!rawNotes) return [];

    return normalizeOperatorNotes(operatorNotesSchema.parse(JSON.parse(rawNotes)).notes);
  } catch {
    return [];
  }
}

export function writeOperatorNotes(notes: OperatorNote[], storage = getStorage()) {
  const cappedNotes = normalizeOperatorNotes(notes);

  if (!storage) return cappedNotes;

  storage.setItem(
    operatorNotesStorageKey,
    JSON.stringify({
      version: 1,
      notes: cappedNotes
    })
  );

  return cappedNotes;
}

function normalizeOperatorNotes(notes: OperatorNote[]) {
  return [...notes]
    .sort((left, right) => Date.parse(right.notedAt) - Date.parse(left.notedAt))
    .slice(0, maxOperatorNotes);
}

function getStorage() {
  try {
    return (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}
