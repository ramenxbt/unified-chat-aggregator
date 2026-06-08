import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildLiveDoctorReport, formatLiveDoctorReport, type LiveDoctorOptions } from "./liveDoctor";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

type LiveStackProcessPlan = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type LiveStackLaunchPlan = {
  ok: boolean;
  doctor: Awaited<ReturnType<typeof buildLiveDoctorReport>>;
  processes: {
    feed: LiveStackProcessPlan;
    dashboard: LiveStackProcessPlan;
    proofGate: LiveStackProcessPlan;
  };
};

type RunLiveStackOptions = LiveDoctorOptions & {
  dryRun?: boolean;
  withProofGate?: boolean;
  spawnProcess?: typeof spawn;
};

export async function buildLiveStackLaunchPlan(
  env: LivePreflightEnv,
  options: LiveDoctorOptions = {}
): Promise<LiveStackLaunchPlan> {
  const doctor = await buildLiveDoctorReport(env, options);
  const feedPort = options.feedPort ?? Number(env.FEED_SERVER_PORT ?? 8787);
  const appPort = options.appPort ?? Number(env.VITE_DEV_SERVER_PORT ?? 5173);
  const feedWsUrl = `ws://127.0.0.1:${feedPort}`;

  const proofGateArgs = [
    "run",
    "proof:gate",
    "--",
    "--archive-dir",
    doctor.plan.evidence.archiveDir,
    "--watch",
    "--min-events",
    String(doctor.plan.proofGate.minEvents),
    "--min-source-labels",
    String(doctor.plan.proofGate.minSourceLabels),
    "--max-p95-latency-ms",
    String(doctor.plan.proofGate.maxP95LatencyMs)
  ];

  if (options.allowPartial) {
    proofGateArgs.push("--allow-partial");
  }

  return {
    ok: doctor.ok,
    doctor,
    processes: {
      feed: {
        name: "feed",
        command: "npm",
        args: ["run", "feed"],
        env: {
          FEED_SERVER_PORT: String(feedPort),
          FEED_DB_PATH: doctor.plan.evidence.databasePath,
          FEED_ARCHIVE_DIR: doctor.plan.evidence.archiveDir
        }
      },
      dashboard: {
        name: "dashboard",
        command: "npm",
        args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(appPort)],
        env: {
          VITE_FEED_WS_URL: feedWsUrl
        }
      },
      proofGate: {
        name: "proof",
        command: "npm",
        args: proofGateArgs,
        env: {}
      }
    }
  };
}

export async function runLiveStack(env: LivePreflightEnv, options: RunLiveStackOptions = {}) {
  const launchPlan = await buildLiveStackLaunchPlan(env, options);

  console.log(formatLiveDoctorReport(launchPlan.doctor));

  if (!launchPlan.ok) {
    return 1;
  }

  console.log("");
  console.log("Live stack launch:");
  console.log(`  feed: ${formatProcessPlan(launchPlan.processes.feed)}`);
  console.log(`  dashboard: ${formatProcessPlan(launchPlan.processes.dashboard)}`);
  console.log(`  proof gate: ${formatProcessPlan(launchPlan.processes.proofGate)}`);

  if (options.dryRun) {
    console.log("");
    console.log("Live stack dry run: ready");
    return 0;
  }

  const spawnProcess = options.spawnProcess ?? spawn;
  const persistentChildren = [
    startProcess(launchPlan.processes.feed, spawnProcess),
    startProcess(launchPlan.processes.dashboard, spawnProcess)
  ];
  const proofGate = options.withProofGate ? startProcess(launchPlan.processes.proofGate, spawnProcess) : undefined;

  return waitForStackExit(persistentChildren, proofGate);
}

function startProcess(plan: LiveStackProcessPlan, spawnProcess: typeof spawn) {
  const child = spawnProcess(plan.command, plan.args, {
    env: {
      ...process.env,
      ...plan.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(`[${plan.name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${plan.name}] ${chunk}`);
  });

  return child;
}

function waitForStackExit(
  persistentChildren: ReturnType<typeof startProcess>[],
  proofGate: ReturnType<typeof startProcess> | undefined
) {
  return new Promise<number>((resolve) => {
    let settled = false;
    const allChildren = proofGate ? [...persistentChildren, proofGate] : persistentChildren;
    const shutdown = (exitCode: number) => {
      if (settled) return;
      settled = true;

      for (const child of allChildren) {
        if (!child.killed && child.exitCode === null) {
          child.kill("SIGTERM");
        }
      }

      resolve(exitCode);
    };

    for (const child of persistentChildren) {
      child.once("exit", (code) => {
        shutdown(code ?? 0);
      });
    }

    proofGate?.once("exit", (code) => {
      if (code && code !== 0) {
        shutdown(code);
        return;
      }

      console.log("[proof] Live proof gate is ready. Feed and dashboard remain running.");
    });

    process.once("SIGINT", () => shutdown(130));
    process.once("SIGTERM", () => shutdown(143));
  });
}

function formatProcessPlan(plan: LiveStackProcessPlan) {
  const envAssignments = Object.entries(plan.env).map(([key, value]) => `${key}=${shellQuote(value)}`);

  return [...envAssignments, plan.command, ...plan.args.map(shellQuote)].join(" ");
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseArgs(args: string[]) {
  return {
    allowPartial: args.includes("--allow-partial"),
    dryRun: args.includes("--dry-run"),
    withProofGate: args.includes("--with-proof-gate")
  };
}

async function runCli() {
  loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));
  const exitCode = await runLiveStack(process.env, options);

  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
