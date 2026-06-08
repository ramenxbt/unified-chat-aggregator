import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseLiveRunCliArgs } from "./liveCliArgs";
import { buildLiveRunPlan, type LiveRunPlan, type LiveRunPlanOptions } from "./liveRunPlan";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

export type FinalReadinessCheck = {
  name: string;
  state: "ready" | "setup";
  detail: string;
};

export type FinalReadinessReport = {
  ok: boolean;
  checks: FinalReadinessCheck[];
  plan: LiveRunPlan;
};

export type FinalReadinessOptions = LiveRunPlanOptions & {
  qaDir?: string;
  obsHandoffDir?: string;
};

type LiveRunPlanReadinessCheck = FinalReadinessCheck & {
  expectedObsAllSourcesUrl?: string;
};

export async function buildFinalReadinessReport(
  env: LivePreflightEnv,
  options: FinalReadinessOptions = {}
): Promise<FinalReadinessReport> {
  const plan = buildLiveRunPlan(env, options);
  const qaDir = options.qaDir ?? "qa";
  const obsHandoffDir = options.obsHandoffDir ?? path.join(qaDir, "obs");
  const repo = collectRepoMetadata();
  const liveRunPlanCheck = await checkLiveRunPlan(
    path.join(qaDir, "live-run-plan.txt"),
    repo.commit,
    plan.urls.obsAllSources,
    plan.evidence.proofGateCommand
  );
  const obsHandoffCheck = await checkObsHandoff(obsHandoffDir, liveRunPlanCheck.expectedObsAllSourcesUrl, repo.commit);
  const checks = [
    {
      name: "Strict connector preflight",
      state: plan.ok ? "ready" : "setup",
      detail: plan.ok
        ? "Twitch, Kick, and X are ready for a connector-mode capture."
        : "Run npm run preflight and resolve missing Twitch, Kick, or X setup before recording."
    } satisfies FinalReadinessCheck,
    await checkFinalQaReport(path.join(qaDir, "final-report.json"), repo.commit),
    liveRunPlanCheck,
    obsHandoffCheck
  ];

  return {
    ok: checks.every((check) => check.state === "ready"),
    checks,
    plan
  };
}

export function formatFinalReadinessReport(report: FinalReadinessReport) {
  return [
    `Final recording readiness: ${report.ok ? "ready" : "needs setup"}`,
    "",
    "Checks:",
    ...report.checks.map((check) => `  ${check.state === "ready" ? "PASS" : "MISS"} ${check.name}: ${check.detail}`),
    "",
    "Required final commands:",
    "  npm run qa:final",
    "  npm run live:prepare -- --out qa/live-run-plan.txt",
    "  npm run obs:handoff -- --out qa/obs",
    `  ${report.plan.evidence.proofGateCommand}`,
    `  ${report.plan.evidence.submissionBundleCommand}`
  ].join("\n");
}

async function checkFinalQaReport(reportPath: string, currentCommit: string | null): Promise<FinalReadinessCheck> {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      status?: string;
      repo?: {
        commit?: string | null;
        trackedFilesClean?: boolean;
      };
    };

    if (report.status !== "passed") {
      return {
        name: "Final QA report",
        state: "setup",
        detail: `${reportPath} status is ${report.status ?? "unknown"}; run npm run qa:final and resolve failures.`
      };
    }

    if (currentCommit && report.repo?.commit !== currentCommit) {
      return {
        name: "Final QA report",
        state: "setup",
        detail: `${reportPath} was generated for commit ${report.repo?.commit ?? "unknown"}, but current commit is ${currentCommit}.`
      };
    }

    if (report.repo?.trackedFilesClean !== true) {
      return {
        name: "Final QA report",
        state: "setup",
        detail: `${reportPath} was generated with dirty tracked files.`
      };
    }

    return {
      name: "Final QA report",
      state: "ready",
      detail: `${reportPath} passed for commit ${report.repo.commit}.`
    };
  } catch {
    return {
      name: "Final QA report",
      state: "setup",
      detail: `${reportPath} is missing or unreadable; run npm run qa:final.`
    };
  }
}

