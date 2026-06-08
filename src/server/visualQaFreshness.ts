import { execFileSync } from "node:child_process";
import process from "node:process";

export type VisualQaFreshness =
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

type RunGit = (args: string[]) => string | null;

const visualQaRelevantMatchers: Array<(filePath: string) => boolean> = [
  (filePath) => filePath === "index.html",
  (filePath) => filePath === "package.json",
  (filePath) => filePath === "package-lock.json",
  (filePath) => filePath === "vite.config.ts",
  (filePath) => filePath === "src/App.tsx",
  (filePath) => filePath === "src/main.tsx",
  (filePath) => filePath === "src/styles.css",
  (filePath) => filePath.startsWith("src/hooks/"),
  (filePath) => filePath.startsWith("src/fixtures/"),
  (filePath) => filePath === "src/domain/unifiedEvent.ts",
  (filePath) => filePath === "src/domain/obsPresets.ts",
  (filePath) => filePath === "src/live/protocol.ts",
  (filePath) => filePath === "scripts/captureVisualQa.ts",
  (filePath) => filePath === "scripts/captureVisualQa.test.ts"
];

export function checkVisualQaFreshness(
  artifactCommit: string | null | undefined,
  currentCommit: string | null | undefined,
  runGit: RunGit = defaultRunGit
): VisualQaFreshness {
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

  const visualChanges = changedFiles
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .filter(isVisualQaRelevantFile);

  return visualChanges.length > 0
    ? {
        state: "stale",
        changedFiles: visualChanges
      }
    : {
        state: "unchanged",
        changedFiles: []
      };
}

export function isVisualQaRelevantFile(filePath: string) {
  return visualQaRelevantMatchers.some((matches) => matches(filePath));
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
