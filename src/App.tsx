import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import {
  Activity,
  Archive,
  AlertTriangle,
  AtSign,
  Ban,
  CheckCircle2,
  Circle,
  Download,
  FolderOpen,
  Gauge,
  Link2,
  Maximize2,
  Pause,
  Play,
  Radio,
  Search,
  Shield,
  Shuffle,
  Square,
  Target,
  Trash2,
  Upload,
  UserRound,
  Video,
  Zap
} from "lucide-react";
import {
  formatPlatformSourceLabel,
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
  const [viewPreset] = useState(readViewPreset);
  const [obsMode] = useState(viewPreset.obsMode);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(viewPreset.platformFilter);
  const [query, setQuery] = useState(viewPreset.query);
  const [signalOnly, setSignalOnly] = useState(viewPreset.signalOnly);
  const [submissionMode, setSubmissionMode] = useState(obsMode);
  const [recording, setRecording] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<UnifiedEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<FeedEntityFilter | null>(null);
  const [sourceAccountFilter, setSourceAccountFilter] = useState<FeedEntityFilter | null>(null);
  const [feedOrder, setFeedOrder] = useState<FeedOrder>("newest");
  const recordedIdsRef = useRef(new Set<string>());
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pinnedToLive, setPinnedToLive] = useState(true);
  const [importedReplay, setImportedReplay] = useState<ImportedReplay | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [replayLinkStatus, setReplayLinkStatus] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState(() => readSessionArchive());
  const [sessionArchiveError, setSessionArchiveError] = useState<string | null>(null);
  const { events, statuses, paused, setPaused, clear, transportLabel, transportState } =
    useUnifiedFeed(platformFilter);
  const feedEvents = importedReplay?.events ?? events;
  const effectiveTransportLabel = importedReplay ? `Replay: ${importedReplay.fileName}` : transportLabel;
  const effectiveTransportState = importedReplay ? "replay" : transportState;

  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filteredEvents = feedEvents.filter((event) => {
      if (!platformFilter[event.platform]) return false;
      if (signalOnly && !isSignalEvent(event)) return false;
      if (authorFilter && getAuthorKey(event) !== authorFilter.key) return false;
      if (sourceAccountFilter && getSourceAccountKey(event) !== sourceAccountFilter.key) return false;
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

    if (feedOrder === "oldest") {
      return [...filteredEvents].reverse();
    }

    return filteredEvents;
  }, [authorFilter, feedEvents, feedOrder, platformFilter, query, signalOnly, sourceAccountFilter]);

  const displayedEvents = viewPreset.limit ? visibleEvents.slice(0, viewPreset.limit) : visibleEvents;

  const selectedEvent = useMemo(
    () => displayedEvents.find((event) => event.id === selectedEventId) ?? displayedEvents[0],
    [displayedEvents, selectedEventId]
  );

  const totalEvents = feedEvents.length;
  const signalCount = feedEvents.filter(isSignalEvent).length;
  const activeSources = platforms.filter((platform) => platformFilter[platform]).length;
  const performanceSummary = useMemo(() => buildPerformanceSummary(feedEvents), [feedEvents]);
  const readinessItems = useMemo(
    () => buildReadinessItems(statuses, effectiveTransportState),
    [statuses, effectiveTransportState]
  );
  const selectedAuthorProfile = useMemo(
    () => (selectedEvent ? buildAuthorProfile(selectedEvent, feedEvents) : null),
    [feedEvents, selectedEvent]
  );
  const sourceAccountSummaries = useMemo(() => buildSourceAccountSummaries(feedEvents), [feedEvents]);
  const sourceIdentityGroups = useMemo(() => buildSourceIdentityGroups(sourceAccountSummaries), [sourceAccountSummaries]);
  const moderationItems = useMemo(() => buildModerationItems(feedEvents), [feedEvents]);
  const obsPresetLinks = useMemo(buildObsPresetLinks, []);

  useEffect(() => {
    document.body.classList.toggle("obs-body", obsMode);

    return () => {
      document.body.classList.remove("obs-body");
    };
  }, [obsMode]);

  useEffect(() => {
    const recording = readReplayLinkRecording();
    if (!recording) return;

    setImportedReplay({
      ...recording,
      fileName: "shared replay link",
      events: [...recording.events].reverse()
    });
    setPaused(true);
    setRecording(false);
    setSelectedEventId(null);
    setPinnedToLive(true);
    recordedIdsRef.current = new Set();
  }, [setPaused]);

  useEffect(() => {
    if (!pinnedToLive) return;

    scrollEventListToLiveEdge(eventListRef.current, feedOrder);
  }, [displayedEvents.length, feedOrder, pinnedToLive]);

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

  async function copyReplayLink() {
    setReplayLinkStatus(null);

    try {
      const recording = buildRecordingExport([...feedEvents].reverse(), effectiveTransportLabel, effectiveTransportState);
      const href = buildReplayLink(recording);

      if (!navigator.clipboard?.writeText) {
        setReplayLinkStatus("Clipboard unavailable.");
        return;
      }

      await navigator.clipboard.writeText(href);
      setReplayLinkStatus(`${recording.eventCount} event replay link copied.`);
    } catch {
      setReplayLinkStatus("Could not create replay link.");
    }
  }

  function handleEventListScroll(event: UIEvent<HTMLDivElement>) {
    setPinnedToLive(isAtLiveEdge(event.currentTarget, feedOrder));
  }

  function jumpToLive() {
    scrollEventListToLiveEdge(eventListRef.current, feedOrder);
    setPinnedToLive(true);
  }

  function toggleFeedOrder() {
    setFeedOrder((currentOrder) => (currentOrder === "newest" ? "oldest" : "newest"));
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
      setReplayLinkStatus(null);
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
    clearReplayLinkHash();
    setReplayLinkStatus(null);
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
    setAuthorFilter(null);
    setSourceAccountFilter(null);
  }

  function toggleAuthorFilter(profile: AuthorProfile) {
    setAuthorFilter((current) =>
      current?.key === profile.authorKey
        ? null
        : {
            key: profile.authorKey,
            label: profile.authorLabel
          }
    );
  }

  function toggleSourceAccountFilter(profile: AuthorProfile) {
    setSourceAccountFilter((current) =>
      current?.key === profile.sourceKey
        ? null
        : {
            key: profile.sourceKey,
            label: profile.sourceLabel
          }
    );
  }

  function toggleSourceAccountSummaryFilter(account: SourceAccountSummary) {
    setSourceAccountFilter((current) =>
      current?.key === account.key
        ? null
        : {
            key: account.key,
            label: account.label
          }
    );
  }

  function focusSourceIdentity(group: SourceIdentityGroup) {
    setQuery(group.query);
    setAuthorFilter(null);
    setSourceAccountFilter(null);
  }

  function reviewModerationItem(item: ModerationItem) {
    setPlatformFilter(defaultViewPreset().platformFilter);
    setQuery("");
    setSignalOnly(false);
    setAuthorFilter(null);
    setSourceAccountFilter(null);
    setSelectedEventId(item.event.id);
    setPinnedToLive(false);
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
          <span>{displayedEvents.length} visible</span>
          <button className="order-button" onClick={toggleFeedOrder} type="button">
            <Shuffle size={12} />
            <span>{feedOrder === "newest" ? "Newest first" : "Oldest first"}</span>
          </button>
          <button
            className="live-button"
            data-active={pinnedToLive}
            disabled={displayedEvents.length === 0}
            onClick={jumpToLive}
            type="button"
          >
            <Circle size={8} fill="currentColor" />
            <span>{pinnedToLive ? "Live" : "Jump live"}</span>
          </button>
          <span>{paused ? "Paused" : "Streaming"}</span>
          <span>{effectiveTransportState}</span>
          <span>{recordedEvents.length} recorded</span>
          {sourceAccountFilter ? <span>Source: {sourceAccountFilter.label}</span> : null}
          {authorFilter ? <span>Author: {authorFilter.label}</span> : null}
          <span>{feedOrder === "newest" ? "Live at top" : "Live at bottom"}</span>
        </div>

        <div
          className="event-list"
          onScroll={handleEventListScroll}
          ref={eventListRef}
          role="log"
          aria-live={paused ? "off" : "polite"}
        >
          {displayedEvents.length > 0 ? (
            displayedEvents.map((event) => (
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
          <SectionTitle icon={<AlertTriangle size={15} />} title="Review queue" />
          <ModerationQueue items={moderationItems} onReview={reviewModerationItem} />
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Activity size={15} />} title="Performance" />
          <PerformancePanel summary={performanceSummary} />
        </section>

        <section className="detail-section">
          <SectionTitle icon={<AtSign size={15} />} title="Accounts" />
          <SourceAccountsPanel
            accounts={sourceAccountSummaries}
            activeFilter={sourceAccountFilter}
            onToggle={toggleSourceAccountSummaryFilter}
          />
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Target size={15} />} title="Identities" />
          <SourceIdentitiesPanel groups={sourceIdentityGroups} onFocus={focusSourceIdentity} />
        </section>

        <section className="detail-section">
          <SectionTitle icon={<CheckCircle2 size={15} />} title="Readiness" />
          <ReadinessPanel items={readinessItems} transportState={effectiveTransportState} />
        </section>

        <section className="detail-section">
          <SectionTitle icon={<Link2 size={15} />} title="OBS presets" />
          <ObsPresetLinks links={obsPresetLinks} />
        </section>

        <section className="detail-section selected-event">
          <SectionTitle icon={<UserRound size={15} />} title="Author" />
          {selectedAuthorProfile ? (
            <AuthorDetail
              activeAuthorFilter={authorFilter}
              activeSourceAccountFilter={sourceAccountFilter}
              onToggleAuthorFilter={toggleAuthorFilter}
              onToggleSourceAccountFilter={toggleSourceAccountFilter}
              profile={selectedAuthorProfile}
            />
          ) : (
            <EmptyDetail />
          )}
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
          <button className="wide-button" disabled={feedEvents.length === 0} onClick={() => void copyReplayLink()} type="button">
            Copy replay link
          </button>
          <p className="detail-note">
            {importedReplay
              ? `${importedReplay.eventCount} imported events from ${importedReplay.source}.`
              : "Recording captures the current replay buffer and every new event while active."}
          </p>
          {importError ? <p className="detail-error">{importError}</p> : null}
          {replayLinkStatus ? <p className="detail-note">{replayLinkStatus}</p> : null}
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

type FeedEntityFilter = {
  key: string;
  label: string;
};

type FeedOrder = "newest" | "oldest";

type ReadinessItem = {
  platform: SourcePlatform;
  state: "ready" | "watching" | "setup" | "attention";
  title: string;
  detail: string;
  requirements: string[];
};

type PerformanceSummary = {
  eventCount: number;
  durationSeconds: number;
  eventsPerSecond: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  freshestAgeSeconds: number;
};

type AuthorProfile = {
  authorKey: string;
  sourceKey: string;
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

type SourceAccountSummary = FeedEntityFilter & {
  platform: SourcePlatform;
  eventCount: number;
  signalCount: number;
  lastEventAt: string;
};

type SourceIdentityGroup = {
  key: string;
  label: string;
  query: string;
  accounts: SourceAccountSummary[];
  eventCount: number;
  signalCount: number;
};

type ModerationItem = {
  event: UnifiedEvent;
  reason: "deleted" | "held" | "spam";
  title: string;
  detail: string;
};

type ObsPresetLink = {
  title: string;
  detail: string;
  href: string;
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

function buildReplayLink(recording: RecordingExport) {
  const baseUrl = new URL(window.location.href);

  baseUrl.hash = `replay=${encodeReplayPayload(recording)}`;

  return baseUrl.toString();
}

function readReplayLinkRecording(): RecordingExport | null {
  if (typeof window === "undefined") return null;

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const replayPayload = params.get("replay");

  if (!replayPayload) return null;

  try {
    return recordingExportSchema.parse(JSON.parse(decodeReplayPayload(replayPayload)));
  } catch {
    return null;
  }
}

function clearReplayLinkHash() {
  if (typeof window === "undefined" || !window.location.hash.includes("replay=")) return;

  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function encodeReplayPayload(recording: RecordingExport) {
  return btoa(encodeURIComponent(JSON.stringify(recording)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeReplayPayload(payload: string) {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  return decodeURIComponent(atob(paddedBase64));
}

type ViewPreset = {
  obsMode: boolean;
  platformFilter: PlatformFilter;
  query: string;
  signalOnly: boolean;
  limit: number | null;
};

function readViewPreset(): ViewPreset {
  if (typeof window === "undefined") {
    return defaultViewPreset();
  }

  const params = new URLSearchParams(window.location.search);

  return {
    obsMode: params.get("obs") === "1",
    platformFilter: parsePlatformFilter(params.get("sources") ?? params.get("source")),
    query: params.get("q") ?? params.get("query") ?? "",
    signalOnly: parseBooleanParam(params.get("signal")),
    limit: parseLimitParam(params.get("limit"))
  };
}

function defaultViewPreset(): ViewPreset {
  return {
    obsMode: false,
    platformFilter: {
      twitch: true,
      kick: true,
      x: true
    },
    query: "",
    signalOnly: false,
    limit: null
  };
}

function parsePlatformFilter(value: string | null): PlatformFilter {
  const selectedPlatforms = new Set(
    value
      ?.split(",")
      .map((platform) => platform.trim().toLowerCase())
      .filter((platform): platform is SourcePlatform => platforms.includes(platform as SourcePlatform)) ?? []
  );

  if (selectedPlatforms.size === 0) {
    return defaultViewPreset().platformFilter;
  }

  return {
    twitch: selectedPlatforms.has("twitch"),
    kick: selectedPlatforms.has("kick"),
    x: selectedPlatforms.has("x")
  };
}

function parseBooleanParam(value: string | null) {
  return value === "1" || value === "true";
}

function parseLimitParam(value: string | null) {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1) {
    return null;
  }

  return Math.min(limit, 100);
}

function buildObsPresetLinks(): ObsPresetLink[] {
  return [
    {
      title: "All sources",
      detail: "Full overlay for the main submission shot.",
      href: buildObsPresetHref({
        sources: ["twitch", "kick", "x"],
        limit: 14
      })
    },
    {
      title: "Twitch and Kick",
      detail: "Chat-native view without X posts.",
      href: buildObsPresetHref({
        sources: ["twitch", "kick"],
        limit: 12
      })
    },
    {
      title: "Ansem Twitch",
      detail: "Focused proof shot for a single account.",
      href: buildObsPresetHref({
        sources: ["twitch"],
        limit: 8,
        query: "ansem"
      })
    },
    {
      title: "Signal only",
      detail: "High-signal clip view for fast review.",
      href: buildObsPresetHref({
        signal: true,
        limit: 10
      })
    }
  ];
}

function buildObsPresetHref({
  sources,
  limit,
  query,
  signal
}: {
  sources?: SourcePlatform[];
  limit?: number;
  query?: string;
  signal?: boolean;
}) {
  const baseUrl =
    typeof window === "undefined"
      ? new URL("http://127.0.0.1:5173/")
      : new URL(`${window.location.origin}${window.location.pathname}`);

  baseUrl.searchParams.set("obs", "1");

  if (sources && sources.length > 0) {
    baseUrl.searchParams.set("sources", sources.join(","));
  }

  if (limit) {
    baseUrl.searchParams.set("limit", String(limit));
  }

  if (query) {
    baseUrl.searchParams.set("q", query);
  }

  if (signal) {
    baseUrl.searchParams.set("signal", "1");
  }

  return baseUrl.toString();
}

function scrollEventListToLiveEdge(list: HTMLDivElement | null, feedOrder: FeedOrder) {
  if (!list) return;

  const top = feedOrder === "newest" ? 0 : list.scrollHeight;

  if (typeof list.scrollTo === "function") {
    list.scrollTo({ top });
    return;
  }

  list.scrollTop = top;
}

function isAtLiveEdge(list: HTMLDivElement, feedOrder: FeedOrder) {
  if (feedOrder === "newest") {
    return list.scrollTop <= 12;
  }

  return list.scrollHeight - list.clientHeight - list.scrollTop <= 12;
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

function PerformancePanel({ summary }: { summary: PerformanceSummary }) {
  return (
    <div className="performance-panel">
      <div className="connector-stats">
        <Metric label="events/s" value={formatThroughput(summary.eventsPerSecond)} />
        <Metric label="p95" value={formatLatency(summary.p95LatencyMs)} />
        <Metric label="avg" value={formatLatency(summary.averageLatencyMs)} />
      </div>
      <p className="detail-note">
        {summary.eventCount === 0
          ? "Waiting for buffer activity."
          : `${summary.eventCount} buffered events over ${formatDuration(summary.durationSeconds)}. Latest ${formatFreshness(
              summary.freshestAgeSeconds
            )}.`}
      </p>
    </div>
  );
}

function ModerationQueue({
  items,
  onReview
}: {
  items: ModerationItem[];
  onReview: (item: ModerationItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-detail compact-empty">
        <span>No review items.</span>
      </div>
    );
  }

  return (
    <div className="review-list">
      {items.map((item) => (
        <button
          className="review-item"
          data-reason={item.reason}
          key={item.event.id}
          onClick={() => onReview(item)}
          type="button"
        >
          <span className="review-heading">
            <strong>{item.title}</strong>
            <code>{formatPlatformSourceLabel(item.event)}</code>
          </span>
          <span className="review-copy">{item.detail}</span>
        </button>
      ))}
    </div>
  );
}

function SourceAccountsPanel({
  accounts,
  activeFilter,
  onToggle
}: {
  accounts: SourceAccountSummary[];
  activeFilter: FeedEntityFilter | null;
  onToggle: (account: SourceAccountSummary) => void;
}) {
  if (accounts.length === 0) {
    return (
      <div className="empty-detail compact-empty">
        <span>No account activity yet.</span>
      </div>
    );
  }

  return (
    <div className="account-list">
      {accounts.map((account) => {
        const active = activeFilter?.key === account.key;

        return (
          <button
            aria-label={`${active ? "Clear" : "Filter"} source account ${account.label}`}
            className="account-button"
            data-active={active}
            key={account.key}
            onClick={() => onToggle(account)}
            style={{ "--accent": platformAccent[account.platform] } as CSSProperties}
            type="button"
          >
            <span className="account-copy">
              <strong>{account.label}</strong>
              <span>{formatRelativeTime(account.lastEventAt)}</span>
            </span>
            <span className="account-metrics">
              <code>{account.eventCount} events</code>
              <code>{account.signalCount} signals</code>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SourceIdentitiesPanel({
  groups,
  onFocus
}: {
  groups: SourceIdentityGroup[];
  onFocus: (group: SourceIdentityGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="empty-detail compact-empty">
        <span>No linked identities yet.</span>
      </div>
    );
  }

  return (
    <div className="identity-list">
      {groups.map((group) => (
        <div className="identity-card" key={group.key}>
          <div className="identity-heading">
            <strong>{group.label}</strong>
            <span>
              {group.eventCount} events / {group.signalCount} signals
            </span>
          </div>
          <div className="identity-sources">
            {group.accounts.map((account) => (
              <code key={account.key}>{account.label}</code>
            ))}
          </div>
          <button className="wide-button compact-action" onClick={() => onFocus(group)} type="button">
            Focus identity {group.label}
          </button>
        </div>
      ))}
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

function ObsPresetLinks({ links }: { links: ObsPresetLink[] }) {
  return (
    <div className="obs-preset-list">
      {links.map((link) => (
        <a className="obs-preset-link" href={link.href} key={link.title} rel="noreferrer" target="_blank">
          <span>
            <strong>{link.title}</strong>
            <span>{link.detail}</span>
          </span>
          <code>{new URL(link.href).search}</code>
        </a>
      ))}
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

function AuthorDetail({
  activeAuthorFilter,
  activeSourceAccountFilter,
  onToggleAuthorFilter,
  onToggleSourceAccountFilter,
  profile
}: {
  activeAuthorFilter: FeedEntityFilter | null;
  activeSourceAccountFilter: FeedEntityFilter | null;
  onToggleAuthorFilter: (profile: AuthorProfile) => void;
  onToggleSourceAccountFilter: (profile: AuthorProfile) => void;
  profile: AuthorProfile;
}) {
  const authorFilterActive = activeAuthorFilter?.key === profile.authorKey;
  const sourceFilterActive = activeSourceAccountFilter?.key === profile.sourceKey;

  return (
    <div className="author-detail">
      <div className="author-card">
        <span className="author-platform">{profile.platformLabel}</span>
        <strong>{profile.authorLabel}</strong>
        <span>{profile.sourceLabel}</span>
      </div>
      <div className="filter-actions">
        <button
          className="wide-button"
          data-active={sourceFilterActive}
          onClick={() => onToggleSourceAccountFilter(profile)}
          type="button"
        >
          {sourceFilterActive ? "Clear source filter" : "Filter source account"}
        </button>
        <button
          className="wide-button"
          data-active={authorFilterActive}
          onClick={() => onToggleAuthorFilter(profile)}
          type="button"
        >
          {authorFilterActive ? "Clear author filter" : "Filter author"}
        </button>
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
  const authorKey = getAuthorKey(event);
  const sourceKey = getSourceAccountKey(event);
  const authorEventCount = events.filter(
    (feedEvent) => feedEvent.platform === event.platform && getAuthorKey(feedEvent) === authorKey
  ).length;
  const sourceEventCount = events.filter(
    (feedEvent) => feedEvent.platform === event.platform && getSourceAccountKey(feedEvent) === sourceKey
  ).length;

  return {
    authorKey,
    sourceKey,
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

function getAuthorKey(event: UnifiedEvent) {
  return [event.platform, event.authorId ?? event.authorName ?? event.sourceChannelName ?? event.platformEventId].join(
    ":"
  );
}

function getSourceAccountKey(event: UnifiedEvent) {
  const accountKey =
    event.platform === "x" && (event.authorId || event.authorName)
      ? event.authorId ?? event.authorName
      : event.sourceChannelId ?? event.sourceChannelName ?? event.platform;

  return [event.platform, accountKey].join(":");
}

function buildSourceAccountSummaries(events: UnifiedEvent[]): SourceAccountSummary[] {
  const accountMap = new Map<string, SourceAccountSummary>();

  for (const event of events) {
    const key = getSourceAccountKey(event);
    const current = accountMap.get(key);
    const lastEventAt =
      current && new Date(current.lastEventAt).getTime() > new Date(event.receivedAt).getTime()
        ? current.lastEventAt
        : event.receivedAt;

    accountMap.set(key, {
      key,
      label: current?.label ?? formatPlatformSourceLabel(event),
      platform: event.platform,
      eventCount: (current?.eventCount ?? 0) + 1,
      signalCount: (current?.signalCount ?? 0) + (isSignalEvent(event) ? 1 : 0),
      lastEventAt
    });
  }

  return [...accountMap.values()]
    .sort((left, right) => {
      const activityDiff = new Date(right.lastEventAt).getTime() - new Date(left.lastEventAt).getTime();

      if (activityDiff !== 0) return activityDiff;
      if (right.eventCount !== left.eventCount) return right.eventCount - left.eventCount;

      return left.label.localeCompare(right.label);
    })
    .slice(0, 8);
}

function buildSourceIdentityGroups(accounts: SourceAccountSummary[]): SourceIdentityGroup[] {
  const groupMap = new Map<string, SourceIdentityGroup>();

  for (const account of accounts) {
    const query = getSourceIdentityQuery(account.label);
    if (!query) continue;

    const current = groupMap.get(query);

    groupMap.set(query, {
      key: query,
      label: query.toUpperCase(),
      query,
      accounts: [...(current?.accounts ?? []), account],
      eventCount: (current?.eventCount ?? 0) + account.eventCount,
      signalCount: (current?.signalCount ?? 0) + account.signalCount
    });
  }

  return [...groupMap.values()]
    .filter((group) => new Set(group.accounts.map((account) => account.platform)).size > 1)
    .sort((left, right) => {
      if (right.eventCount !== left.eventCount) return right.eventCount - left.eventCount;
      return left.label.localeCompare(right.label);
    })
    .slice(0, 5);
}

function buildModerationItems(events: UnifiedEvent[]): ModerationItem[] {
  return events
    .map((event) => buildModerationItem(event))
    .filter((item): item is ModerationItem => Boolean(item))
    .slice(0, 6);
}

function buildModerationItem(event: UnifiedEvent): ModerationItem | null {
  const text = event.text ?? "";
  const normalizedText = text.toLowerCase();

  if (event.kind === "chat_delete") {
    return {
      event,
      reason: "deleted",
      title: "Deleted message",
      detail: text || `${formatAuthor(event)} had a message removed.`
    };
  }

  if (/\b(held for review|held message|review required)\b/.test(normalizedText)) {
    return {
      event,
      reason: "held",
      title: "Held for review",
      detail: text
    };
  }

  if (/\b(free tokens?|airdrop|giveaway|claim|double your|telegram|whatsapp)\b/.test(normalizedText)) {
    return {
      event,
      reason: "spam",
      title: "Spam risk",
      detail: text
    };
  }

  return null;
}

function buildPerformanceSummary(events: UnifiedEvent[]): PerformanceSummary {
  const receivedTimes = events
    .map((event) => new Date(event.receivedAt).getTime())
    .filter((time) => Number.isFinite(time));
  const latencies = events
    .map((event) => new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime())
    .filter((latency) => Number.isFinite(latency) && latency >= 0);
  const newestReceivedAt = receivedTimes.length > 0 ? Math.max(...receivedTimes) : Date.now();
  const oldestReceivedAt = receivedTimes.length > 0 ? Math.min(...receivedTimes) : newestReceivedAt;
  const durationSeconds = Math.max(0, (newestReceivedAt - oldestReceivedAt) / 1000);
  const eventsPerSecond = durationSeconds > 0 ? events.length / durationSeconds : events.length;
  const averageLatencyMs =
    latencies.length > 0 ? latencies.reduce((total, latency) => total + latency, 0) / latencies.length : 0;

  return {
    eventCount: events.length,
    durationSeconds,
    eventsPerSecond,
    averageLatencyMs,
    p95LatencyMs: percentile(latencies, 0.95),
    freshestAgeSeconds: Math.max(0, (Date.now() - newestReceivedAt) / 1000)
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;

  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1));

  return sortedValues[index];
}

function getSourceIdentityQuery(label: string) {
  const accountName = label.match(/\(([^)]+)\)/)?.[1] ?? label;
  const normalized = accountName.replace(/^@|^#/, "").trim().toLowerCase();

  return normalized.length > 1 ? normalized : "";
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

function formatThroughput(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 100) return Math.round(value).toLocaleString("en-US");
  if (value >= 10) return value.toFixed(1);

  return value.toFixed(2);
}

function formatLatency(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0ms";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;

  return `${Math.round(value)}ms`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;

  return `${Math.round(seconds / 3600)}h`;
}

function formatFreshness(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1) return "now";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;

  return `${Math.round(seconds / 3600)}h ago`;
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