async function checkLiveRunPlan(
  runSheetPath: string,
  currentCommit: string | null,
  currentObsAllSourcesUrl: string,
  currentProofGateCommand: string
): Promise<LiveRunPlanReadinessCheck> {
  try {
    const content = await readFile(runSheetPath, "utf8");
    const commit = content.match(/^commit:\s*(\S+)/m)?.[1] ?? null;
    const expectedObsAllSourcesUrl = content.match(/^\s*OBS all sources:\s*(\S+)/m)?.[1];
    const expectedProofGateCommand = content.match(/^\s*live proof gate:\s*(.+)$/m)?.[1];

    if (content.includes("--allow-partial") || content.includes("Platform requirement: at least one live connector")) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} was generated in partial mode; rerun live:prepare without --allow-partial.`
      };
    }

    if (!commit || commit === "unknown") {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} is missing commit metadata.`
      };
    }

    if (currentCommit && commit !== currentCommit) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} was generated for commit ${commit}, but current commit is ${currentCommit}.`
      };
    }

    if (!expectedObsAllSourcesUrl) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} is missing the OBS all-source URL; rerun live:prepare -- --out qa/live-run-plan.txt.`
      };
    }

    if (expectedObsAllSourcesUrl !== currentObsAllSourcesUrl) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} expects ${expectedObsAllSourcesUrl}, but current live:ready options expect ${currentObsAllSourcesUrl}.`,
        expectedObsAllSourcesUrl
      };
    }

    if (!expectedProofGateCommand) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} is missing the live proof gate command; rerun live:prepare -- --out qa/live-run-plan.txt.`,
        expectedObsAllSourcesUrl
      };
    }

    if (expectedProofGateCommand !== currentProofGateCommand) {
      return {
        name: "Final live run sheet",
        state: "setup",
        detail: `${runSheetPath} proof gate command does not match current live:ready thresholds.`,
        expectedObsAllSourcesUrl
      };
    }

    return {
      name: "Final live run sheet",
      state: "ready",
      detail: `${runSheetPath} is strict and current.`,
      expectedObsAllSourcesUrl
    };
  } catch {
    return {
      name: "Final live run sheet",
      state: "setup",
      detail: `${runSheetPath} is missing; run npm run live:prepare -- --out qa/live-run-plan.txt.`
    };
  }
}

async function checkObsHandoff(
  obsHandoffDir: string,
  expectedObsAllSourcesUrl: string | undefined,
  currentCommit: string | null
): Promise<FinalReadinessCheck> {
  const markdownPath = path.join(obsHandoffDir, "obs-browser-sources.md");
  const jsonPath = path.join(obsHandoffDir, "obs-browser-sources.json");

  try {
    const [markdown, jsonContent] = await Promise.all([readFile(markdownPath, "utf8"), readFile(jsonPath, "utf8")]);
    const handoff = JSON.parse(jsonContent) as {
      browserSourceSettings?: {
        width?: number;
        height?: number;
        fps?: number;
        customCss?: string;
      };
      repo?: {
        commit?: string | null;
      };
      sources?: Array<{ name?: string; url?: string }>;
    };
    const settings = handoff.browserSourceSettings;
    const allSource = handoff.sources?.find((source) => source.name === "Unified Chat - All Sources");
    const hasAllSource = Boolean(allSource?.url?.includes("obs=1"));
    const settingsReady =
      settings?.width === 1280 &&
      settings.height === 720 &&
      settings.fps === 30 &&
      settings.customCss?.includes("rgba(0, 0, 0, 0)");

    if (!markdown.includes("OBS Browser Source Handoff") || !Array.isArray(handoff.sources) || handoff.sources.length < 3 || !hasAllSource || !settingsReady) {
      return {
        name: "OBS handoff",
        state: "setup",
        detail: `${obsHandoffDir} is malformed; run npm run obs:handoff -- --out qa/obs.`
      };
    }

    if (expectedObsAllSourcesUrl && allSource?.url !== expectedObsAllSourcesUrl) {
      return {
        name: "OBS handoff",
        state: "setup",
        detail: `${obsHandoffDir} uses ${allSource?.url ?? "unknown OBS URL"}, but the run sheet expects ${expectedObsAllSourcesUrl}.`
      };
    }

    if (currentCommit && handoff.repo?.commit !== currentCommit) {
      return {
        name: "OBS handoff",
        state: "setup",
        detail: `${obsHandoffDir} was generated for commit ${handoff.repo?.commit ?? "unknown"}, but current commit is ${currentCommit}.`
      };
    }

    return {
      name: "OBS handoff",
      state: "ready",
      detail: `${obsHandoffDir} has ${handoff.sources.length} browser source presets.`
    };
  } catch {
    return {
      name: "OBS handoff",
      state: "setup",
      detail: `${obsHandoffDir} is missing or unreadable; run npm run obs:handoff -- --out qa/obs.`
    };
  }
}

function collectRepoMetadata() {
  return {
    commit: runGit(["rev-parse", "--short", "HEAD"])
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

function parseFinalReadinessCliArgs(args: string[]): FinalReadinessOptions {
  const parsed: FinalReadinessOptions = parseLiveRunCliArgs(args);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--qa-dir") {
      parsed.qaDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--obs-handoff-dir") {
      parsed.obsHandoffDir = args[index + 1];
      index += 1;
      continue;
    }
  }

  return parsed;
}

async function runCli() {
  loadLocalEnv();

  const report = await buildFinalReadinessReport(process.env, parseFinalReadinessCliArgs(process.argv.slice(2)));

  console.log(formatFinalReadinessReport(report));

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
