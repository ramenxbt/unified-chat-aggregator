import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type QaStep = {
  name: string;
  args: string[];
};

type QaStepResult = {
  name: string;
  command: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "passed" | "failed";
  exitCode: number | null;
  error?: string;
};

type FinalQaReport = {
  status: "passed" | "failed";
  generatedAt: string;
  durationMs: number;
  repo: {
    commit: string;
    branch: string;
    remote: string;
    trackedFilesClean: boolean;
    trackedChanges: string[];
  };
  reportFiles: {
    markdown: string;
    json: string;
  };
  steps: QaStepResult[];
};

const finalQaSteps: QaStep[] = [
  { name: "Repository hygiene", args: ["run", "qa:repo"] },
  { name: "Unit and integration tests", args: ["test"] },
  { name: "Lint", args: ["run", "lint"] },
  { name: "Production build", args: ["run", "build"] },
  { name: "Browser workflows", args: ["run", "test:e2e"] },
  { name: "Connector rehearsal", args: ["run", "qa:connectors"] },
  { name: "Live stack rehearsal", args: ["run", "qa:rehearsal"] },
  { name: "Stress rehearsal", args: ["run", "qa:stress"] },
  { name: "Visual QA", args: ["run", "qa:visual"] }
];

const reportDir = path.resolve("qa");
const markdownReportPath = path.join(reportDir, "final-report.md");
const jsonReportPath = path.join(reportDir, "final-report.json");

export function runFinalQa() {
  const runStartedAt = Date.now();
  const stepResults: QaStepResult[] = [];

  for (const [index, step] of finalQaSteps.entries()) {
    console.log(`\n[${index + 1}/${finalQaSteps.length}] ${step.name}`);

    const startedAt = new Date().toISOString();
    const stepStartedAt = Date.now();
    const result = spawnSync("npm", step.args, {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 50 * 1024 * 1024
    });
    const endedAt = new Date().toISOString();

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    const stepResult: QaStepResult = {
      name: step.name,
      command: `npm ${step.args.join(" ")}`,
      startedAt,
      endedAt,
      durationMs: Date.now() - stepStartedAt,
      status: result.error || result.status !== 0 ? "failed" : "passed",
      exitCode: result.status,
      ...(result.error ? { error: result.error.message } : {})
    };
    stepResults.push(stepResult);

    if (result.error) {
      console.error(`Final QA failed during ${step.name}: ${result.error.message}`);
      break;
    }

    if (result.status !== 0) {
      console.error(`Final QA failed during ${step.name}.`);
      break;
    }
  }

  const failedStep = stepResults.find((step) => step.status === "failed");
  const report: FinalQaReport = {
    status: failedStep ? "failed" : "passed",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - runStartedAt,
    repo: readRepoMetadata(),
    reportFiles: {
      markdown: path.relative(process.cwd(), markdownReportPath),
      json: path.relative(process.cwd(), jsonReportPath)
    },
    steps: stepResults
  };

  writeFinalQaReport(report);

  if (report.status === "passed") {
    console.log("\nFinal QA passed");
  }

  console.log(`Final QA report: ${report.reportFiles.markdown}`);
  process.exitCode = report.status === "passed" ? 0 : failedStep?.exitCode ?? 1;

  return report;
}

export function formatFinalQaReportMarkdown(report: FinalQaReport) {
  const lines = [
    "# Final QA Report",
    "",
    `Status: ${report.status}`,
    `Generated: ${report.generatedAt}`,
    `Duration: ${formatDuration(report.durationMs)}`,
    `Commit: ${report.repo.commit}`,
    `Branch: ${report.repo.branch}`,
    `Remote: ${report.repo.remote}`,
    `Tracked files clean: ${report.repo.trackedFilesClean ? "yes" : "no"}`,
    "",
    "## Steps",
    "",
    "| Step | Command | Status | Duration |",
    "| --- | --- | --- | --- |",
    ...report.steps.map(
      (step) => `| ${step.name} | \`${step.command}\` | ${step.status} | ${formatDuration(step.durationMs)} |`
    )
  ];

  const failedSteps = report.steps.filter((step) => step.status === "failed");

  if (failedSteps.length > 0) {
    lines.push("", "## Failures", "", ...failedSteps.map((step) => `- ${step.name}: ${step.error ?? "non-zero exit"}`));
  }

  return `${lines.join("\n")}\n`;
}

function writeFinalQaReport(report: FinalQaReport) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownReportPath, formatFinalQaReportMarkdown(report), "utf8");
}

function readRepoMetadata() {
  const trackedChanges = runGit(["status", "--short", "--untracked-files=no"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]) || "detached",
    remote: runGit(["remote", "get-url", "origin"]) || "unknown",
    trackedFilesClean: trackedChanges.length === 0,
    trackedChanges
  };
}

function runGit(args: string[]) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });

  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFinalQa();
}
