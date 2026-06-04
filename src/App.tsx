import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import {
  Activity,
  Archive,
  Ban,
  CheckCircle2,
  Circle,
  Download,
  FolderOpen,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Radio,
  Search,
  Shield,
  Square,
  Trash2,
  Upload,
  UserRound,
  Video,
  Zap
} from "lucide-react";
import {
  isSignalEvent,
  platformLabels,
  scoreEventSignal,
  type ConnectorStatus,
  type PlatformFilter,
  type SourcePlatform,
  type UnifiedEvent
} from "./domain/unifiedEvent";
import { recordingEventsToCsv, recordingExportSchema, type RecordingExport } from "./domain/recording";
import {
  createSavedSession,
  deleteArchivedSession,
  readSessionArchive,
  savedSessionToRecording,
  saveSessionArchive,
  type SavedSession
} from "./domain/sessionArchive";
import { useUnifiedFeed } from "./hooks/useUnifiedFeed";

const platforms: SourcePlatform[] = ["twitch", "kick", "x"];

const platformAccent: Record<SourcePlatform, string> = {
  twitch: "#a970ff",
  kick: "#67e85f",
  x: "#e8ecef"
};

const readinessRequirements: Record<SourcePlatform, string[]> = {
  twitch: ["TWITCH_CLIENT_ID", "TWITCH_ACCESS_TOKEN", "TWITCH_BROADCASTER_USER_ID", "TWITCH_BOT_USER_ID"],
  kick: ["KICK_WEBHOOK_ENABLED=true", "public /webhooks/kick URL", "KICK_ACCESS_TOKEN for auto subscribe"],
  x: ["X_BEARER_TOKEN", "X_FILTER_RULES or X_SPACES_QUERY"]
};

