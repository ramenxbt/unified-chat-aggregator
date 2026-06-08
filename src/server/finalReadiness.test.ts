import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalReadinessReport, formatFinalReadinessReport } from "./finalReadiness";
import type { LivePreflightEnv } from "./livePreflight";

const completeEnv: LivePreflightEnv = {
  TWITCH_CLIENT_ID: "tw-client",
  TWITCH_ACCESS_TOKEN: "tw-token",
  TWITCH_BROADCASTER_USER_ID: "1337",
  TWITCH_BOT_USER_ID: "9001",
  TWITCH_BROADCASTER_LOGIN: "marketbubble",
  KICK_WEBHOOK_ENABLED: "true",
  KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick",
  KICK_ACCESS_TOKEN: "kick-token",
  KICK_BROADCASTER_USER_ID: "123456789",
  KICK_BROADCASTER_SLUG: "marketbubble",
  KICK_SUBSCRIBE_ON_START: "true",
  X_BEARER_TOKEN: "x-token",
  X_FILTER_RULES: "from:marketbubble, market bubble",
  X_SPACES_QUERY: "Market Bubble"
};

describe("final recording readiness", () => {
  it("passes when strict connectors and final artifacts are current", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(true);
    expect(formatted).toContain("Final recording readiness: ready");
    expect(formatted).toContain("PASS Strict connector preflight");
    expect(formatted).toContain("PASS Final QA report");
    expect(formatted).toContain("PASS Final live run sheet");
    expect(formatted).toContain("PASS OBS handoff");
    expect(formatted).toContain("npm run proof:gate --");
    expect(formatted).toContain("npm run submission:bundle --");
  });

  it("fails when strict connector credentials are missing", async () => {
    const qaDir = await createReadyQaDir();
    const report = await buildFinalReadinessReport(
      {
        X_BEARER_TOKEN: "x-token",
        X_SPACES_QUERY: "Market Bubble"
      },
      { qaDir }
    );

    expect(report.ok).toBe(false);
    expect(formatFinalReadinessReport(report)).toContain("MISS Strict connector preflight");
  });

  it("fails when the final run sheet is stale", async () => {
    const qaDir = await createReadyQaDir({ runSheetCommit: "stale123" });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });

    expect(report.ok).toBe(false);
    expect(formatFinalReadinessReport(report)).toContain("was generated for commit stale123");
  });

  it("fails when OBS handoff files are missing", async () => {
    const qaDir = await createReadyQaDir({ withObsHandoff: false });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });

    expect(report.ok).toBe(false);
    expect(formatFinalReadinessReport(report)).toContain("MISS OBS handoff");
  });

  it("fails when OBS handoff URLs do not match the final run sheet", async () => {
    const qaDir = await createReadyQaDir({
      obsAllSourcesUrl: "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14"
    });
    const report = await buildFinalReadinessReport(completeEnv, { qaDir });
    const formatted = formatFinalReadinessReport(report);

    expect(report.ok).toBe(false);
    expect(formatted).toContain("MISS OBS handoff");
    expect(formatted).toContain("but the run sheet expects http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14");
  });
});

async function createReadyQaDir({
  obsAllSourcesUrl = "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14",
  runSheetCommit = currentCommit(),
  withObsHandoff = true
}: {
  obsAllSourcesUrl?: string;
  runSheetCommit?: string;
  withObsHandoff?: boolean;
} = {}) {
  const qaDir = await mkdtemp(path.join(os.tmpdir(), "final-readiness-"));

  await writeFile(path.join(qaDir, "final-report.json"), JSON.stringify(createFinalQaReport()), "utf8");
  await writeFile(path.join(qaDir, "live-run-plan.txt"), createLiveRunPlan(runSheetCommit, obsAllSourcesUrl), "utf8");

  if (withObsHandoff) {
    await writeObsHandoff(path.join(qaDir, "obs"));
  }

  return qaDir;
}

function createFinalQaReport() {
  return {
    status: "passed",
    repo: {
      commit: currentCommit(),
      trackedFilesClean: true
    }
  };
}

function createLiveRunPlan(commit: string, obsAllSourcesUrl: string) {
  return [
    "Live run sheet:",
    "generated at: 2026-06-08T00:00:00.000Z",
    `commit: ${commit}`,
    "branch: main",
    "",
    "Live preflight: ready",
    "",
    "Open:",
    `  OBS all sources: ${obsAllSourcesUrl}`
  ].join("\n");
}

async function writeObsHandoff(obsHandoffDir: string) {
  await mkdir(obsHandoffDir, { recursive: true });
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.md"), "# OBS Browser Source Handoff\n", "utf8");
  await writeFile(path.join(obsHandoffDir, "obs-browser-sources.json"), JSON.stringify(createObsHandoffJson()), "utf8");
}

function createObsHandoffJson() {
  return {
    browserSourceSettings: {
      width: 1280,
      height: 720,
      fps: 30,
      customCss: "body { background: rgba(0, 0, 0, 0); overflow: hidden; }"
    },
    sources: [
      {
        name: "Unified Chat - All Sources",
        url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14"
      },
      {
        name: "Unified Chat - Twitch + Kick",
        url: "http://127.0.0.1:5173/?obs=1&sources=twitch,kick&limit=12"
      },
      {
        name: "Unified Chat - Signals",
        url: "http://127.0.0.1:5173/?obs=1&signal=1&limit=10"
      }
    ]
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}
