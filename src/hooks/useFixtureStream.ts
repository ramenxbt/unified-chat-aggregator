import { useEffect, useMemo, useRef, useState } from "react";
import {
  dedupeEvents,
  type ConnectorStatus,
  type PlatformFilter,
  type UnifiedEvent
} from "../domain/unifiedEvent";
import {
  createFixtureEvent,
  createInitialFixtureState,
  updateFixtureStatuses
} from "../fixtures/fixtureEvents";

const maxBufferSize = 250;

export type FixtureStreamState = {
  events: UnifiedEvent[];
  statuses: ConnectorStatus[];
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
};

export function useFixtureStream(platformFilter: PlatformFilter): FixtureStreamState {
  const [stream, setStream] = useState(() => createInitialFixtureState());
  const [paused, setPaused] = useState(false);
  const sequenceRef = useRef(24);

  const activePlatforms = useMemo(
    () => new Set(Object.entries(platformFilter).filter(([, enabled]) => enabled).map(([platform]) => platform)),
    [platformFilter]
  );

  useEffect(() => {
    if (paused) return;

    const interval = window.setInterval(() => {
      const event = createFixtureEvent(sequenceRef.current);
      sequenceRef.current += 1;

      if (!activePlatforms.has(event.platform)) {
        return;
      }

      setStream((currentStream) => {
        const nextEvents = dedupeEvents([event, ...currentStream.events]).slice(0, maxBufferSize);

        return {
          events: nextEvents,
          statuses: updateFixtureStatuses(currentStream.statuses, event)
        };
      });
    }, 1100);

    return () => window.clearInterval(interval);
  }, [activePlatforms, paused]);

  return {
    events: stream.events,
    statuses: stream.statuses,
    paused,
    setPaused,
    clear: () =>
      setStream((currentStream) => ({
        ...currentStream,
        events: []
      }))
  };
}
