import { expect, test } from "@playwright/test";

test("fixture dashboard exposes account-labeled unified chat controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Unified chat aggregator" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("TWITCH (ANSEM)");
  await expect(page.getByRole("log")).toContainText("KICK (MARKETBUBBLE)");
  await expect(page.getByRole("log")).toContainText("X (@USER1337)");

  await page.getByLabel("Search feed").fill("polymarket");

  await expect(page.getByRole("log")).toContainText("thanks for the polymarket picks");
  await expect(page.getByRole("log")).not.toContainText("Ansem is cooking again");

  await page.getByLabel("Search feed").fill("");
  await page.locator(".topbar-actions .icon-button").nth(0).click();

  await expect(page.getByText("Paused")).toBeVisible();
  await expect(page.getByText("Readiness")).toBeVisible();
  await expect(page.getByText("TWITCH_CLIENT_ID")).toBeVisible();
  await expect(page.getByText("KICK_WEBHOOK_ENABLED=true")).toBeVisible();
  await expect(page.getByText("X_BEARER_TOKEN")).toBeVisible();
});

test("recording and local replay workflows are browser-ready", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("0 recorded")).toBeVisible();

  await page.locator(".topbar-actions .icon-button").nth(1).click();

  await expect(page.getByText("24 recorded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export recording JSON" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export recording CSV" })).toBeEnabled();

  await page.getByRole("button", { name: "Save current buffer" }).click();

  await expect(page.getByText("1 saved sessions. New saves keep the latest 12 sessions.")).toBeVisible();

  await page.locator(".session-load").first().click();

  await expect(page.getByText("Replay: Fixture stream - 24 events")).toBeVisible();
  await expect(page.getByText("replay", { exact: true })).toBeVisible();
});

test("OBS route opens as a clean transparent browser source", async ({ page }) => {
  await page.goto("/?obs=1&sources=twitch&limit=3&q=ansem");

  await expect(page.locator(".app-shell")).toHaveAttribute("data-obs", "true");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-submission", "true");
  await expect(page.locator(".source-rail")).toBeHidden();
  await expect(page.locator(".detail-rail")).toBeHidden();
  await expect(page.locator(".topbar-actions")).toBeHidden();
  await expect(page.locator(".live-button")).toBeHidden();
  await expect(page.locator(".feed-toolbar > span").first()).toHaveText("3 visible");
  await expect(page.getByRole("log")).toContainText("TWITCH (ANSEM)");
  await expect(page.getByRole("log")).not.toContainText("KICK (MARKETBUBBLE)");
  await expect(page.getByRole("log")).not.toContainText("X (@USER1337)");
});