export function App() {
  const [obsMode] = useState(readObsMode);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>({
    twitch: true,
    kick: true,
    x: true
  });
  const [query, setQuery] = useState("");
  const [signalOnly, setSignalOnly] = useState(false);
  const [submissionMode, setSubmissionMode] = useState(obsMode);
  const [recording, setRecording] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<UnifiedEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const recordedIdsRef = useRef(new Set<string>());
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pinnedToLive, setPinnedToLive] = useState(true);
  const [importedReplay, setImportedReplay] = useState<ImportedReplay | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState(() => readSessionArchive());
  const [sessionArchiveError, setSessionArchiveError] = useState<string | null>(null);
  const { events, statuses, paused, setPaused, clear, transportLabel, transportState } =
    useUnifiedFeed(platformFilter);
  const feedEvents = importedReplay?.events ?? events;
  const effectiveTransportLabel = importedReplay ? `Replay: ${importedReplay.fileName}` : transportLabel;
  const effectiveTransportState = importedReplay ? "replay" : transportState;

  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return feedEvents.filter((event) => {
      if (!platformFilter[event.platform]) return false;
      if (signalOnly && !isSignalEvent(event)) return false;
      if (!normalizedQuery) return true;

      const searchTarget = [
        event.text,
        event.authorName,
        event.sourceChannelName,
        event.kind,
        platformLabels[event.platform]
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchTarget.includes(normalizedQuery);
    });
  }, [feedEvents, platformFilter, query, signalOnly]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((event) => event.id === selectedEventId) ?? visibleEvents[0],
    [selectedEventId, visibleEvents]
  );

  const totalEvents = feedEvents.length;
  const signalCount = feedEvents.filter(isSignalEvent).length;
  const activeSources = platforms.filter((platform) => platformFilter[platform]).length;
  const readinessItems = useMemo(
    () => buildReadinessItems(statuses, effectiveTransportState),
    [statuses, effectiveTransportState]
  );
  const selectedAuthorProfile = useMemo(
    () => (selectedEvent ? buildAuthorProfile(selectedEvent, feedEvents) : null),
    [feedEvents, selectedEvent]
  );

  useEffect(() => {
    document.body.classList.toggle("obs-body", obsMode);

    return () => {
      document.body.classList.remove("obs-body");
    };
  }, [obsMode]);

  useEffect(() => {
    if (!pinnedToLive) return;

    scrollEventListToTop(eventListRef.current);
  }, [pinnedToLive, visibleEvents.length]);

  useEffect(() => {
    if (!recording) return;

    setRecordedEvents((currentEvents) => {
      const nextEvents = [...currentEvents];

      for (const event of [...feedEvents].reverse()) {
        if (!recordedIdsRef.current.has(event.id)) {
          recordedIdsRef.current.add(event.id);
          nextEvents.push(event);
        }
      }

      return nextEvents;
    });
  }, [feedEvents, recording]);

  function togglePlatform(platform: SourcePlatform) {
    setPlatformFilter((current) => ({
      ...current,
      [platform]: !current[platform]
    }));
  }

  function toggleRecording() {
    if (recording) {
      setRecording(false);
      return;
    }

    recordedIdsRef.current = new Set(feedEvents.map((event) => event.id));
    setRecordedEvents([...feedEvents].reverse());
    setRecording(true);
  }

  function exportRecording() {
    const payload = buildRecordingExport(recordedEvents, effectiveTransportLabel, effectiveTransportState);

    downloadBlob(JSON.stringify(payload, null, 2), "application/json", "json");
  }

  function exportRecordingCsv() {
    downloadBlob(recordingEventsToCsv(recordedEvents), "text/csv;charset=utf-8", "csv");
  }

  function handleEventListScroll(event: UIEvent<HTMLDivElement>) {
    setPinnedToLive(event.currentTarget.scrollTop <= 12);
  }

  function jumpToLive() {
    scrollEventListToTop(eventListRef.current);
    setPinnedToLive(true);
  }

  async function importRecording(file: File | undefined) {
    if (!file) return;

    setImportError(null);

    try {
      const parsedRecording = recordingExportSchema.parse(JSON.parse(await file.text()));
      const replayEvents = [...parsedRecording.events].reverse();

      setImportedReplay({
        ...parsedRecording,
        fileName: file.name,
        events: replayEvents
      });
      setPaused(true);
      setRecording(false);
      setSelectedEventId(null);
      setPinnedToLive(true);
      recordedIdsRef.current = new Set();
    } catch {
      setImportError("Could not import that recording JSON.");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  function exitReplay() {
    setImportedReplay(null);
    setImportError(null);
    setPinnedToLive(true);
  }

  function saveCurrentSession() {
    setSessionArchiveError(null);

    try {
      const recording = buildRecordingExport([...feedEvents].reverse(), effectiveTransportLabel, effectiveTransportState);
      const session = createSavedSession({
        name: `${effectiveTransportLabel} - ${feedEvents.length} events`,
        recording
      });

      setSavedSessions(saveSessionArchive(session));
    } catch {
      setSessionArchiveError("Could not save this session.");
    }
  }

  function loadSavedSession(session: SavedSession) {
    const recording = savedSessionToRecording(session);

    setImportedReplay({
      ...recording,
      fileName: session.name,
      events: [...recording.events].reverse()
    });
    setPaused(true);
    setRecording(false);
    setSelectedEventId(null);
    setPinnedToLive(true);
  }

  function deleteSavedSession(id: string) {
    setSavedSessions(deleteArchivedSession(id));
  }

  function clearFeed() {
    if (importedReplay) {
      exitReplay();
      return;
    }

    clear();
  }

  return (
    <main
      className="app-shell"
      data-obs={obsMode}
      data-recording={recording}
      data-submission={submissionMode}
    >
      <aside className="source-rail" aria-label="Source controls">
        <div className="brand-block">
          <div className="brand-mark">MB</div>
          <div>
            <h1>Market Bubble Feed</h1>
            <p>Unified live stream</p>
          </div>
        </div>

        <section className="rail-section">
          <SectionTitle icon={<Radio size={15} />} title="Sources" />
          <div className="source-list">
            {platforms.map((platform) => (
              <button
                className="source-toggle"
                data-active={platformFilter[platform]}
                key={platform}
                onClick={() => togglePlatform(platform)}
                style={{ "--accent": platformAccent[platform] } as CSSProperties}
                type="button"
              >
                <span className="source-dot" />
                <span>{platformLabels[platform]}</span>
                <span className="source-state">{platformFilter[platform] ? "Live" : "Muted"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section">
          <SectionTitle icon={<Shield size={15} />} title="Modes" />
          <button
            className="mode-toggle"
            data-active={signalOnly}
            onClick={() => setSignalOnly((enabled) => !enabled)}
            type="button"
          >
            <Zap size={15} />
            <span>Signal mode</span>
          </button>
          <button
            className="mode-toggle"
            data-active={submissionMode}
            onClick={() => setSubmissionMode((enabled) => !enabled)}
            type="button"
          >
            <Maximize2 size={15} />
            <span>Submission mode</span>
          </button>
        </section>

        <section className="rail-section metrics-grid">
          <Metric label="Events" value={totalEvents} />
          <Metric label="Signals" value={signalCount} />
          <Metric label="Sources" value={activeSources} />
          <Metric label="Buffer" value="250" />
        </section>
      </aside>

      <section className="feed-panel" aria-label="Unified feed">
        <header className="topbar">
          <div>
            <p className="eyeline">
              {recording ? `Recording ${effectiveTransportLabel.toLowerCase()}` : effectiveTransportLabel}
            </p>
            <h2>Unified chat aggregator</h2>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="Search feed"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search author, channel, keyword"
                type="search"
                value={query}
              />
            </label>
            <button className="icon-button" onClick={() => setPaused(!paused)} type="button">
              {paused ? <Play size={17} /> : <Pause size={17} />}
              <span>{paused ? "Resume" : "Pause"}</span>
            </button>
            <button className="icon-button" data-active={recording} onClick={toggleRecording} type="button">
              {recording ? <Square size={15} /> : <Video size={17} />}
              <span>{recording ? "Stop" : "Record"}</span>
            </button>
            <button className="icon-button" onClick={clearFeed} type="button">
              <Trash2 size={17} />
              <span>{importedReplay ? "Exit replay" : "Clear"}</span>
            </button>
          </div>
        </header>

        <div className="feed-toolbar">
          <span>{visibleEvents.length} visible</span>
          <button
            className="live-button"
            data-active={pinnedToLive}
            disabled={visibleEvents.length === 0}
            onClick={jumpToLive}
            type="button"
          >
            <Circle size={8} fill="currentColor" />
            <span>{pinnedToLive ? "Live" : "Jump live"}</span>
          </button>
          <span>{paused ? "Paused" : "Streaming"}</span>
          <span>{effectiveTransportState}</span>
          <span>{recordedEvents.length} recorded</span>
          <span>Newest first</span>
        </div>

        <div
          className="event-list"
          onScroll={handleEventListScroll}
          ref={eventListRef}
          role="log"
          aria-live={paused ? "off" : "polite"}
        >
          {visibleEvents.length > 0 ? (
            visibleEvents.map((event) => (
              <EventRow
                event={event}
                key={event.id}
                onSelect={() => setSelectedEventId(event.id)}
                query={query}
                selected={event.id === selectedEvent?.id}
              />
            ))
          ) : (
            <EmptyState />
          )}
        </div>
      </section>

      <aside className="detail-rail" aria-label="Diagnostics">
        <section className="detail-section">
          <SectionTitle icon={<Gauge size={15} />} title="Connectors" />
          <div className="status-list">
            {statuses.map((status) => (
              <ConnectorCard key={status.platform} status={status} />
            ))}
          </div>
        </section>

        <section className="detail-section">
          <SectionTitle icon={<CheckCircle2 size={15} />} title="Readiness" />
          <ReadinessPanel items={readinessItems} transportState={effectiveTransportState} />
        </section>

        <section className="detail-section selected-event">
          <SectionTitle icon={<UserRound size={15} />} title="Author" />
          {selectedAuthorProfile ? <AuthorDetail profile={selectedAuthorProfile} /> : <EmptyDetail />}
        </section>

        <section className="detail-section selected-event">
          <SectionTitle icon={<Activity size={15} />} title="Selected event" />
          {selectedEvent ? <EventDetail event={selectedEvent} /> : <EmptyDetail />}
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Archive size={15} />} title="Sessions" />
          <SessionArchive
            eventsDisabled={feedEvents.length === 0}
            onDelete={deleteSavedSession}
            onLoad={loadSavedSession}
            onSave={saveCurrentSession}
            sessions={savedSessions}
          />
          {sessionArchiveError ? <p className="detail-error">{sessionArchiveError}</p> : null}
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Download size={15} />} title="Export" />
          <input
            accept="application/json"
            className="file-input"
            onChange={(event) => {
              void importRecording(event.target.files?.[0]);
            }}
            ref={importInputRef}
            type="file"
          />
          <button className="wide-button" onClick={() => importInputRef.current?.click()} type="button">
            <Upload size={15} />
            Import recording JSON
          </button>
          <button className="wide-button" disabled={recordedEvents.length === 0} onClick={exportRecording} type="button">
            Export recording JSON
          </button>
          <button
            className="wide-button"
            disabled={recordedEvents.length === 0}
            onClick={exportRecordingCsv}
            type="button"
          >
            Export recording CSV
          </button>
          <p className="detail-note">
            {importedReplay
              ? `${importedReplay.eventCount} imported events from ${importedReplay.source}.`
              : "Recording captures the current replay buffer and every new event while active."}
          </p>
          {importError ? <p className="detail-error">{importError}</p> : null}
        </section>
      </aside>
    </main>
  );
}

type ImportedReplay = Omit<RecordingExport, "events"> & {
  fileName: string;
  events: UnifiedEvent[];
};

type AppTransportState = ReturnType<typeof useUnifiedFeed>["transportState"] | "replay";

type ReadinessItem = {
  platform: SourcePlatform;
  state: "ready" | "watching" | "setup" | "attention";
  title: string;
  detail: string;
  requirements: string[];
};

type AuthorProfile = {
  platformLabel: string;
  sourceLabel: string;
  authorLabel: string;
  sourceAccount: string;
  badgeLabels: string[];
  authorEventCount: number;
  sourceEventCount: number;
  signalScore: number;
  authorId: string;
  sourceId: string;
};

function buildRecordingExport(
  events: UnifiedEvent[],
  source: string,
  transportState: AppTransportState
): RecordingExport {
  return {
    exportedAt: new Date().toISOString(),
    source,
    transportState,
    eventCount: events.length,
    events
  };
}

function downloadBlob(content: string, type: string, extension: "csv" | "json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `market-bubble-feed-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

function readObsMode() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("obs") === "1";
}

function scrollEventListToTop(list: HTMLDivElement | null) {
  if (!list) return;

  if (typeof list.scrollTo === "function") {
    list.scrollTo({ top: 0 });
    return;
  }

  list.scrollTop = 0;
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EventRow({
  event,
  onSelect,
  query,
  selected
}: {
  event: UnifiedEvent;
  onSelect: () => void;
  query: string;
  selected: boolean;
}) {
  const signalScore = scoreEventSignal(event);
  const timestamp = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(event.occurredAt));

  return (
    <button
      className="event-row native-event-row"
      data-platform={event.platform}
      data-selected={selected}
      onClick={onSelect}
      style={{ "--accent": platformAccent[event.platform] } as CSSProperties}
      type="button"
    >
      <span className="platform-label" title={formatPlatformSourceLabel(event)}>
        {formatPlatformSourceLabel(event)}
      </span>
      <span className="native-event-body">
        <span className="native-event-head">
          <span className="event-author" style={{ color: event.authorColor ?? "var(--text)" }}>
            {formatAuthor(event)}
          </span>
          <span className="event-source">{formatSourceMeta(event)}</span>
          <span className="event-time">{timestamp}</span>
        </span>
        <span className="event-text">{highlightQuery(event.text ?? event.kind, query)}</span>
        {event.badges.length > 0 ? (
          <span className="badge-strip">
            {event.badges.map((badge) => (
              <span className="native-badge" key={`${badge.type}-${badge.label}`}>
                {badge.label}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="signal-score">{signalScore > 0 ? signalScore : ""}</span>
    </button>
  );
}

function ConnectorCard({ status }: { status: ConnectorStatus }) {
  return (
    <div className="connector-card" data-state={status.state}>
      <div className="connector-heading">
        <span className="connector-name">
          <Circle size={9} fill="currentColor" />
          {platformLabels[status.platform]}
        </span>
        <span>{status.state.replace("_", " ")}</span>
      </div>
      <div className="connector-meta">
        <span>{status.label}</span>
        <span>{status.sourceName}</span>
      </div>
      <div className="connector-stats">
        <Metric label="events" value={status.eventCount} />
        <Metric label="drops" value={status.droppedCount} />
        <Metric label="latency" value={status.latencyMs ? `${Math.round(status.latencyMs)}ms` : "n/a"} />
      </div>
    </div>
  );
}

function SessionArchive({
  eventsDisabled,
  onDelete,
  onLoad,
  onSave,
  sessions
}: {
  eventsDisabled: boolean;
  onDelete: (id: string) => void;
  onLoad: (session: SavedSession) => void;
  onSave: () => void;
  sessions: SavedSession[];
}) {
  return (
    <div className="session-archive">
      <button className="wide-button" disabled={eventsDisabled} onClick={onSave} type="button">
        <Archive size={15} />
        Save current buffer
      </button>
      <p className="detail-note">{sessions.length} saved sessions. New saves keep the latest 12 sessions.</p>
      <div className="session-list">
        {sessions.map((session) => (
          <div className="session-card" key={session.id}>
            <button className="session-load" onClick={() => onLoad(session)} type="button">
              <FolderOpen size={14} />
              <span>
                <strong>{session.name}</strong>
                <span>
                  {session.eventCount} events saved {formatRelativeTime(session.savedAt)}
                </span>
              </span>
            </button>
            <button
              aria-label={`Delete ${session.name}`}
              className="session-delete"
              onClick={() => onDelete(session.id)}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessPanel({
  items,
  transportState
}: {
  items: ReadinessItem[];
  transportState: AppTransportState;
}) {
  return (
    <div className="readiness-panel">
      <p className="readiness-summary">
        {transportState === "fixture"
          ? "Fixture mode active. Add live connector credentials before recording the real stream."
          : transportState === "replay"
            ? "Replay mode active. Exit replay to reconnect to live sources."
            : "Live readiness is based on connector state, recent events, and configured sources."}
      </p>
      <div className="readiness-list">
        {items.map((item) => (
          <div className="readiness-item" data-state={item.state} key={item.platform}>
            <div className="readiness-heading">
              <span>{item.title}</span>
              <strong>{item.state}</strong>
            </div>
            <p>{item.detail}</p>
            <div className="readiness-requirements">
              {item.requirements.map((requirement) => (
                <code key={requirement}>{requirement}</code>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthorDetail({ profile }: { profile: AuthorProfile }) {
  return (
    <div className="author-detail">
      <div className="author-card">
        <span className="author-platform">{profile.platformLabel}</span>
        <strong>{profile.authorLabel}</strong>
        <span>{profile.sourceLabel}</span>
      </div>
      <div className="author-stats">
        <Metric label="author events" value={profile.authorEventCount} />
        <Metric label="source events" value={profile.sourceEventCount} />
        <Metric label="signal" value={profile.signalScore} />
      </div>
      <div className="detail-line">
        <span>Source account</span>
        <strong>{profile.sourceAccount}</strong>
      </div>
      <div className="detail-line">
        <span>Badges</span>
        <strong>{profile.badgeLabels.length > 0 ? profile.badgeLabels.join(", ") : "none"}</strong>
      </div>
      <div className="raw-block">
        <span>Author ID</span>
        <code>{profile.authorId}</code>
      </div>
      <div className="raw-block">
        <span>Source ID</span>
        <code>{profile.sourceId}</code>
      </div>
    </div>
  );
}

function EventDetail({ event }: { event: UnifiedEvent }) {
  return (
    <div className="event-detail">
      <div className="detail-line">
        <span>Platform</span>
        <strong>{platformLabels[event.platform]}</strong>
      </div>
      <div className="detail-line">
        <span>Kind</span>
        <strong>{event.kind.replace("_", " ")}</strong>
      </div>
      <div className="detail-line">
        <span>Source</span>
        <strong>{event.sourceChannelName ?? "n/a"}</strong>
      </div>
      <div className="detail-line">
        <span>Author</span>
        <strong>{event.authorName ?? "system"}</strong>
      </div>
      <div className="detail-copy">{event.text}</div>
      <div className="raw-block">
        <span>ID</span>
        <code>{event.platformEventId}</code>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <Ban size={22} />
      <strong>No events visible</strong>
      <span>Adjust source filters or search.</span>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="empty-detail">
      <span>Select an event.</span>
    </div>
  );
}

function buildAuthorProfile(event: UnifiedEvent, events: UnifiedEvent[]): AuthorProfile {
  const authorKey = event.authorId ?? event.authorName ?? event.sourceChannelName ?? event.platformEventId;
  const sourceKey = event.sourceChannelId ?? event.sourceChannelName ?? event.platform;
  const authorEventCount = events.filter(
    (feedEvent) =>
      feedEvent.platform === event.platform &&
      (feedEvent.authorId ?? feedEvent.authorName ?? feedEvent.sourceChannelName ?? feedEvent.platformEventId) ===
        authorKey
  ).length;
  const sourceEventCount = events.filter(
    (feedEvent) =>
      feedEvent.platform === event.platform &&
      (feedEvent.sourceChannelId ?? feedEvent.sourceChannelName ?? feedEvent.platform) === sourceKey
  ).length;

  return {
    platformLabel: platformLabels[event.platform],
    sourceLabel: formatPlatformSourceLabel(event),
    authorLabel: formatAuthor(event),
    sourceAccount: event.sourceChannelName ?? "n/a",
    badgeLabels: event.badges.map((badge) => badge.label),
    authorEventCount,
    sourceEventCount,
    signalScore: scoreEventSignal(event),
    authorId: event.authorId ?? "n/a",
    sourceId: event.sourceChannelId ?? "n/a"
  };
}

function formatRelativeTime(dateTime: string) {
  const elapsedMs = Date.now() - new Date(dateTime).getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes === 1) return "1 min ago";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.round(elapsedMinutes / 60);

  if (elapsedHours === 1) return "1 hour ago";
  if (elapsedHours < 24) return `${elapsedHours} hours ago`;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(dateTime));
}

function buildReadinessItems(statuses: ConnectorStatus[], transportState: AppTransportState): ReadinessItem[] {
  const statusMap = new Map(statuses.map((status) => [status.platform, status]));

  return platforms.map((platform) => {
    const status = statusMap.get(platform);
    const platformName = platformLabels[platform];
    const title = `${platformName} (${status?.sourceName ?? "not selected"})`;
    const requirements = readinessRequirements[platform];

    if (transportState === "fixture") {
      return {
        platform,
        state: "setup",
        title,
        detail: "Currently showing fixture data, not the live platform.",
        requirements
      };
    }

    if (transportState === "replay") {
      return {
        platform,
        state: "watching",
        title,
        detail: "Replay is loaded from a recording file.",
        requirements
      };
    }

    if (!status || status.state === "stopped") {
      return {
        platform,
        state: "setup",
        title,
        detail: "Connector has not started for this source.",
        requirements
      };
    }

    if (status.state === "unauthorized") {
      return {
        platform,
        state: "attention",
        title,
        detail: "Auth failed. Refresh the token or app permissions before the live run.",
        requirements
      };
    }

    if (status.state === "rate_limited" || status.state === "degraded") {
      return {
        platform,
        state: "attention",
        title,
        detail: status.label,
        requirements
      };
    }

    if (status.state === "connecting" || status.state === "reconnecting") {
      return {
        platform,
        state: "watching",
        title,
        detail: status.label,
        requirements
      };
    }

    return {
      platform,
      state: status.eventCount > 0 ? "ready" : "watching",
      title,
      detail: status.eventCount > 0 ? `${status.eventCount} events received.` : "Connected, waiting for first event.",
      requirements
    };
  });
}

function formatAuthor(event: UnifiedEvent) {
  if (event.platform === "x" && event.authorName) {
    return `@${event.authorName}`;
  }

  return event.authorName ?? event.sourceChannelName ?? "system";
}

function formatPlatformSourceLabel(event: UnifiedEvent) {
  const accountName =
    event.platform === "x" ? event.authorName ?? event.sourceChannelName : event.sourceChannelName ?? event.authorName;
  const normalizedAccount = accountName?.replace(/^#|^@/, "").trim();
  const platformName = platformLabels[event.platform].toUpperCase();

  if (!normalizedAccount) {
    return platformName;
  }

  if (event.platform === "x" && event.authorName) {
    return `${platformName} (@${normalizedAccount.toUpperCase()})`;
  }

  return `${platformName} (${normalizedAccount.toUpperCase()})`;
}

function formatSourceMeta(event: UnifiedEvent) {
  if (event.platform === "twitch") {
    return event.sourceChannelName ? `#${event.sourceChannelName}` : "chat";
  }

  if (event.platform === "kick") {
    return event.sourceChannelName ? `${event.sourceChannelName} chat` : "chat";
  }

  if (event.kind === "space_metadata") {
    return "live Space";
  }

  return "filtered post";
}

function highlightQuery(text: string, query: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return text;
  }

  const startIndex = text.toLowerCase().indexOf(normalizedQuery.toLowerCase());

  if (startIndex === -1) {
    return text;
  }

  const before = text.slice(0, startIndex);
  const match = text.slice(startIndex, startIndex + normalizedQuery.length);
  const after = text.slice(startIndex + normalizedQuery.length);

  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  );
}
