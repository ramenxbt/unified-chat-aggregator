import { chromium, type Browser } from "@playwright/test";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { WebSocket } from "ws";

const feedPort = 8797;
const appPort = 5176;
const feedWsUrl = `ws://127.0.0.1:${feedPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;
const archiveDir = path.resolve("qa/rehearsal/feed-sessions");

async function main() {
  await mkdir(archiveDir, { recursive: true });

  const feedServer = startProcess("npm", ["run", "feed"], {
    FEED_SERVER_PORT: String(feedPort),
    FEED_FIXTURE_INTERVAL_MS: "100",
    FEED_ARCHIVE_DIR: archiveDir
  });
  const appServer = startProcess("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(appPort)], {
    VITE_FEED_WS_URL: feedWsUrl
  });
  let browser: Browser | null = null;

  try {
    await waitForFeedServer();
    await waitForAppServer();

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.getByText("Live feed server").waitFor({ state: "visible" });
    await page.getByText("live").first().waitFor({ state: "visible" });
    await page.getByRole("log").getByText("TWITCH (ANSEM)").first().waitFor({ state: "visible" });
    await page.getByRole("log").getByText("KICK (MARKETBUBBLE)").first().waitFor({ state: "visible" });
    await page.getByRole("log").getByText(/X \(/).first().waitFor({ state: "visible" });

    await assertArchive();
    await page.close();

    console.log("Live-stack rehearsal passed");
  } finally {
    await browser?.close();
    stopProcess(appServer);
    stopProcess(feedServer);
  }
}

function startProcess(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      ...env
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  return child;
}

async function waitForFeedServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      await openFeedSocket();
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for ${feedWsUrl}`);
}

async function openFeedSocket() {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(feedWsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("feed socket timeout"));
    }, 1000);

    socket.once("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function waitForAppServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(appUrl);

      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for ${appUrl}`);
}

async function assertArchive() {
  const sessions = (await readdir(archiveDir)).sort().reverse();

  for (const session of sessions) {
    try {
      const eventsFile = await readFile(path.join(archiveDir, session, "events.jsonl"), "utf8");

      if (eventsFile.trim().length > 0) {
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`No feed archive events found in ${archiveDir}`);
}

function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (!child.killed) {
    child.kill("SIGTERM");
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
