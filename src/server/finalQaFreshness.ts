import { execFileSync } from "node:child_process";
import process from "node:process";
import { scanTrackedFiles } from "../../scripts/checkRepoHygiene";

export type FinalQaFreshness =
  | {
      state: "current";
      changedFiles: [];
    }
  | {
      state: "unchanged";
      changedFiles: string[];
    }
  | {
      state: "stale";
      changedFiles: string[];
    }
  | {
      state: "unknown";
      changedFiles: [];
    };

export type RepoHygieneSnapshot =
  | {
      ok: true;
      issues: [];
    }
  | {
      ok: false;
      issues: string[];
    };

type RunGit = (args: string[]) => string | null;
type ScanRepoHygiene = () => Array<{ filePath: string; lineNumber: number; message: string }>;
export type ReadCurrentTrackedChanges = () => string[];

const finalQaRelevantMatchers: Array<(filePath: string) => boolean> = [
  (filePath) => filePath === "index.html",
  (filePath) => filePath === "package.json",
  (filePath) => filePath === "package-lock.json",
  (filePath) => filePath === "vite.config.ts",
  (filePath) => filePath === "eslint.config.js",
  (filePath) => filePath === "playwright.config.ts",
  (filePath) => filePath === "tsconfig.json",
  (filePath) => filePath === "tsconfig.app.json",
  (filePath) => filePath === "tsconfig.node.json",
  (filePath) => filePath.startsWith("src/"),
  (filePath) => filePath.startsWith("scripts/"),
  (filePath) => filePath.startsWith("e2e/")
];

export function checkFinalQaFreshness(
  artifactCommit: string | null | undefined,
  currentCommit: string | null | undefined,
  runGit: RunGit = defaultRunGit
): FinalQaFreshness {
  if (!artifactCommit || !currentCommit || artifactCommit === "unknown" || currentCommit === "unknown") {
    return {
      state: "unknown",
      changedFiles: []
    };
  }

  if (artifactCommit === currentCommit) {
    return {
      state: "current",
      changedFiles: []
    };
  }

  const changedFiles = runGit(["diff", "--name-only", `${artifactCommit}..${currentCommit}`]);

  if (changedFiles === null) {
    return {
      state: "unknown",
      changedFiles: []
    };
  }

  const finalQaChanges = changedFiles
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .filter(isFinalQaRelevantFile);

  return finalQaChanges.length > 0
    ? {
        state: "stale",
        changedFiles: finalQaChanges
      }
    : {
        state: "unchanged",
        changedFiles: []
      };
}

export function checkCurrentRepoHygiene(scanRepoHygiene: ScanRepoHygiene = scanTrackedFiles): RepoHygieneSnapshot {
  const findings = scanRepoHygiene();

  if (findings.length === 0) {
    return {
      ok: true,
      issues: []
    };
  }

  return {
    ok: false,
    issues: findings.slice(0, 3).map((finding) => `${finding.filePath}:${finding.lineNumber} ${finding.message}`)
  };
}

export function readCurrentTrackedChanges(runGit: RunGit = defaultRunGit) {
  const status = runGit(["status", "--short", "--untracked-files=no"]);

  return status === null
    ? ["unknown"]
    : status
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function isFinalQaRelevantFile(filePath: string) {
  return finalQaRelevantMatchers.some((matches) => matches(filePath));
}

function defaultRunGit(args: string[]) {
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
