import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { recordingEventsToCsv, recordingExportSchema, type RecordingExport } from "../domain/recording";
import { unifiedEventSchema } from "../domain/unifiedEvent";

const archiveManifestSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  mode: z.enum(["fixture", "connectors"]),
  eventCount: z.number().int().nonnegative(),
  files: z.object({
    events: z.string()
  })
});

export async function readArchiveRecording(sessionPath: string, exportedAt = new Date().toISOString()) {
  const manifest = archiveManifestSchema.parse(
    JSON.parse(await readFile(path.join(sessionPath, "manifest.json"), "utf8"))
  );
  const eventsFile = await readFile(path.join(sessionPath, manifest.files.events), "utf8");
  const events = eventsFile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => unifiedEventSchema.parse(JSON.parse(line)));

  return recordingExportSchema.parse({
    exportedAt,
    source: `Feed archive ${manifest.sessionId}`,
    transportState: manifest.mode,
    eventCount: events.length,
    events
  });
}

export function archiveRecordingToCsv(recording: RecordingExport) {
  return recordingEventsToCsv(recording.events);
}

async function runCli() {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (!parsedArgs.sessionPath) {
    console.error("Usage: npm run archive:export -- <session-path> [--format json|csv] [--out file]");
    process.exitCode = 1;
    return;
  }

  const recording = await readArchiveRecording(parsedArgs.sessionPath);
  const output =
    parsedArgs.format === "csv" ? archiveRecordingToCsv(recording) : `${JSON.stringify(recording, null, 2)}\n`;

  if (parsedArgs.outPath) {
    await writeFile(parsedArgs.outPath, output, "utf8");
    console.log(`Wrote ${parsedArgs.format.toUpperCase()} archive export to ${parsedArgs.outPath}`);
    return;
  }

  process.stdout.write(output);
}

type ExportFormat = "json" | "csv";

type ParsedArgs = {
  sessionPath: string | null;
  format: ExportFormat;
  outPath: string | null;
};

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    sessionPath: null,
    format: "json",
    outPath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--format") {
      parsed.format = parseFormat(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      parsed.outPath = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (!arg.startsWith("--") && !parsed.sessionPath) {
      parsed.sessionPath = arg;
    }
  }

  return parsed;
}

function parseFormat(value: string | undefined): ExportFormat {
  if (value === "csv" || value === "json") {
    return value;
  }

  return "json";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
