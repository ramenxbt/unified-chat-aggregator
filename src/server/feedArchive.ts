import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConnectorStatus, UnifiedEvent } from "../domain/unifiedEvent";

export type FeedArchiveSession = {
  sessionId: string;
  startedAt: string;
  mode: "fixture" | "connectors";
  bufferSize: number;
  fixtureIntervalMs: number;
  connectorPlatforms: string[];
};

export type FeedArchive = {
  readonly sessionPath?: string;
  start(session: FeedArchiveSession): Promise<void>;
  recordEvent(event: UnifiedEvent): void;
  recordStatus(status: ConnectorStatus): void;
  stop(endedAt: string): Promise<void>;
};

type ArchiveManifest = FeedArchiveSession & {
  endedAt?: string;
  eventCount: number;
  statusCount: number;
  files: {
    events: string;
    statuses: string;
  };
};

export class FileFeedArchive implements FeedArchive {
  private manifest: ArchiveManifest | null = null;
  private archivePath: string | null = null;
  private writes = Promise.resolve();

  constructor(private readonly baseDir: string) {}

  get sessionPath() {
    return this.archivePath ?? undefined;
  }

  async start(session: FeedArchiveSession) {
    this.archivePath = path.join(this.baseDir, session.sessionId);
    this.manifest = {
      ...session,
      eventCount: 0,
      statusCount: 0,
      files: {
        events: "events.jsonl",
        statuses: "statuses.jsonl"
      }
    };

    await mkdir(this.archivePath, { recursive: true });
    await this.writeManifest();
  }

  recordEvent(event: UnifiedEvent) {
    if (!this.archivePath || !this.manifest) return;

    this.manifest.eventCount += 1;
    this.enqueueAppend("events.jsonl", event);
  }

  recordStatus(status: ConnectorStatus) {
    if (!this.archivePath || !this.manifest) return;

    this.manifest.statusCount += 1;
    this.enqueueAppend("statuses.jsonl", {
      recordedAt: new Date().toISOString(),
      status
    });
  }

  async stop(endedAt: string) {
    if (!this.manifest) return;

    this.manifest.endedAt = endedAt;
    await this.writes;
    await this.writeManifest();
  }

  private enqueueAppend(fileName: string, payload: unknown) {
    this.writes = this.writes
      .then(async () => {
        if (!this.archivePath) return;
        await appendFile(path.join(this.archivePath, fileName), `${JSON.stringify(payload)}\n`, "utf8");
      })
      .catch((error: unknown) => {
        console.error("Feed archive write failed", error);
      });
  }

  private async writeManifest() {
    if (!this.archivePath || !this.manifest) return;

    await writeFile(path.join(this.archivePath, "manifest.json"), `${JSON.stringify(this.manifest, null, 2)}\n`, "utf8");
  }
}

export function createFeedArchiveFromEnv(env: NodeJS.ProcessEnv = process.env): FeedArchive | null {
  if (env.FEED_ARCHIVE_ENABLED === "false") {
    return null;
  }

  return new FileFeedArchive(path.resolve(env.FEED_ARCHIVE_DIR ?? "data/feed-sessions"));
}

export function createFeedSessionId(startedAt: string, mode: FeedArchiveSession["mode"]) {
  return `${startedAt.replace(/[:.]/g, "-")}-${mode}`;
}
