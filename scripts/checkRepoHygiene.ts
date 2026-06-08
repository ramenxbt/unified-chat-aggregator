import { execFileSync } from "node:child_process";
import process from "node:process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Finding = {
  filePath: string;
  lineNumber: number;
  message: string;
};

const skippedPaths = [/^package-lock\.json$/, /^qa\//, /^dist\//, /^test-results\//, /^playwright-report\//];
const forbiddenAttribution = [
  ["Co", "dex"].join(""),
  ["co", "dex"].join(""),
  ["Clau", "de"].join(""),
  ["clau", "de"].join("")
];
const secretKeys = [
  "TWITCH_ACCESS_TOKEN",
  "TWITCH_CLIENT_SECRET",
  "KICK_ACCESS_TOKEN",
  "KICK_CLIENT_SECRET",
  "X_BEARER_TOKEN",
  "KICK_WEBHOOK_PUBLIC_KEY"
];
const fixtureValues = new Set([
  "",
  "access-token",
  "file-client",
  "kick-token",
  "token-value",
  "tw-client",
  "tw-token",
  "x-token",
  "your-token-here"
]);
const placeholderPattern = /^(changeme|example|placeholder|test|mock|fake|local|configured|not-configured)$/i;

export function runRepoHygiene() {
  const findings = scanTrackedFiles();

  if (findings.length > 0) {
    console.error("Repository hygiene check failed:");
    for (const finding of findings) {
      console.error(`  ${finding.filePath}:${finding.lineNumber} ${finding.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Repository hygiene check passed");
  }

  return findings;
}

export function scanTrackedFiles() {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((filePath) => !skippedPaths.some((pattern) => pattern.test(filePath)));
  const results: Finding[] = [];

  for (const filePath of files) {
    results.push(...scanContent(filePath, readFileSync(filePath, "utf8")));
  }

  return results;
}

export function scanContent(filePath: string, content: string) {
  const results: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    results.push(...findAttributionIssues(filePath, lineIndex + 1, line));
    results.push(...findSecretIssues(filePath, lineIndex + 1, line));
  }

  return results;
}

function findAttributionIssues(filePath: string, lineNumber: number, line: string): Finding[] {
  return forbiddenAttribution
    .filter((term) => line.includes(term))
    .map((term) => ({
      filePath,
      lineNumber,
      message: `forbidden attribution term present: ${term}`
    }));
}

function findSecretIssues(filePath: string, lineNumber: number, line: string): Finding[] {
  const results: Finding[] = [];

  for (const key of secretKeys) {
    const value = extractAssignedValue(line, key);

    if (value === null || isAllowedFixtureValue(value)) {
      continue;
    }

    results.push({
      filePath,
      lineNumber,
      message: `possible committed secret for ${key}`
    });
  }

  return results;
}

function extractAssignedValue(line: string, key: string) {
  const assignmentMatch = line.match(new RegExp(`\\b${key}\\s*=\\s*([^\\s#]+)`));
  const objectMatch = line.match(new RegExp(`\\b${key}\\s*:\\s*["']([^"']*)["']`));
  const value = assignmentMatch?.[1] ?? objectMatch?.[1];

  if (value === undefined) {
    return null;
  }

  return value.replace(/^["']|["',]+$/g, "").trim();
}

function isAllowedFixtureValue(value: string) {
  return fixtureValues.has(value) || placeholderPattern.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRepoHygiene();
}
