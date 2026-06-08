import { evaluateLivePreflight, formatLivePreflightReport, type LivePreflightEnv } from "./livePreflight";

export type LiveRunPlanOptions = {
  allowPartial?: boolean;
  appPort?: number;
  feedPort?: number;
  archiveDir?: string;
  databasePath?: string;
  proofTimeoutMs?: number;
  proofIntervalMs?: number;
};

export type LiveRunPlan = {
  ok: boolean;
  report: ReturnType<typeof evaluateLivePreflight>;
  proofGate: {
    minEvents: number;
    minSourceLabels: number;
    maxP95LatencyMs: number;
    timeoutMs: number;
    intervalMs: number;
  };
  commands: {
    feed: string;
    dashboard: string;
  };
  urls: {
    dashboard: string;
    obsAllSources: string;
    obsTwitchKick: string;
    obsSignals: string;
    kickWebhookLocal: string;
    kickWebhookPublic?: string;
    kickWebhookHealth: string;
  };
  obs: {
    sourceType: string;
    width: number;
    height: number;
    fps: number;
    background: string;
    shutdownWhenNotVisible: string;
    refreshWhenActive: string;
    customCss: string;
  };
  evidence: {
    archiveDir: string;
    databasePath: string;
    proofGateCommand: string;
    evidenceCheckCommand: string;
    submissionBundleCommand: string;
    replayJsonCommand: string;
    replayCsvCommand: string;
  };
};

export function buildLiveRunPlan(env: LivePreflightEnv, options: LiveRunPlanOptions = {}): LiveRunPlan {
  const feedPort = options.feedPort ?? Number(env.FEED_SERVER_PORT ?? 8787);
  const appPort = options.appPort ?? Number(env.VITE_DEV_SERVER_PORT ?? 5173);
  const archiveDir = options.archiveDir ?? env.FEED_ARCHIVE_DIR ?? "data/feed-sessions";
  const databasePath = options.databasePath ?? env.FEED_DB_PATH ?? "data/feed.sqlite";
  const proofGate = {
    minEvents: parsePositiveNumber(env.PROOF_MIN_EVENTS, 25),
    minSourceLabels: parsePositiveNumber(env.PROOF_MIN_SOURCE_LABELS, 3),
    maxP95LatencyMs: parsePositiveNumber(env.PROOF_MAX_P95_LATENCY_MS, 5000),
    timeoutMs: parsePositiveNumber(options.proofTimeoutMs, parsePositiveNumber(env.PROOF_TIMEOUT_MS, 120_000)),
    intervalMs: parsePositiveNumber(options.proofIntervalMs, parsePositiveNumber(env.PROOF_INTERVAL_MS, 1000))
  };
  const partialFlag = options.allowPartial ? " --allow-partial" : "";
  const kickWebhookPort = env.KICK_WEBHOOK_PORT ?? "8788";
  const kickWebhookPath = env.KICK_WEBHOOK_PATH ?? "/webhooks/kick";
  const dashboardUrl = `http://127.0.0.1:${appPort}/`;
  const feedWsUrl = `ws://127.0.0.1:${feedPort}`;
  const report = evaluateLivePreflight(env, {
    requireAllPlatforms: !options.allowPartial
  });

  return {
    ok: report.ok,
    report,
    proofGate,
    commands: {
      feed: `${formatEnvAssignment("FEED_SERVER_PORT", String(feedPort))} ${formatEnvAssignment(
        "FEED_DB_PATH",
        databasePath
      )} ${formatEnvAssignment(
        "FEED_ARCHIVE_DIR",
        archiveDir
      )} npm run feed`,
      dashboard: `${formatEnvAssignment("VITE_FEED_WS_URL", feedWsUrl)} npm run dev -- --host 127.0.0.1 --port ${shellQuote(String(appPort))}`
    },
    urls: {
      dashboard: dashboardUrl,
      obsAllSources: `${dashboardUrl}?obs=1&sources=twitch,kick,x&limit=14`,
      obsTwitchKick: `${dashboardUrl}?obs=1&sources=twitch,kick&limit=12`,
      obsSignals: `${dashboardUrl}?obs=1&signal=1&limit=10`,
      kickWebhookLocal: `http://127.0.0.1:${kickWebhookPort}${kickWebhookPath}`,
      kickWebhookPublic: env.KICK_WEBHOOK_PUBLIC_URL,
      kickWebhookHealth: env.KICK_WEBHOOK_PUBLIC_URL ?? `http://127.0.0.1:${kickWebhookPort}${kickWebhookPath}`
    },
    obs: {
      sourceType: "Browser Source",
      width: 1280,
      height: 720,
      fps: 30,
      background: "transparent",
      shutdownWhenNotVisible: "off",
      refreshWhenActive: "off",
      customCss: "body { background: rgba(0, 0, 0, 0); overflow: hidden; }"
    },
    evidence: {
      archiveDir,
      databasePath,
      proofGateCommand: [
        "npm run proof:gate --",
        `--archive-dir ${shellQuote(archiveDir)}`,
        "--watch",
        `--min-events ${proofGate.minEvents}`,
        `--min-source-labels ${proofGate.minSourceLabels}`,
        `--max-p95-latency-ms ${proofGate.maxP95LatencyMs}`,
        `--timeout-ms ${proofGate.timeoutMs}`,
        `--interval-ms ${proofGate.intervalMs}${partialFlag}`
      ].join(" "),
      evidenceCheckCommand: `npm run evidence:check -- --archive-dir ${shellQuote(archiveDir)} --db ${shellQuote(databasePath)}${partialFlag}`,
      submissionBundleCommand: `npm run submission:bundle -- --archive-dir ${shellQuote(archiveDir)} --db ${shellQuote(databasePath)} --out submission-bundle${partialFlag}`,
      replayJsonCommand: `npm run archive:export -- --archive-dir ${shellQuote(archiveDir)} --out replay.json`,
      replayCsvCommand: `npm run archive:export -- --archive-dir ${shellQuote(archiveDir)} --format csv --out replay.csv`
    }
  };
}

