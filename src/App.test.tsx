import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createFixtureEvent } from "./fixtures/fixtureEvents";

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    document.body.classList.remove("obs-body");
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
  });

  it("renders the unified feed and filters by search", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    expect(screen.getByRole("heading", { name: /unified chat aggregator/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Ansem is cooking again/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("TWITCH (ANSEM)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KICK (ANSEM)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KICK (MARKETBUBBLE)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("X (@USER1337)").length).toBeGreaterThan(0);
    const sourceFilters = within(screen.getByLabelText("Platform source filters"));

    expect(sourceFilters.getByText("TWITCH (ANSEM)")).toBeInTheDocument();
    expect(sourceFilters.getByText("KICK (MARKETBUBBLE +1)")).toBeInTheDocument();
    expect(sourceFilters.getByText("X (@USER1337 +2)")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/search feed/i), "polymarket");

    expect(feed).toHaveTextContent(/thanks for the/i);
    expect(feed).not.toHaveTextContent(/Ansem is cooking again/i);
  });

  it("can pause the fixture stream", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("shows live readiness guidance while fixture mode is active", () => {
    render(<App />);

    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(screen.getByText(/fixture mode active/i)).toBeInTheDocument();
    expect(screen.getByText("TWITCH_CLIENT_ID")).toBeInTheDocument();
    expect(screen.getByText("KICK_WEBHOOK_ENABLED=true")).toBeInTheDocument();
    expect(screen.getByText("X_BEARER_TOKEN")).toBeInTheDocument();
  });

  it("shows buffer performance diagnostics", () => {
    render(<App />);

    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("events/s")).toBeInTheDocument();
    expect(screen.getByText("p95")).toBeInTheDocument();
    expect(screen.getByText("avg")).toBeInTheDocument();
    expect(screen.getByText(/24 buffered events over/i)).toBeInTheDocument();
  });

  it("shows a final recording submission checklist", async () => {
    render(<App />);

    expect(screen.getByLabelText("Run proof")).toHaveTextContent("Transportfixture");
    expect(screen.getByLabelText("Run proof")).toHaveTextContent("Coverage3/3");
    expect(screen.getByLabelText("Run proof")).toHaveTextContent("Labels6");
    expect(screen.getByLabelText("Run proof")).toHaveTextContent("P951.2s");
    expect(screen.getByLabelText("Run proof")).toHaveTextContent("Recordingidle");
    expect(screen.getByText("Submission checklist")).toBeInTheDocument();
    expect(screen.getByText(/need live websocket transport before final recording/i)).toBeInTheDocument();
    expect(screen.getByText("Current buffer includes Twitch, Kick, and X events.")).toBeInTheDocument();
    expect(screen.getByText(/source labels are visible across/i)).toBeInTheDocument();
    expect(screen.getByText("Click Record before the submission capture starts.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^record$/i }));

    expect(screen.getByLabelText("Run proof")).toHaveTextContent("Recording24");
    expect(screen.getByText("24 events captured in the active recording.")).toBeInTheDocument();
  });

  it("shows ready-to-open OBS preset links", () => {
    render(<App />);

    expect(screen.getByText("OBS presets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /all sources/i })).toHaveAttribute(
      "href",
      expect.stringContaining("obs=1")
    );
    expect(screen.getByRole("link", { name: /ansem twitch/i })).toHaveAttribute(
      "href",
      expect.stringContaining("sources=twitch")
    );
    expect(screen.getByRole("link", { name: /ansem twitch/i })).toHaveAttribute(
      "href",
      expect.stringContaining("q=ansem")
    );
    expect(screen.getByRole("link", { name: /signal only/i })).toHaveAttribute(
      "href",
      expect.stringContaining("signal=1")
    );
  });

  it("shows selected author and source details", async () => {
    render(<App />);

    await userEvent.click(screen.getAllByText(/Ansem is cooking again/i)[0]);

    expect(screen.getByText("tw_67")).toBeInTheDocument();
    expect(screen.getByText("twitch_ansem")).toBeInTheDocument();
    expect(screen.getAllByText("Mod").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TWITCH (ANSEM)").length).toBeGreaterThan(0);
  });

  it("lists active source accounts and filters from the roster", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    expect(screen.getByText("Accounts")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /filter source account twitch \(ansem\)/i }));

    expect(screen.getByText("Source: TWITCH (ANSEM)")).toBeInTheDocument();
    expect(feed).toHaveTextContent("TWITCH (ANSEM)");
    expect(feed).not.toHaveTextContent("KICK (MARKETBUBBLE)");

    await userEvent.click(screen.getByRole("button", { name: /clear source account twitch \(ansem\)/i }));

    expect(screen.queryByText("Source: TWITCH (ANSEM)")).not.toBeInTheDocument();
    expect(feed).toHaveTextContent("KICK (MARKETBUBBLE)");
  });

  it("groups matching source accounts into a focusable identity", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    expect(screen.getByText("Identities")).toBeInTheDocument();
    expect(screen.getAllByText("ANSEM").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /focus identity ansem/i }));

    expect(screen.getByLabelText(/search feed/i)).toHaveValue("ansem");
    expect(feed).toHaveTextContent("TWITCH (ANSEM)");
    expect(feed).toHaveTextContent("KICK (ANSEM)");
    expect(feed).not.toHaveTextContent("KICK (MARKETBUBBLE)");
    expect(feed).not.toHaveTextContent("X (@USER1337)");
  });

  it("surfaces held messages in the moderation review queue", async () => {
    render(<App />);

    expect(screen.getByText("Review queue")).toBeInTheDocument();
    expect(screen.getAllByText("Held for review").length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: /held for review/i })[0]);

    expect(screen.getAllByText("promo_drop").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Held for review: claim free tokens at sketchy-airdrop.test").length).toBeGreaterThan(0);
  });

  it("filters the feed by selected source account", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    await userEvent.click(screen.getAllByText(/Ansem is cooking again/i)[0]);
    await userEvent.click(screen.getByRole("button", { name: /^filter source account$/i }));

    expect(screen.getByText("Source: TWITCH (ANSEM)")).toBeInTheDocument();
    expect(feed).toHaveTextContent("TWITCH (ANSEM)");
    expect(feed).toHaveTextContent("BTC breakout if 72.4k reclaims cleanly");
    expect(feed).not.toHaveTextContent("KICK (MARKETBUBBLE)");
    expect(feed).not.toHaveTextContent("X (@USER1337)");

    await userEvent.click(screen.getByRole("button", { name: /clear source filter/i }));

    expect(feed).toHaveTextContent("KICK (MARKETBUBBLE)");
  });

  it("filters X source accounts by the visible post author", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    await userEvent.click(screen.getAllByText(/thanks for the polymarket picks/i)[0]);
    await userEvent.click(screen.getByRole("button", { name: /^filter source account$/i }));

    expect(screen.getByText("Source: X (@USER1337)")).toBeInTheDocument();
    expect(feed).toHaveTextContent("X (@USER1337)");
    expect(feed).toHaveTextContent("thanks for the polymarket picks");
    expect(feed).not.toHaveTextContent("X (@TAPE_READER)");
    expect(feed).not.toHaveTextContent("news flow is getting aggressive around open interest");
  });

  it("filters X source accounts from the account roster by visible post author", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    await userEvent.click(screen.getByRole("button", { name: /filter source account x \(@user1337\)/i }));

    expect(screen.getByText("Source: X (@USER1337)")).toBeInTheDocument();
    expect(feed).toHaveTextContent("thanks for the polymarket picks");
    expect(feed).not.toHaveTextContent("X (@TAPE_READER)");
  });

  it("filters the feed by selected author", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    await userEvent.click(screen.getAllByText(/Ansem is cooking again/i)[0]);
    await userEvent.click(screen.getByRole("button", { name: /^filter author$/i }));

    expect(screen.getByText("Author: user67")).toBeInTheDocument();
    expect(feed).toHaveTextContent("Ansem is cooking again");
    expect(feed).not.toHaveTextContent("BTC breakout if 72.4k reclaims cleanly");

    await userEvent.click(screen.getByRole("button", { name: /clear author filter/i }));

    expect(feed).toHaveTextContent("BTC breakout if 72.4k reclaims cleanly");
  });

  it("starts a recording from the current replay buffer", async () => {
    render(<App />);

    expect(screen.getByText("0 recorded")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^record$/i }));

    expect(screen.getByText("24 recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export recording json/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /export recording csv/i })).toBeEnabled();
  });

  it("copies a shareable replay link for the current buffer", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /copy replay link/i }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("#replay=");
    expect(screen.getByText("24 event replay link copied.")).toBeInTheDocument();
  });

  it("toggles submission mode on the app shell", async () => {
    const { container } = render(<App />);
    const appShell = container.querySelector(".app-shell");

    expect(appShell).toHaveAttribute("data-submission", "false");

    await userEvent.click(screen.getByRole("button", { name: /submission mode/i }));

    expect(appShell).toHaveAttribute("data-submission", "true");
  });

  it("returns to the newest events with the live control", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    Object.defineProperty(feed, "scrollTo", {
      configurable: true,
      value: vi.fn((options: ScrollToOptions) => {
        feed.scrollTop = options.top ?? 0;
      })
    });

    expect(screen.getByRole("button", { name: /^live$/i })).toBeInTheDocument();

    feed.scrollTop = 120;
    fireEvent.scroll(feed);

    const jumpButton = screen.getByRole("button", { name: /jump live/i });

    expect(jumpButton).toBeInTheDocument();

    await userEvent.click(jumpButton);

    expect(feed.scrollTop).toBe(0);
    expect(screen.getByRole("button", { name: /^live$/i })).toBeInTheDocument();
  });

  it("switches to oldest-first order and jumps to the bottom live edge", async () => {
    render(<App />);
    const feed = screen.getByRole("log");
    const firstLabel = () => feed.querySelector(".platform-label")?.textContent;

    Object.defineProperty(feed, "scrollHeight", {
      configurable: true,
      value: 1000
    });
    Object.defineProperty(feed, "clientHeight", {
      configurable: true,
      value: 400
    });
    Object.defineProperty(feed, "scrollTo", {
      configurable: true,
      value: vi.fn((options: ScrollToOptions) => {
        feed.scrollTop = options.top ?? 0;
      })
    });

    expect(screen.getByRole("button", { name: /newest first/i })).toBeInTheDocument();
    expect(firstLabel()).toBe("TWITCH (ANSEM)");

    await userEvent.click(screen.getByRole("button", { name: /newest first/i }));

    expect(screen.getByRole("button", { name: /oldest first/i })).toBeInTheDocument();
    expect(firstLabel()).toBe("KICK (MARKETBUBBLE)");

    feed.scrollTop = 100;
    fireEvent.scroll(feed);

    await userEvent.click(screen.getByRole("button", { name: /jump live/i }));

    expect(feed.scrollTop).toBe(1000);
    expect(screen.getByRole("button", { name: /^live$/i })).toBeInTheDocument();
  });

  it("imports an exported recording as a replay", async () => {
    render(<App />);
    const user = userEvent.setup();
    const replayEvent = createFixtureEvent(2, new Date("2026-06-04T18:00:00.000Z"));
    const replayFile = new File(
      [
        JSON.stringify({
          exportedAt: "2026-06-04T18:00:02.000Z",
          source: "Live feed server",
          transportState: "live",
          eventCount: 1,
          events: [replayEvent]
        })
      ],
      "market-bubble-feed.json",
      { type: "application/json" }
    );
    const importInput = document.querySelector<HTMLInputElement>('input[type="file"]');

    expect(importInput).not.toBeNull();

    await user.upload(importInput!, replayFile);

    expect(screen.getByText("Replay: market-bubble-feed.json")).toBeInTheDocument();
    expect(screen.getByText("1 imported events from Live feed server.")).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("Ansem is cooking again");
    expect(screen.getAllByText("replay").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /exit replay/i }));

    expect(screen.getByText("Fixture stream")).toBeInTheDocument();
  });

  it("loads a replay from a shared URL hash", () => {
    const replayEvent = createFixtureEvent(2, new Date("2026-06-04T18:00:00.000Z"));
    const recording = {
      exportedAt: "2026-06-04T18:00:02.000Z",
      source: "Shared proof clip",
      transportState: "live",
      eventCount: 1,
      events: [replayEvent]
    };
    const payload = btoa(encodeURIComponent(JSON.stringify(recording)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    window.history.pushState({}, "", `/#replay=${payload}`);
    render(<App />);

    expect(screen.getByText("Replay: shared replay link")).toBeInTheDocument();
    expect(screen.getByText("1 imported events from Shared proof clip.")).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("Ansem is cooking again");
  });

  it("saves the current buffer to local sessions and loads it as replay", async () => {
    render(<App />);
    const user = userEvent.setup();

    expect(screen.getByText("0 saved sessions. New saves keep the latest 12 sessions.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save current buffer/i }));

    expect(screen.getByText("1 saved sessions. New saves keep the latest 12 sessions.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^fixture stream - 24 events/i }));

    expect(screen.getByText("Replay: Fixture stream - 24 events")).toBeInTheDocument();
    expect(screen.getAllByText("replay").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /delete fixture stream - 24 events/i }));

    expect(screen.getByText("0 saved sessions. New saves keep the latest 12 sessions.")).toBeInTheDocument();
  });

  it("opens the OBS browser-source route in overlay mode", () => {
    window.history.pushState({}, "", "/?obs=1");
    const { container } = render(<App />);
    const appShell = container.querySelector(".app-shell");

    expect(appShell).toHaveAttribute("data-obs", "true");
    expect(appShell).toHaveAttribute("data-submission", "true");
    expect(document.body).toHaveClass("obs-body");
  });

  it("applies OBS URL presets for sources, search, and event limit", () => {
    window.history.pushState({}, "", "/?obs=1&sources=twitch&limit=3&q=ansem");
    render(<App />);
    const feed = screen.getByRole("log");

    expect(screen.getByLabelText(/search feed/i)).toHaveValue("ansem");
    expect(screen.getByText("3 visible")).toBeInTheDocument();
    expect(feed.querySelectorAll(".platform-label")).toHaveLength(3);
    expect(feed).toHaveTextContent("TWITCH (ANSEM)");
    expect(feed).not.toHaveTextContent("KICK (MARKETBUBBLE)");
    expect(feed).not.toHaveTextContent("X (@USER1337)");
  });
});
