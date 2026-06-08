import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseLiveRunCliArgs, readOptionalArgValue } from "./liveCliArgs";
import { buildLiveRunPlan, type LiveRunPlan } from "./liveRunPlan";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

export type ObsBrowserSource = {
  name: string;
  url: string;
  purpose: string;
  width: number;
  height: number;
  fps: number;
  customCss: string;
  shutdownWhenNotVisible: string;
  refreshWhenActive: string;
};

export type ObsHandoff = {
  generatedAt: string;
  repo: {
    commit: string | null;
    branch: string | null;
    remote: string | null;
  };
  dashboardUrl: string;
  browserSourceSettings: {
    width: number;
    height: number;
    fps: number;
    background: string;
    shutdownWhenNotVisible: string;
    refreshWhenActive: string;
    customCss: string;
  };
  sources: ObsBrowserSource[];
};

export type ObsHandoffResult = {
  handoff: ObsHandoff;
  files: {
    markdown: string;
    json: string;
  };
};

export async function createObsHandoff(env: LivePreflightEnv, args: string[] = []): Promise<ObsHandoffResult> {
  const { outDir, planArgs } = parseObsHandoffArgs(args);
  const plan = buildLiveRunPlan(env, planArgs);
  const handoff = buildObsHandoff(plan);
  const resolvedOutDir = path.resolve(outDir);
  const files = {
    markdown: path.join(resolvedOutDir, "obs-browser-sources.md"),
    json: path.join(resolvedOutDir, "obs-browser-sources.json")
  };

  await mkdir(resolvedOutDir, { recursive: true });
  await Promise.all([
    writeFile(files.markdown, `${formatObsHandoffMarkdown(handoff)}\n`, "utf8"),
    writeFile(files.json, `${JSON.stringify(handoff, null, 2)}\n`, "utf8")
  ]);

  return {
    handoff,
    files
  };
}

export function buildObsHandoff(plan: LiveRunPlan, generatedAt = new Date().toISOString()): ObsHandoff {
  const browserSourceSettings = {
    width: plan.obs.width,
    height: plan.obs.height,
    fps: plan.obs.fps,
    background: plan.obs.background,
    shutdownWhenNotVisible: plan.obs.shutdownWhenNotVisible,
    refreshWhenActive: plan.obs.refreshWhenActive,
    customCss: plan.obs.customCss
  };

  const sourceDefaults = {
    width: plan.obs.width,
    height: plan.obs.height,
    fps: plan.obs.fps,
    customCss: plan.obs.customCss,
    shutdownWhenNotVisible: plan.obs.shutdownWhenNotVisible,
    refreshWhenActive: plan.obs.refreshWhenActive
  };

  const primarySources: ObsBrowserSource[] = [
    {
      name: "Unified Chat - All Sources",
      url: plan.urls.obsAllSources,
      purpose: "Primary final overlay with Twitch, Kick, and X in one feed.",
      ...sourceDefaults
    },
    {
      name: "Unified Chat - Twitch + Kick",
      url: plan.urls.obsTwitchKick,
      purpose: "Backup overlay for native live-chat comparison shots.",
      ...sourceDefaults
    },
    {
      name: "Unified Chat - Signals",
      url: plan.urls.obsSignals,
      purpose: "High-signal messages and moderated review moments.",
      ...sourceDefaults
    }
  ];

  return {
    generatedAt,
    repo: collectRepoMetadata(),
    dashboardUrl: plan.urls.dashboard,
    browserSourceSettings,
    sources: [...primarySources, ...buildFocusedSources(plan, sourceDefaults)]
  };
}

export function formatObsHandoffMarkdown(handoff: ObsHandoff) {
  const lines = [
    "# OBS Browser Source Handoff",
    "",
    `Generated: ${handoff.generatedAt}`,
    `Commit: ${handoff.repo.commit ?? "unknown"}`,
    `Branch: ${handoff.repo.branch ?? "unknown"}`,
    `Remote: ${handoff.repo.remote ?? "unknown"}`,
    `Dashboard: ${handoff.dashboardUrl}`,
    "",
    "## Browser Source Settings",
    "",
    `- Width: ${handoff.browserSourceSettings.width}`,
    `- Height: ${handoff.browserSourceSettings.height}`,
    `- FPS: ${handoff.browserSourceSettings.fps}`,
    `- Background: ${handoff.browserSourceSettings.background}`,
    `- Shutdown when not visible: ${handoff.browserSourceSettings.shutdownWhenNotVisible}`,
    `- Refresh browser when scene becomes active: ${handoff.browserSourceSettings.refreshWhenActive}`,
    `- Custom CSS: \`${handoff.browserSourceSettings.customCss}\``,
    "",
    "## Sources",
    ""
  ];

  for (const source of handoff.sources) {
    lines.push(
      `### ${source.name}`,
      "",
      `- URL: ${source.url}`,
      `- Use: ${source.purpose}`,
      `- Size: ${source.width}x${source.height}`,
      `- FPS: ${source.fps}`,
      ""
    );
  }

  lines.push(
    "## Final Capture Checklist",
    "",
    "- Start the feed server and dashboard from `npm run live:prepare`.",
    "- Add `Unified Chat - All Sources` as the primary OBS browser source.",
    "- Keep the source dimensions at 1280x720 unless the scene canvas is intentionally different.",
    "- Confirm account-qualified labels are visible, such as `TWITCH (ANSEM)` or `KICK (ANSEM)`.",
    "- Keep this handoff with the final run sheet and submission bundle."
  );

  return lines.join("\n");
}

function formatObsUrl(dashboardUrl: string, query: string) {
  return `${dashboardUrl}?obs=1&${query}`;
}

function buildFocusedSources(plan: LiveRunPlan, sourceDefaults: Omit<ObsBrowserSource, "name" | "url" | "purpose">) {
  return plan.targetSourceLabels
    .map(parseSourceLabel)
    .filter((source): source is { platform: string; account: string; query: string } => Boolean(source))
    .map((source) => ({
      name: `Unified Chat - ${source.platform.toUpperCase()} ${source.account.toUpperCase()} Focus`,
      url: formatObsUrl(plan.urls.dashboard, `sources=${source.platform}&limit=8&q=${encodeURIComponent(source.query)}`),
      purpose: `Focused ${source.platform.toUpperCase()} account proof shot for ${source.account}.`,
      ...sourceDefaults
    }));
}

function parseSourceLabel(label: string) {
  const match = label.match(/^([A-Z]+)\s+\((.+)\)$/i);

  if (!match) return null;

  const platform = match[1].toLowerCase();
  const account = match[2];
  const query = account.startsWith("@") ? account.slice(1) : account;

  return { platform, account, query };
}

function collectRepoMetadata() {
  return {
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    remote: runGit(["remote", "get-url", "origin"])
  };
}

function runGit(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function parseObsHandoffArgs(args: string[]) {
  const planArgs = parseLiveRunCliArgs(args);
  let outDir = "qa/obs";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out" || arg === "--output") {
      const value = readOptionalArgValue(args, index);
      if (value !== undefined) {
        outDir = value;
        index += 1;
      }
    }
  }

  return {
    outDir,
    planArgs
  };
}

async function runCli() {
  loadLocalEnv();

  const result = await createObsHandoff(process.env, process.argv.slice(2));

  console.log("OBS handoff files written:");
  console.log(`  Markdown: ${result.files.markdown}`);
  console.log(`  JSON: ${result.files.json}`);
  console.log("Sources:");
  for (const source of result.handoff.sources) {
    console.log(`  ${source.name}: ${source.url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
