import { mkdir, readdir, stat } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { WebSocket } from "ws";
import { buildEvidenceReport } from "../src/server/evidenceReport";

const feedPort = 8798;
const feedWsUrl = `ws://127.0.0.1:${feedPort}`;
const runId = Date.now();
const archiveDir = path.resolve("qa/stress", `feed-sessions-${runId}`);
const databasePath = path.resolve("qa/stress", `feed-${runId}.sqlite`);
const targetEvents = Number(process.env.STRESS_TARGET_EVENTS ?? 500);
const minimumEventsPerSecond = Number(process.env.STRESS_MIN_EVENTS_PER_SECOND ?? 20);
const maximumP95LatencyMs = Number(process.env.STRESS_MAX_P95_LATENCY_MS ?? 1500);

async function main() {
  await mkdir(archiveDir, { recursive: true });

  const feedServer = startProcess("npm", ["run", "feed"], {
    FEED_SERVER_PORT: String(feedPort),
    FEED_REPLAY_BUFFER_SIZE: "1000",
    FEED_INITIAL_EVENT_COUNT: "0",
    FEED_FIXTURE_INTERVAL_MS: "10",
    FEED_FIXTURE_BURST_SIZE: "25",
    FEED_ARCHIVE_DIR: archiveDir,
    FEED_DB_PATH: databasePath
  });

  try {
    await waitForStressEvents();
  } finally {
    await stopProcess(feedServer);
  }

  const archivePath = await findNewestSessionPath();
  const report = await buildEvidenceReport({
    archivePath,
    databasePath
  });

  if (!report.ok) {
    throw new Error(`Stress evidence failed: ${report.issues.join("; ")}`);
  }

  if (report.eventCount < targetEvents) {
    throw new Error(`Expected at least ${targetEvents} events, got ${report.eventCount}`);
  }

  if (report.performance.eventsPerSecond < minimumEventsPerSecond) {
    throw new Error(
      `Expected at least ${minimumEventsPerSecond} events/s, got ${report.performance.eventsPerSecond.toFixed(2)}`
    );
  }

  if (report.performance.p95LatencyMs > maximumP95LatencyMs) {
    throw new Error(`Expected p95 latency <= ${maximumP95LatencyMs}ms, got ${report.performance.p95LatencyMs}ms`);
  }

  console.log(
    [
      "Stress rehearsal passed",
      `Archive: ${archivePath}`,
      `Database: ${databasePath}`,
      `Events: ${report.eventCount}`,
      `Throughput: ${report.performance.eventsPerSecond.toFixed(2)} events/s`,
      `P95 latency: ${report.performance.p95LatencyMs.toFixed(0)}ms`
    ].join("\n")
  );
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

async function waitForStressEvents() {
  const startedAt = Date.now();
  const socket = await connectStressSocket();
  let eventCount = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out after receiving ${eventCount}/${targetEvents} stress events`));
    }, 15_000);

    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string };

      if (message.type !== "event") return;

      eventCount += 1;

      if (eventCount >= targetEvents) {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  const durationSeconds = (Date.now() - startedAt) / 1000;

  if (targetEvents / durationSeconds < minimumEventsPerSecond) {
    throw new Error(`Stress client received ${eventCount} events too slowly over ${durationSeconds.toFixed(2)}s`);
  }
}

async function connectStressSocket() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      return await openFeedSocket();
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for ${feedWsUrl}`);
}

function openFeedSocket() {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(feedWsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("feed socket timeout"));
    }, 1000);

    socket.once("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function findNewestSessionPath() {
  const sessions = await readdir(archiveDir);
  const sessionStats = await Promise.all(
    sessions.map(async (session) => ({
      session,
      stats: await stat(path.join(archiveDir, session))
    }))
  );
  const newestSession = sessionStats
    .filter(({ stats }) => stats.isDirectory())
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)[0]?.session;

  if (!newestSession) {
    throw new Error(`No stress archive sessions found in ${archiveDir}`);
  }

  return path.join(archiveDir, newestSession);
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.killed || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.kill("SIGTERM");
  });
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
