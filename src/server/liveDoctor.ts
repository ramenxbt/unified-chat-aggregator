import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildLiveRunPlan, formatLiveRunPlan, type LiveRunPlanOptions } from "./liveRunPlan";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

export type LiveDoctorCheck = {
  name: string;
  state: "ready" | "attention" | "setup";
  detail: string;
};

export type LiveDoctorReport = {
  ok: boolean;
  checks: LiveDoctorCheck[];
  plan: ReturnType<typeof buildLiveRunPlan>;
};

type LiveDoctorOptions = LiveRunPlanOptions & {
  checkPort?: (label: string, port: number) => Promise<LiveDoctorCheck>;
  checkWritableDirectory?: (label: string, directoryPath: string) => Promise<LiveDoctorCheck>;
};

export async function buildLiveDoctorReport(
  env: LivePreflightEnv,
  options: LiveDoctorOptions = {}
): Promise<LiveDoctorReport> {
  const plan = buildLiveRunPlan(env, options);
  const feedPort = options.feedPort ?? Number(env.FEED_SERVER_PORT ?? 8787);
  const appPort = options.appPort ?? Number(env.VITE_DEV_SERVER_PORT ?? 5173);
  const archiveDir = options.archiveDir ?? env.FEED_ARCHIVE_DIR ?? "data/feed-sessions";
  const databasePath = options.databasePath ?? env.FEED_DB_PATH ?? "data/feed.sqlite";
  const checkPort = options.checkPort ?? checkPortAvailability;
  const checkWritableDirectory = options.checkWritableDirectory ?? checkDirectoryWritable;
  const portClaims = [
    { label: "Feed WebSocket port", port: feedPort },
    { label: "Dashboard dev port", port: appPort }
  ];
  const checks: LiveDoctorCheck[] = [
    {
      name: "Connector preflight",
      state: plan.ok ? "ready" : "setup",
      detail: plan.ok
        ? "Connector environment is ready for the requested platform requirement."
        : "Run npm run preflight for missing connector credentials and setup."
    },
    await checkPort("Feed WebSocket port", feedPort),
    await checkPort("Dashboard dev port", appPort)
  ];

  const kickWebhookEnabled = env.KICK_WEBHOOK_ENABLED === "true" || Boolean(env.KICK_WEBHOOK_PUBLIC_URL);
  if (kickWebhookEnabled) {
    const kickWebhookPort = Number(env.KICK_WEBHOOK_PORT ?? 8788);
    portClaims.push({ label: "Kick webhook port", port: kickWebhookPort });
    checks.push(await checkPort("Kick webhook port", kickWebhookPort));
  }

  checks.push(...buildPortConflictChecks(portClaims));

  if (env.FEED_ARCHIVE_ENABLED === "false") {
    checks.push({
      name: "Server archive",
      state: "setup",
      detail: "FEED_ARCHIVE_ENABLED=false disables the JSONL evidence archive required for final proof."
    });
  } else {
    checks.push(await checkWritableDirectory("Server archive directory", archiveDir));
  }

  if (databasePath) {
    checks.push(await checkWritableDirectory("SQLite database directory", path.dirname(databasePath)));
  } else {
    checks.push({
      name: "SQLite database",
      state: "attention",
      detail: "FEED_DB_PATH is not set. JSONL evidence will still work, but the final run loses queryable proof."
    });
  }

  return {
    ok: plan.ok && checks.every((check) => check.state === "ready" || check.state === "attention"),
    checks,
    plan
  };
}

export function formatLiveDoctorReport(report: LiveDoctorReport) {
  const lines = [
    `Live doctor: ${report.ok ? "ready" : "needs setup"}`,
    "",
    "Local checks:",
    ...report.checks.map((check) => `  ${formatCheckState(check.state)} ${check.name}: ${check.detail}`),
    "",
    formatLiveRunPlan(report.plan)
  ];

  return lines.join("\n");
}

async function checkPortAvailability(label: string, port: number): Promise<LiveDoctorCheck> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      name: label,
      state: "setup",
      detail: `Invalid port ${port}.`
    };
  }

  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve({
        name: label,
        state: "setup",
        detail: error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : `Port ${port} unavailable: ${error.message}`
      });
    });

    server.once("listening", () => {
      server.close(() => {
        resolve({
          name: label,
          state: "ready",
          detail: `Port ${port} is available.`
        });
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

async function checkDirectoryWritable(label: string, directoryPath: string): Promise<LiveDoctorCheck> {
  const resolvedDirectory = path.resolve(directoryPath);
  const checkPath = path.join(resolvedDirectory, `.live-doctor-${process.pid}-${Date.now()}`);

  try {
    await mkdir(resolvedDirectory, { recursive: true });
    await writeFile(checkPath, "ok", "utf8");
    await unlink(checkPath);

    return {
      name: label,
      state: "ready",
      detail: `${directoryPath} is writable.`
    };
  } catch (error: unknown) {
    return {
      name: label,
      state: "setup",
      detail: `${directoryPath} is not writable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function formatCheckState(state: LiveDoctorCheck["state"]) {
  if (state === "ready") return "PASS";
  if (state === "attention") return "WARN";

  return "MISS";
}

function buildPortConflictChecks(portClaims: { label: string; port: number }[]): LiveDoctorCheck[] {
  const claimsByPort = new Map<number, string[]>();

  for (const claim of portClaims) {
    claimsByPort.set(claim.port, [...(claimsByPort.get(claim.port) ?? []), claim.label]);
  }

  return [...claimsByPort.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([port, labels]) => ({
      name: "Local port conflict",
      state: "setup" as const,
      detail: `${labels.join(" and ")} both use port ${port}. Set separate FEED_SERVER_PORT, VITE_DEV_SERVER_PORT, or KICK_WEBHOOK_PORT values.`
    }));
}

async function runCli() {
  loadLocalEnv();

  const allowPartial = process.argv.includes("--allow-partial");
  const report = await buildLiveDoctorReport(process.env, {
    allowPartial
  });

  console.log(formatLiveDoctorReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
