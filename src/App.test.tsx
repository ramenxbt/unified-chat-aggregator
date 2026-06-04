import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
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
});
