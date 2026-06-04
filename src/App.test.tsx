import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    document.body.classList.remove("obs-body");
  });

  it("renders the unified feed and filters by search", async () => {
    render(<App />);
    const feed = screen.getByRole("log");

    expect(screen.getByRole("heading", { name: /unified chat aggregator/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Ansem is cooking again/i).length).toBeGreaterThan(0);

    await userEvent.type(screen.getByLabelText(/search feed/i), "polymarket");

    expect(feed).toHaveTextContent(/thanks for the/i);
    expect(feed).not.toHaveTextContent(/Ansem is cooking again/i);
  });

  it("can pause the fixture stream", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("starts a recording from the current replay buffer", async () => {
    render(<App />);

    expect(screen.getByText("0 recorded")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^record$/i }));

    expect(screen.getByText("24 recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export recording json/i })).toBeEnabled();
  });

  it("toggles submission mode on the app shell", async () => {
    const { container } = render(<App />);
    const appShell = container.querySelector(".app-shell");

    expect(appShell).toHaveAttribute("data-submission", "false");

    await userEvent.click(screen.getByRole("button", { name: /submission mode/i }));

    expect(appShell).toHaveAttribute("data-submission", "true");
  });

  it("opens the OBS browser-source route in overlay mode", () => {
    window.history.pushState({}, "", "/?obs=1");
    const { container } = render(<App />);
    const appShell = container.querySelector(".app-shell");

    expect(appShell).toHaveAttribute("data-obs", "true");
    expect(appShell).toHaveAttribute("data-submission", "true");
    expect(document.body).toHaveClass("obs-body");
  });
});
