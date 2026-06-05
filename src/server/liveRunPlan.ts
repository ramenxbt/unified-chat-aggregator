import { evaluateLivePreflight, formatLivePreflightReport, type LivePreflightEnv } from "./livePreflight";

export type LiveRunPlanOptions = {
  allowPartial?: boolean;
  appPort?: number;
  feedPort?: number;
  archiveDir?: string;
  databasePath?: string;
};

export type LiveRunPlan = {
  ok: boolean;
  report: ReturnType<typeof evaluateLivePreflight>;
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
  };
  evidence: {
    archiveDir: string;
    databasePath: string;
    replayJsonCommand: string;
    replayCsvCommand: string;
  };
};

export function buildLiveRunPlan(env: LivePreflightEnv, options: LiveRunPlanOptions = {}): LiveRunPlan {
  const feedPort = options.feedPort ?? Number(env.FEED_SERVER_PORT ?? 8787);
  const appPort = options.appPort ?? Number(env.VITE_DEV_SERVER_PORT ?? 5173);
  const archiveDir = options.archiveDir ?? env.FEED_ARCHIVE_DIR ?? "data/feed-sessions";
  const databasePath = options.databasePath ?? env.FEED_DB_PATH ?? "data/feed.sqlite";
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
    commands: {
      feed: `${formatEnvAssignment("FEED_DB_PATH", databasePath)} ${formatEnvAssignment(
        "FEED_ARCHIVE_DIR",
        archiveDir
      )} npm run feed`,
      dashboard: `${formatEnvAssignment("VITE_FEED_WS_URL", feedWsUrl)} npm run dev`
    },
    urls: {
      dashboard: dashboardUrl,
      obsAllSources: `${dashboardUrl}?obs=1&sources=twitch,kick,x&limit=14`,
      obsTwitchKick: `${dashboardUrl}?obs=1&sources=twitch,kick&limit=12`,
      obsSignals: `${dashboardUrl}?obs=1&signal=1&limit=10`,
      kickWebhookLocal: `http://127.0.0.1:${kickWebhookPort}${kickWebhookPath}`,
      kickWebhookPublic: env.KICK_WEBHOOK_PUBLIC_URL
    },
    evidence: {
      archiveDir,
      databasePath,
      replayJsonCommand: `npm run archive:export -- ${archiveDir}/<session-id> --out replay.json`,
      replayCsvCommand: `npm run archive:export -- ${archiveDir}/<session-id> --format csv --out replay.csv`
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
    "",
    "Evidence outputs:",
    `  archive: ${plan.evidence.archiveDir}/<session-id>`,
    `  database: ${plan.evidence.databasePath}`,
    `  replay JSON: ${plan.evidence.replayJsonCommand}`,
    `  replay CSV: ${plan.evidence.replayCsvCommand}`
  ];

  return lines.join("\n");
}

function formatEnvAssignment(name: string, value: string) {
  return `${name}=${shellQuote(value)}`;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