export function formatLiveRunPlan(plan: LiveRunPlan): string {
  const lines = [
    formatLivePreflightReport(plan.report),
    "",
    "Final run commands:",
    `  feed: ${plan.commands.feed}`,
    `  dashboard: ${plan.commands.dashboard}`,
    "",
    "Open:",
    `  dashboard: ${plan.urls.dashboard}`,
    `  OBS all sources: ${plan.urls.obsAllSources}`,
    `  OBS Twitch + Kick: ${plan.urls.obsTwitchKick}`,
    `  OBS signals: ${plan.urls.obsSignals}`,
    "",
    "Kick webhook:",
    `  local receiver: ${plan.urls.kickWebhookLocal}`,
    `  public URL: ${plan.urls.kickWebhookPublic ?? "not configured"}`,
    `  tunnel health check: curl -i ${shellQuote(plan.urls.kickWebhookHealth)}`,
    "",
    "OBS browser source settings:",
    `  source type: ${plan.obs.sourceType}`,
    `  size: ${plan.obs.width}x${plan.obs.height}`,
    `  FPS: ${plan.obs.fps}`,
    `  background: ${plan.obs.background}`,
    `  shutdown when not visible: ${plan.obs.shutdownWhenNotVisible}`,
    `  refresh browser when scene becomes active: ${plan.obs.refreshWhenActive}`,
    `  custom CSS: ${plan.obs.customCss}`,
    "",
    "Evidence outputs:",
    `  latest archive directory: ${plan.evidence.archiveDir}`,
    `  database: ${plan.evidence.databasePath}`,
    `  live proof gate: ${plan.evidence.proofGateCommand}`,
    `  evidence check: ${plan.evidence.evidenceCheckCommand}`,
    `  submission bundle: ${plan.evidence.submissionBundleCommand}`,
    `  replay JSON: ${plan.evidence.replayJsonCommand}`,
    `  replay CSV: ${plan.evidence.replayCsvCommand}`
  ];

  return lines.join("\n");
}

function formatEnvAssignment(name: string, value: string) {
  return `${name}=${shellQuote(value)}`;
}

function parsePositiveNumber(value: string | number | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
