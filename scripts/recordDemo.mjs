import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const videoDir = "/tmp/uca-demo-video";
mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } }
});

// Visible cursor so viewers can follow along.
await context.addInitScript(() => {
  const attach = () => {
    if (document.getElementById("__cursor")) return;
    const dot = document.createElement("div");
    dot.id = "__cursor";
    Object.assign(dot.style, {
      position: "fixed",
      left: "-40px",
      top: "-40px",
      width: "16px",
      height: "16px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.9)",
      border: "2px solid rgba(0,0,0,0.55)",
      zIndex: "999999",
      pointerEvents: "none",
      transform: "translate(-50%,-50%)",
      boxShadow: "0 0 10px rgba(255,255,255,0.65)",
      transition: "background 120ms ease"
    });
    document.body.appendChild(dot);
    window.addEventListener("mousemove", (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    }, true);
    window.addEventListener("mousedown", () => { dot.style.background = "rgba(229,196,107,0.95)"; }, true);
    window.addEventListener("mouseup", () => { dot.style.background = "rgba(255,255,255,0.9)"; }, true);
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", attach);
  else attach();
});

const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

async function glideTo(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await wait(260);
}

async function glideClick(locator) {
  await glideTo(locator);
  await locator.click();
}

// 1. Open the dashboard, let the live feed breathe.
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.mouse.move(720, 450, { steps: 10 });
await wait(4200);

// 2. Search the unified feed.
const search = page.getByLabel("Search feed");
await glideClick(search);
await search.pressSequentially("polymarket", { delay: 95 });
await wait(2300);
await search.fill("");
await wait(1100);

// 3. Source toggles: mute X, bring it back.
const xToggle = page.locator(".source-toggle").nth(2);
await glideClick(xToggle);
await wait(1500);
await glideClick(xToggle);
await wait(1000);

// 4. Signal mode on, then off.
const signalMode = page.locator(".mode-toggle").first();
await glideClick(signalMode);
await wait(2200);
await glideClick(signalMode);
await wait(900);

// 5. Scroll into history, then jump back to live.
await page.mouse.move(720, 460, { steps: 12 });
await page.mouse.wheel(0, 420);
await wait(1600);
await glideClick(page.getByRole("button", { name: "Jump live" }));
await wait(1300);

// 6. Inspect a message: details open automatically.
const firstTwitchRow = page.locator('.event-row[data-platform="twitch"]').first();
await glideClick(firstTwitchRow);
await wait(2400);

// 7. Clip the selected message.
await glideClick(page.getByRole("button", { name: "Clip the selected message" }));
await wait(1700);

// 8. Drop an operator note into the timeline.
const noteInput = page.getByLabel("Add operator note");
await glideClick(noteInput);
await noteInput.pressSequentially("clip this breakout call for the submission", { delay: 60 });
await wait(450);
await glideClick(page.getByRole("button", { name: "Note", exact: true }));
await wait(2100);

// 9. Record a proof window, then stop.
await glideClick(page.getByRole("button", { name: "Record" }));
await wait(5200);
await glideClick(page.getByRole("button", { name: "Stop recording" }));
await wait(1200);

// 10. Walk the inspector tabs.
await glideClick(page.getByRole("button", { name: "Status", exact: true }));
await wait(2400);
await glideClick(page.getByRole("button", { name: "Accounts", exact: true }));
await wait(1500);
await glideClick(page.getByRole("button", { name: /filter source account twitch \(ansem\)/i }));
await wait(2200);
await glideClick(page.getByRole("button", { name: /clear source account twitch \(ansem\)/i }));
await wait(900);
await glideClick(page.getByRole("button", { name: "Clips", exact: true }));
await wait(2300);
await glideClick(page.getByRole("button", { name: "Save current buffer" }));
await wait(1800);
await glideClick(page.getByRole("button", { name: "Setup", exact: true }));
await wait(2400);

// 11. Finish on the OBS overlay: the broadcast face of the app.
await page.goto("http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14", { waitUntil: "networkidle" });
await wait(7000);

await context.close();
const video = page.video();
console.log("VIDEO_PATH=" + (await video.path()));
await browser.close();
