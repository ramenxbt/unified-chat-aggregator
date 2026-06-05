import { useEffect, useMemo, useRef, useState } from "react";
import {
  dedupeEvents,
  type ConnectorStatus,
  type PlatformFilter,
  type UnifiedEvent
} from "../domain/unifiedEvent";
import { feedServerMessageSchema } from "../live/protocol";
import {
  createFixtureEvent,
  createInitialFixtureState,
  updateFixtureStatuses
} from "../fixtures/fixtureEvents";

const maxBufferSize = 250;
const defaultFeedWsUrl = import.meta.env.VITE_FEED_WS_URL as string | undefined;
const reconnectBaseDelayMs = 500;
const reconnectMaxDelayMs = 5000;

export type UnifiedFeedState = {
  events: UnifiedEvent[];
  statuses: ConnectorStatus[];
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  transportLabel: string;
  transportState: "fixture" | "connecting" | "live" | "degraded";
};

export function useUnifiedFeed(platformFilter: PlatformFilter, feedUrl = defaultFeedWsUrl): UnifiedFeedState {
  const [stream, setStream] = useState(() => (feedUrl ? { events: [], statuses: [] } : createInitialFixtureState()));
  const [paused, setPaused] = useState(false);
  const [transportState, setTransportState] = useState<UnifiedFeedState["transportState"]>(
    feedUrl ? "connecting" : "fixture"
  );
  const sequenceRef = useRef(24);
  const pausedRef = useRef(paused);
  const activePlatformsRef = useRef(new Set<string>());

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const activePlatforms = useMemo(
    () => new Set(Object.entries(platformFilter).filter(([, enabled]) => enabled).map(([platform]) => platform)),
    [platformFilter]
  );

  useEffect(() => {
    activePlatformsRef.current = activePlatforms;
  }, [activePlatforms]);

  useEffect(() => {
    if (feedUrl) return;
    if (paused) return;

    const interval = window.setInterval(() => {
      const event = createFixtureEvent(sequenceRef.current);
      sequenceRef.current += 1;

      if (!activePlatforms.has(event.platform)) {
        return;
      }

      setStream((currentStream) => addEventToStream(currentStream, event, true));
    }, 1100);

    return () => window.clearInterval(interval);
  }, [activePlatforms, feedUrl, paused]);

  useEffect(() => {
    if (!feedUrl) {
      setTransportState("fixture");
      return;
    }

    let closedByEffect = false;
    let reconnectAttempt = 0;
    let reconnectTimeout: number | null = null;
    let socket: WebSocket | null = null;

    function connect() {
      if (closedByEffect || !feedUrl) return;

      setTransportState((currentState) => (currentState === "live" ? currentState : "connecting"));
      socket = new WebSocket(feedUrl);

      socket.onopen = () => {
        reconnectAttempt = 0;
        setTransportState("live");
      };
      socket.onerror = () => setTransportState("degraded");
      socket.onclose = () => {
        if (closedByEffect) return;

        setTransportState("degraded");
        const reconnectDelayMs = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimeout = window.setTimeout(connect, reconnectDelayMs);
      };
      socket.onmessage = handleSocketMessage;
    }

    function handleSocketMessage(message: MessageEvent) {
      let payload: unknown;

      try {
        payload = JSON.parse(message.data);
      } catch {
        setTransportState("degraded");
        return;
      }

      const parsed = feedServerMessageSchema.safeParse(payload);

      if (!parsed.success) {
        setTransportState("degraded");
        return;
      }

      const serverMessage = parsed.data;

      if (serverMessage.type === "snapshot") {
        setStream({
          events: serverMessage.events.filter((event) => activePlatformsRef.current.has(event.platform)),
          statuses: serverMessage.statuses
        });
        return;
      }

      if (serverMessage.type === "event") {
        if (pausedRef.current || !activePlatformsRef.current.has(serverMessage.event.platform)) {
          return;
        }

        setStream((currentStream) => addEventToStream(currentStream, serverMessage.event, false));
        return;
      }

      if (serverMessage.type === "status") {
        setStream((currentStream) => ({
          ...currentStream,
          statuses: replaceStatus(currentStream.statuses, serverMessage.status)
        }));
      }
    }

    connect();

    return () => {
      closedByEffect = true;

      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
      }

      socket?.close();
    };
  }, [feedUrl]);

  return {
    events: stream.events,
    statuses: stream.statuses,
    paused,
    setPaused,
    clear: () =>
      setStream((currentStream) => ({
        ...currentStream,
        events: []
      })),
    transportLabel: feedUrl ? "Live feed server" : "Fixture stream",
    transportState
  };
}

function addEventToStream(
  currentStream: { events: UnifiedEvent[]; statuses: ConnectorStatus[] },
  event: UnifiedEvent,
  updateStatuses: boolean
) {
  const nextEvents = dedupeEvents([event, ...currentStream.events]).slice(0, maxBufferSize);

  return {
    events: nextEvents,
    statuses: updateStatuses ? updateFixtureStatuses(currentStream.statuses, event) : currentStream.statuses
  };
}

function replaceStatus(statuses: ConnectorStatus[], nextStatus: ConnectorStatus) {
  const statusIndex = statuses.findIndex((status) => status.platform === nextStatus.platform);

  if (statusIndex === -1) {
    return [...statuses, nextStatus];
  }

  return statuses.map((status) => (status.platform === nextStatus.platform ? nextStatus : status));
}
