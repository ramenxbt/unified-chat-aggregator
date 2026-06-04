import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import {
  Activity,
  Ban,
  Circle,
  Download,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Radio,
  Search,
  Shield,
  Square,
  Trash2,
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
import { useUnifiedFeed } from "./hooks/useUnifiedFeed";

const platforms: SourcePlatform[] = ["twitch", "kick", "x"];

const platformAccent: Record<SourcePlatform, string> = {
  twitch: "#a970ff",
  kick: "#67e85f",
  x: "#e8ecef"
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
  const [pinnedToLive, setPinnedToLive] = useState(true);
  const { events, statuses, paused, setPaused, clear, transportLabel, transportState } =
    useUnifiedFeed(platformFilter);

  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return events.filter((event) => {
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
  }, [events, platformFilter, query, signalOnly]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((event) => event.id === selectedEventId) ?? visibleEvents[0],
    [selectedEventId, visibleEvents]
  );

  const totalEvents = events.length;
  const signalCount = events.filter(isSignalEvent).length;
  const activeSources = platforms.filter((platform) => platformFilter[platform]).length;

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

      for (const event of [...events].reverse()) {
        if (!recordedIdsRef.current.has(event.id)) {
          recordedIdsRef.current.add(event.id);
          nextEvents.push(event);
        }
      }

      return nextEvents;
    });
  }, [events, recording]);

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

    recordedIdsRef.current = new Set(events.map((event) => event.id));
    setRecordedEvents([...events].reverse());
    setRecording(true);
  }

  function exportRecording() {
    const payload = {
      exportedAt: new Date().toISOString(),
      source: transportLabel,
      transportState,
      eventCount: recordedEvents.length,
      events: recordedEvents
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `market-bubble-feed-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleEventListScroll(event: UIEvent<HTMLDivElement>) {
    setPinnedToLive(event.currentTarget.scrollTop <= 12);
  }

  function jumpToLive() {
    scrollEventListToTop(eventListRef.current);
    setPinnedToLive(true);
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
              {recording ? `Recording ${transportLabel.toLowerCase()}` : transportLabel}
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
            <button className="icon-button" onClick={clear} type="button">
              <Trash2 size={17} />
              <span>Clear</span>
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
          <span>{transportState}</span>
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

        <section className="detail-section selected-event">
          <SectionTitle icon={<Activity size={15} />} title="Selected event" />
          {selectedEvent ? <EventDetail event={selectedEvent} /> : <EmptyDetail />}
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Download size={15} />} title="Export" />
          <button className="wide-button" disabled={recordedEvents.length === 0} onClick={exportRecording} type="button">
            Export recording JSON
          </button>
          <p className="detail-note">
            Recording captures the current replay buffer and every new event while active.
          </p>
        </section>
      </aside>
    </main>
  );
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
