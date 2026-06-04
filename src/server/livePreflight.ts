import type { SourcePlatform } from "../domain/unifiedEvent";

export type LivePreflightEnv = Record<string, string | undefined>;

export type PlatformPreflight = {
  platform: SourcePlatform;
  label: string;
  willStart: boolean;
  ready: boolean;
  missing: string[];
  warnings: string[];
  details: string[];
};

export type LivePreflightReport = {
  ok: boolean;
  mode: "connectors" | "fixture";
  requireAllPlatforms: boolean;
  checks: PlatformPreflight[];
};

export function evaluateLivePreflight(
  env: LivePreflightEnv,
  options: { requireAllPlatforms?: boolean } = {}
): LivePreflightReport {
  const requireAllPlatforms = options.requireAllPlatforms ?? true;
  const checks = [checkTwitch(env), checkKick(env), checkX(env)];
  const mode = checks.some((check) => check.willStart) ? "connectors" : "fixture";
  const ok = requireAllPlatforms
    ? checks.every((check) => check.ready)
    : checks.some((check) => check.ready || check.willStart);

  return {
    ok,
    mode,
    requireAllPlatforms,
    checks
  };
}

export function formatLivePreflightReport(report: LivePreflightReport): string {
  const lines = [
    `Live preflight: ${report.ok ? "ready" : "needs setup"}`,
    `Feed mode if started now: ${report.mode}`,
    `Platform requirement: ${report.requireAllPlatforms ? "Twitch + Kick + X" : "at least one live connector"}`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`${check.ready ? "PASS" : check.willStart ? "WARN" : "MISS"} ${check.label}`);

    for (const detail of check.details) {
      lines.push(`  ${detail}`);
    }
    for (const missing of check.missing) {
      lines.push(`  missing: ${missing}`);
    }
    for (const warning of check.warnings) {
      lines.push(`  warning: ${warning}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function checkTwitch(env: LivePreflightEnv): PlatformPreflight {
  const required = ["TWITCH_CLIENT_ID", "TWITCH_ACCESS_TOKEN", "TWITCH_BROADCASTER_USER_ID", "TWITCH_BOT_USER_ID"];
  const missing = required.filter((key) => !env[key]);

  return {
    platform: "twitch",
    label: "Twitch EventSub",
    willStart: missing.length === 0,
    ready: missing.length === 0,
    missing,
    warnings: [],
    details: [
      env.TWITCH_BROADCASTER_LOGIN
        ? `source: ${env.TWITCH_BROADCASTER_LOGIN}`
        : env.TWITCH_BROADCASTER_USER_ID
          ? `source id: ${env.TWITCH_BROADCASTER_USER_ID}`
          : "source: not configured"
    ]
  };
}

function checkKick(env: LivePreflightEnv): PlatformPreflight {
  const webhookEnabled = env.KICK_WEBHOOK_ENABLED === "true" || Boolean(env.KICK_WEBHOOK_PUBLIC_URL);
  const subscribeOnStart = env.KICK_SUBSCRIBE_ON_START === "true";
  const missing = webhookEnabled ? [] : ["KICK_WEBHOOK_ENABLED=true or KICK_WEBHOOK_PUBLIC_URL"];
  const warnings: string[] = [];
  const port = env.KICK_WEBHOOK_PORT ?? "8788";
  const path = env.KICK_WEBHOOK_PATH ?? "/webhooks/kick";

  if (webhookEnabled && !env.KICK_WEBHOOK_PUBLIC_URL) {
    warnings.push(`expose http://127.0.0.1:${port}${path} through a public tunnel for Kick delivery`);
  }

  if (subscribeOnStart) {
    if (!env.KICK_ACCESS_TOKEN) missing.push("KICK_ACCESS_TOKEN");
    if (!env.KICK_BROADCASTER_USER_ID) missing.push("KICK_BROADCASTER_USER_ID");
  }

  return {
    platform: "kick",
    label: "Kick Events webhook",
    willStart: webhookEnabled,
    ready: webhookEnabled && missing.length === 0,
    missing,
    warnings,
    details: [
      env.KICK_BROADCASTER_SLUG
        ? `source: ${env.KICK_BROADCASTER_SLUG}`
        : env.KICK_BROADCASTER_USER_ID
          ? `source id: ${env.KICK_BROADCASTER_USER_ID}`
          : "source: not configured",
      subscribeOnStart ? "subscription: auto subscribe on start" : "subscription: manual or dashboard-managed"
    ]
  };
}

function checkX(env: LivePreflightEnv): PlatformPreflight {
  const filterRules = parseEnvList(env.X_FILTER_RULES);
  const hasSource = filterRules.length > 0 || Boolean(env.X_SPACES_QUERY);
  const missing = [];

  if (!env.X_BEARER_TOKEN) missing.push("X_BEARER_TOKEN");
  if (!hasSource) missing.push("X_FILTER_RULES or X_SPACES_QUERY");

  return {
    platform: "x",
    label: "X API",
    willStart: missing.length === 0,
    ready: missing.length === 0,
    missing,
    warnings: [],
    details: [
      filterRules.length ? `filtered stream rules: ${filterRules.length}` : "filtered stream rules: none",
      env.X_SPACES_QUERY ? `Spaces query: ${env.X_SPACES_QUERY}` : "Spaces query: none"
    ]
  };
}

function parseEnvList(value: string | undefined) {
  return (
    value
      ?.split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}
