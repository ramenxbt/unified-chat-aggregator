import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type RepoSnapshot = {
  commit: string;
  branch: string;
  remote: string;
  trackedFilesClean: boolean;
  trackedChanges: string[];
};

const defaultOutPath = "qa/ui-handoff.md";
const sourceContractPath = "docs/final-ui-handoff.md";

export function createUiHandoff(args = process.argv.slice(2)) {
  const outPath = parseOutPath(args);
  const repo = collectRepoSnapshot();
  const contract = readFileSync(sourceContractPath, "utf8").trimEnd();
  const output = formatUiHandoff({
    generatedAt: new Date().toISOString(),
    repo,
    sourceContractPath,
    contract
  });

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${output}\n`, "utf8");
  console.log(`UI handoff written: ${outPath}`);

  return {
    outPath,
    output
  };
}

export function formatUiHandoff({
  generatedAt,
  repo,
  sourceContractPath,
  contract
}: {
  generatedAt: string;
  repo: RepoSnapshot;
  sourceContractPath: string;
  contract: string;
}) {
  const lines = [
    "# UI Enhancement Handoff",
    "",
    `Generated: ${generatedAt}`,
    `Commit: ${repo.commit}`,
    `Branch: ${repo.branch}`,
    `Remote: ${repo.remote}`,
    `Tracked files clean: ${repo.trackedFilesClean ? "yes" : "no"}`,
    "",
    "## Operating Rules",
    "",
    "- Preserve the real-time chat aggregation behavior and connector contracts.",
    "- Keep Twitch, Kick, and X source labels account-qualified and visible in every feed state.",
    "- Do not alter live credential handling, server archive behavior, OBS routes, or final artifact gates.",
    "- Do not add attribution text or tool credits anywhere in the app, docs, commits, or generated artifacts.",
    "- Keep UI changes scoped to dashboard components, styling, visual state, and interaction polish.",
    "- After UI changes, run the required gates below and fix failures before handoff.",
    "",
    "## Primary Files",
    "",
    "- `src/App.tsx`",
    "- `src/styles.css`",
    "- `src/domain/obsPresets.ts`",
    "- `src/fixtures/fixtureEvents.ts`",
    "- `scripts/captureVisualQa.ts`",
    "- `docs/final-ui-handoff.md`",
    "",
    "## Required Test Run",
    "",
    "Run all commands after the polish pass:",
    "",
    "```bash",
    "npm test",
    "npm run test:e2e",
    "npm run qa:visual",
    "npm run qa:rehearsal",
    "npm run qa:stress",
    "npm run lint",
    "npm run build",
    "npm audit --audit-level=moderate",
    "```",
    "",
    "For a fast pre-check before the full run:",
    "",
    "```bash",
    "npm run qa:quick",
    "```",
    "",
    "## Visual Proof To Inspect",
    "",
    "- `qa/visual/desktop-dashboard.png`",
    "- `qa/visual/mobile-dashboard.png`",
    "- `qa/visual/obs-overlay.png`",
    "- `qa/visual/manifest.md`",
    "",
    "## Current Tracked Changes",
    "",
    repo.trackedChanges.length > 0 ? repo.trackedChanges.map((change) => `- ${change}`).join("\n") : "- none",
    "",
    "## Live-Only Blockers",
    "",
    "These are not UI blockers, but final live proof still needs real external setup:",
    "",
    "- `TWITCH_CLIENT_ID`",
    "- `TWITCH_ACCESS_TOKEN`",
    "- `TWITCH_BROADCASTER_USER_ID`",
    "- `TWITCH_BOT_USER_ID`",
    "- `KICK_WEBHOOK_PUBLIC_URL` ending in `/webhooks/kick`",
    "- `X_BEARER_TOKEN`",
    "",
    `## Source Contract: ${sourceContractPath}`,
    "",
    contract
  ];

  return lines.join("\n");
}

function parseOutPath(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out" || arg === "--output") {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) return value;
    }
  }

  return defaultOutPath;
}

function collectRepoSnapshot(): RepoSnapshot {
  const trackedChanges = readTrackedChanges();

  return {
    commit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    remote: readGitValue(["remote", "get-url", "origin"]),
    trackedFilesClean: trackedChanges.length === 0,
    trackedChanges
  };
}

function readTrackedChanges() {
  const output = readGitValue(["status", "--short", "--untracked-files=no"]);

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readGitValue(args: string[]) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createUiHandoff();
}
