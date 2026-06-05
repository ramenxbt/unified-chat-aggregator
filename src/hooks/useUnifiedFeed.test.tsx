import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import type { PlatformFilter } from "../domain/unifiedEvent";
import { useUnifiedFeed } from "./useUnifiedFeed";

const allPlatforms: PlatformFilter = {
  twitch: true,
  kick: true,
  x: true
};

const noKick: PlatformFilter = {
  twitch: true,
  kick: false,
  x: true
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  serverClose() {
    this.closed = true;
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function TestFeed({ platformFilter = allPlatforms }: { platformFilter?: PlatformFilter }) {
  const feed = useUnifiedFeed(platformFilter, "ws://127.0.0.1:8787");

  return (
    <div>
      <p data-testid="transport">{feed.transportState}</p>
      <p data-testid="events">{feed.events.map((event) => event.text).join(" | ")}</p>
      <p data-testid="statuses">{feed.statuses.map((status) => `${status.platform}:${status.eventCount}`).join(" | ")}</p>
    </div>
  );
}

describe("useUnifiedFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects after the live socket closes and preserves the current buffer", () => {
    render(<TestFeed />);
    const firstSocket = MockWebSocket.instances[0];
    const firstEvent = createFixtureEvent(0);
    const secondEvent = createFixtureEvent(2);
    const firstText = firstEvent.text ?? firstEvent.kind;
    const secondText = secondEvent.text ?? secondEvent.kind;

    expect(screen.getByTestId("events")).toHaveTextContent("");

    act(() => {
      firstSocket.open();
    });

    expect(screen.getByTestId("transport")).toHaveTextContent("live");

    act(() => {
      firstSocket.emit({
        type: "snapshot",
        events: [firstEvent],
        statuses: initialConnectorStatuses,
        generatedAt: new Date().toISOString()
      });
    });

    expect(screen.getByTestId("events")).toHaveTextContent(firstText);

    act(() => {
      firstSocket.serverClose();
    });

    expect(screen.getByTestId("transport")).toHaveTextContent("degraded");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(MockWebSocket.instances).toHaveLength(2);

    act(() => {
      MockWebSocket.instances[1].open();
      MockWebSocket.instances[1].emit({
        type: "event",
        event: secondEvent
      });
    });

    expect(screen.getByTestId("transport")).toHaveTextContent("live");
    expect(screen.getByTestId("events")).toHaveTextContent(firstText);
    expect(screen.getByTestId("events")).toHaveTextContent(secondText);
  });

  it("does not recreate the socket when platform filters change", () => {
    const { rerender } = render(<TestFeed platformFilter={allPlatforms} />);
    const kickEvent = createFixtureEvent(0);
    const twitchEvent = createFixtureEvent(2);
    const kickText = kickEvent.text ?? kickEvent.kind;
    const twitchText = twitchEvent.text ?? twitchEvent.kind;

    act(() => {
      MockWebSocket.instances[0].open();
    });

    rerender(<TestFeed platformFilter={noKick} />);

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      MockWebSocket.instances[0].emit({
        type: "snapshot",
        events: [kickEvent, twitchEvent],
        statuses: initialConnectorStatuses,
        generatedAt: new Date().toISOString()
      });
    });

    expect(screen.getByTestId("events")).not.toHaveTextContent(kickText);
    expect(screen.getByTestId("events")).toHaveTextContent(twitchText);

    act(() => {
      MockWebSocket.instances[0].emit({
        type: "event",
        event: kickEvent
      });
      MockWebSocket.instances[0].emit({
        type: "event",
        event: twitchEvent
      });
    });

    expect(screen.getByTestId("events")).not.toHaveTextContent(kickText);
    expect(screen.getByTestId("events")).toHaveTextContent(twitchText);
  });

  it("adds live statuses that arrive before a snapshot", () => {
    render(<TestFeed />);

    act(() => {
      MockWebSocket.instances[0].open();
      MockWebSocket.instances[0].emit({
        type: "status",
        status: {
          platform: "twitch",
          state: "live",
          label: "EventSub WebSocket",
          sourceName: "marketbubble",
          eventCount: 1,
          droppedCount: 0,
          reconnectCount: 0
        }
      });
    });

    expect(screen.getByTestId("statuses")).toHaveTextContent("twitch:1");
  });
});
