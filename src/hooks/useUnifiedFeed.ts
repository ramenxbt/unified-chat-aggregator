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
const feedWsUrl = import.meta.env.VITE_FEED_WS_URL as string | undefined;

export type UnifiedFeedState = {
  events: UnifiedEvent[];
  statuses: ConnectorStatus[];
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  transportLabel: string;
  transportState: "fixture" | "connecting" | "live" | "degraded";
};

export function useUnifiedFeed(platformFilter: PlatformFilter): UnifiedFeedState {
  const [stream, setStream] = useState(() => createInitialFixtureState());
  const [paused, setPaused] = useState(false);
  const [transportState, setTransportState] = useState<UnifiedFeedState["transportState"]>(
    feedWsUrl ? "connecting" : "fixture"
  );
  const sequenceRef = useRef(24);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const activePlatforms = useMemo(
    () => new Set(Object.entries(platformFilter).filter(([, enabled]) => enabled).map(([platform]) => platform)),
    [platformFilter]
  );

  useEffect(() => {
    if (feedWsUrl) return;
    if (paused) return;

    const interval = window.setInterval(() => {
      const event = createFixtureEvent(sequenceRef.current);
      sequenceRef.current += 1;

      if (!activePlatforms.has(event.platform)) {
        return;
      }

      setStream((currentStream) => addEventToStream(currentStream, event));
    }, 1100);

    return () => window.clearInterval(interval);
  }, [activePlatforms, paused]);

  useEffect(() => {
    if (!feedWsUrl) return;

    const socket = new WebSocket(feedWsUrl);

    socket.onopen = () => setTransportState("live");
    socket.onerror = () => setTransportState("degraded");
    socket.onclose = () => setTransportState("degraded");
    socket.onmessage = (message) => {
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
          events: serverMessage.events,
          statuses: serverMessage.statuses
        });
        return;
      }

      if (serverMessage.type === "event") {
        if (pausedRef.current || !activePlatforms.has(serverMessage.event.platform)) {
          return;
        }

        setStream((currentStream) => addEventToStream(currentStream, serverMessage.event));
        return;
      }

      if (serverMessage.type === "status") {
        setStream((currentStream) => ({
          ...currentStream,
          statuses: currentStream.statuses.map((status) =>
            status.platform === serverMessage.status.platform ? serverMessage.status : status
          )
        }));
      }
    };

    return () => socket.close();
  }, [activePlatforms]);

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
    transportLabel: feedWsUrl ? "Live feed server" : "Fixture stream",
    transportState
  };
}

function addEventToStream(
  currentStream: { events: UnifiedEvent[]; statuses: ConnectorStatus[] },
  event: UnifiedEvent
) {
  const nextEvents = dedupeEvents([event, ...currentStream.events]).slice(0, maxBufferSize);

  return {
    events: nextEvents,
    statuses: updateFixtureStatuses(currentStream.statuses, event)
  };
}
