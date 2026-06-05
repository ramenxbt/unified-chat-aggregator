import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  formatPlatformSourceLabel,
  formatSourceDisplayLabel,
  scoreEventSignal,
  type ConnectorStatus,
  type SourcePlatform,
  type UnifiedEvent
} from "../domain/unifiedEvent";

export type FeedArchiveSession = {
  sessionId: string;
  startedAt: string;
  mode: "fixture" | "connectors";
  bufferSize: number;
  fixtureIntervalMs: number;
  fixtureBurstSize?: number;
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

type SQLiteValue = string | number | bigint | Uint8Array | null;

type SQLiteStatement = {
  run(...values: SQLiteValue[]): unknown;
  get(...values: SQLiteValue[]): unknown;
};

type SQLiteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  close(): void;
};

export class FileFeedArchive implements FeedArchive {
  private manifest: ArchiveManifest | null = null;
  private archivePath: string | null = null;
  private eventStream: WriteStream | null = null;
  private statusStream: WriteStream | null = null;
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
    this.eventStream = createWriteStream(path.join(this.archivePath, "events.jsonl"), { flags: "w" });
    this.statusStream = createWriteStream(path.join(this.archivePath, "statuses.jsonl"), { flags: "w" });
    await this.writeManifest();
  }

  recordEvent(event: UnifiedEvent) {
    if (!this.archivePath || !this.manifest) return;

    this.manifest.eventCount += 1;
    this.enqueueWrite(this.eventStream, event);
  }

  recordStatus(status: ConnectorStatus) {
    if (!this.archivePath || !this.manifest) return;

    this.manifest.statusCount += 1;
    this.enqueueWrite(this.statusStream, {
      recordedAt: new Date().toISOString(),
      status
    });
  }

  async stop(endedAt: string) {
    if (!this.manifest) return;

    this.manifest.endedAt = endedAt;
    await this.writes;
    await Promise.all([closeStream(this.eventStream), closeStream(this.statusStream)]);
    this.eventStream = null;
    this.statusStream = null;
    await this.writeManifest();
  }

  private enqueueWrite(stream: WriteStream | null, payload: unknown) {
    this.writes = this.writes
      .then(async () => {
        if (!stream) return;
        await writeStreamLine(stream, `${JSON.stringify(payload)}\n`);
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

function writeStreamLine(stream: WriteStream, line: string) {
  return new Promise<void>((resolve, reject) => {
    stream.write(line, "utf8", (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeStream(stream: WriteStream | null) {
  if (!stream) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      stream.off("finish", onFinish);
      reject(error);
    };
    const onFinish = () => {
      stream.off("error", onError);
      resolve();
    };

    stream.once("error", onError);
    stream.once("finish", onFinish);
    stream.end();
  });
}

export class CompositeFeedArchive implements FeedArchive {
  constructor(private readonly archives: FeedArchive[]) {}

  get sessionPath() {
    return this.archives.find((archive) => archive.sessionPath)?.sessionPath;
  }

  async start(session: FeedArchiveSession) {
    await Promise.all(this.archives.map((archive) => archive.start(session)));
  }

  recordEvent(event: UnifiedEvent) {
    for (const archive of this.archives) {
      archive.recordEvent(event);
    }
  }

  recordStatus(status: ConnectorStatus) {
    for (const archive of this.archives) {
      archive.recordStatus(status);
    }
  }

  async stop(endedAt: string) {
    await Promise.all(this.archives.map((archive) => archive.stop(endedAt)));
  }
}

export class SQLiteFeedArchive implements FeedArchive {
  private db: SQLiteDatabase | null = null;
  private sessionId: string | null = null;

  constructor(private readonly dbPath: string) {}

  get sessionPath() {
    return this.dbPath;
  }

  async start(session: FeedArchiveSession) {
    if (this.dbPath !== ":memory:") {
      await mkdir(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = await openSQLiteDatabase(this.dbPath);
    this.db.exec(sqliteSchema);
    this.sessionId = session.sessionId;
    this.db
      .prepare(
        `insert or replace into sessions (
          id,
          name,
          mode,
          started_at,
          ended_at,
          ingest_version,
          metadata_json
        ) values (?, ?, ?, ?, null, ?, ?)`
      )
      .run(
        session.sessionId,
        formatSessionName(session),
        session.mode,
        session.startedAt,
        "v1",
        JSON.stringify({
          bufferSize: session.bufferSize,
          fixtureIntervalMs: session.fixtureIntervalMs,
          fixtureBurstSize: session.fixtureBurstSize ?? 1,
          connectorPlatforms: session.connectorPlatforms
        })
      );
  }

  recordEvent(event: UnifiedEvent) {
    if (!this.db || !this.sessionId) return;

    const sourceKey = this.upsertSource({
      platform: event.platform,
      sourceChannelId: getEventSourceIdentityId(event),
      sourceName: getEventSourceName(event),
      displayLabel: formatPlatformSourceLabel(event)
    });

    this.db
      .prepare(
        `insert or ignore into events (
          id,
          session_id,
          source_key,
          platform,
          kind,
          platform_event_id,
          source_channel_id,
          source_channel_name,
          author_id,
          author_name,
          text,
          occurred_at,
          received_at,
          signal_score,
          badges_json,
          fragments_json,
          raw_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        this.sessionId,
        sourceKey,
        event.platform,
        event.kind,
        event.platformEventId,
        event.sourceChannelId ?? null,
        event.sourceChannelName ?? null,
        event.authorId ?? null,
        event.authorName ?? null,
        event.text ?? null,
        event.occurredAt,
        event.receivedAt,
        scoreEventSignal(event),
        JSON.stringify(event.badges),
        JSON.stringify(event.fragments),
        JSON.stringify(event.raw)
      );
  }

  recordStatus(status: ConnectorStatus) {
    if (!this.db || !this.sessionId) return;

    const sourceKey = this.upsertSource({
      platform: status.platform,
      sourceName: status.sourceName
    });

    this.db
      .prepare(
        `insert into connector_statuses (
          session_id,
          source_key,
          platform,
          state,
          label,
          source_name,
          recorded_at,
          last_event_at,
          event_count,
          dropped_count,
          reconnect_count,
          latency_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.sessionId,
        sourceKey,
        status.platform,
        status.state,
        status.label,
        status.sourceName,
        new Date().toISOString(),
        status.lastEventAt ?? null,
        status.eventCount,
        status.droppedCount,
        status.reconnectCount,
        status.latencyMs ?? null
      );
  }

  async stop(endedAt: string) {
    if (!this.db || !this.sessionId) return;

    this.db.prepare("update sessions set ended_at = ? where id = ?").run(endedAt, this.sessionId);
    this.db.close();
    this.db = null;
    this.sessionId = null;
  }

  private upsertSource(source: {
    platform: SourcePlatform;
    sourceChannelId?: string;
    sourceName: string;
    displayLabel?: string;
  }) {
    if (!this.db) return null;

    const sourceKey = buildSourceKey(source.platform, source.sourceChannelId, source.sourceName);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `insert into sources (
          source_key,
          platform,
          source_channel_id,
          source_name,
          display_label,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?)
        on conflict(source_key) do update set
          source_channel_id = excluded.source_channel_id,
          source_name = excluded.source_name,
          display_label = excluded.display_label,
          updated_at = excluded.updated_at`
      )
      .run(
        sourceKey,
        source.platform,
        source.sourceChannelId ?? null,
        source.sourceName,
        source.displayLabel ?? formatSourceDisplayLabel(source.platform, source.sourceName),
        now,
        now
      );

    return sourceKey;
  }
}

export function createFeedArchiveFromEnv(env: NodeJS.ProcessEnv = process.env): FeedArchive | null {
  if (env.FEED_ARCHIVE_ENABLED === "false") {
    return null;
  }

  const archives: FeedArchive[] = [new FileFeedArchive(path.resolve(env.FEED_ARCHIVE_DIR ?? "data/feed-sessions"))];

  if (env.FEED_DB_PATH) {
    archives.push(new SQLiteFeedArchive(resolveDatabasePath(env.FEED_DB_PATH)));
  }

  if (archives.length === 1) {
    return archives[0];
  }

  return new CompositeFeedArchive(archives);
}

export function createFeedSessionId(startedAt: string, mode: FeedArchiveSession["mode"]) {
  return `${startedAt.replace(/[:.]/g, "-")}-${mode}`;
}

const sqliteSchema = `
create table if not exists sources (
  source_key text primary key,
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  source_channel_id text,
  source_name text not null,
  display_label text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  name text not null,
  mode text not null check (mode in ('fixture', 'connectors', 'replay')),
  started_at text not null,
  ended_at text,
  ingest_version text not null default 'v1',
  metadata_json text not null default '{}'
);

create table if not exists connector_statuses (
  id integer primary key autoincrement,
  session_id text not null references sessions(id) on delete cascade,
  source_key text references sources(source_key) on delete set null,
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  state text not null,
  label text not null,
  source_name text not null,
  recorded_at text not null,
  last_event_at text,
  event_count integer not null default 0,
  dropped_count integer not null default 0,
  reconnect_count integer not null default 0,
  latency_ms integer
);

create table if not exists events (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  source_key text references sources(source_key) on delete set null,
  platform text not null check (platform in ('twitch', 'kick', 'x')),
  kind text not null,
  platform_event_id text not null,
  source_channel_id text,
  source_channel_name text,
  author_id text,
  author_name text,
  text text,
  occurred_at text not null,
  received_at text not null,
  signal_score integer not null default 0,
  badges_json text not null default '[]',
  fragments_json text not null default '[]',
  raw_json text not null,
  unique (platform, platform_event_id)
);

create index if not exists events_session_received_at_idx on events (session_id, received_at desc);
create index if not exists events_platform_received_at_idx on events (platform, received_at desc);
create index if not exists events_source_channel_idx on events (platform, source_channel_id);
create index if not exists connector_statuses_session_platform_idx on connector_statuses (session_id, platform);
`;

function getEventSourceName(event: UnifiedEvent) {
  if (event.platform === "x" && event.authorName) {
    return event.authorName;
  }

  return event.sourceChannelName ?? event.authorName ?? event.sourceChannelId ?? event.platform;
}

function getEventSourceIdentityId(event: UnifiedEvent) {
  if (event.platform === "x") {
    return event.authorId ?? event.authorName ?? event.sourceChannelId;
  }

  return event.sourceChannelId;
}

function buildSourceKey(platform: SourcePlatform, sourceChannelId: string | undefined, sourceName: string) {
  return [platform, sourceChannelId ?? sourceName.toLowerCase()].join(":");
}

function platformLabelsForSession(platforms: string[]) {
  return platforms.map((platform) => platform.toUpperCase()).join("+");
}

function formatSessionName(session: FeedArchiveSession) {
  if (session.mode === "fixture") {
    return "Fixture feed run";
  }

  const platformLabel = platformLabelsForSession(session.connectorPlatforms);

  return platformLabel ? `${platformLabel} connector run` : "Connector feed run";
}

function resolveDatabasePath(dbPath: string) {
  return dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
}

async function openSQLiteDatabase(dbPath: string) {
  const sqliteModuleName = "node:sqlite";
  const { DatabaseSync } = await import(sqliteModuleName);

  return new DatabaseSync(dbPath) as SQLiteDatabase;
}
