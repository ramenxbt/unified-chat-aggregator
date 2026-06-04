import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.resolve("qa/visual");

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = startDevServer();
  let browser: Browser | null = null;

  try {
    await waitForServer();

    browser = await chromium.launch();
    await capturePage(browser, "/", "desktop-dashboard.png", { width: 1440, height: 900 });
    await capturePage(browser, "/", "mobile-dashboard.png", { width: 390, height: 844 }, true);
    await capturePage(
      browser,
      "/?obs=1&sources=twitch,kick,x&limit=14",
      "obs-overlay.png",
      { width: 1280, height: 720 }
    );

    console.log(`Visual QA screenshots written to ${outputDir}`);
  } finally {
    await browser?.close();
    stopDevServer(server);
  }
}

function startDevServer() {
  const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    env: process.env
  });

  server.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  return server;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);

      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function capturePage(
  browser: Browser,
  route: string,
  fileName: string,
  viewport: { width: number; height: number },
  fullPage = false
) {
  const page = await browser.newPage({ viewport });

  await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  await assertRendered(page);
  await page.screenshot({ path: path.join(outputDir, fileName), fullPage });
  await page.close();
}

async function assertRendered(page: Page) {
  await page.getByRole("heading", { name: "Unified chat aggregator" }).waitFor({ state: "visible" });
  await page.getByRole("log").waitFor({ state: "visible" });
}

function stopDevServer(server: ChildProcessWithoutNullStreams) {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
