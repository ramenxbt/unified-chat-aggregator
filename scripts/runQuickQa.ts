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

type QuickQaReport = {
  status: "passed" | "failed";
  generatedAt: string;
  durationMs: number;
  reportFiles: {
    markdown: string;
    json: string;
  };
  steps: QaStepResult[];
};

export const quickQaSteps: QaStep[] = [
  { name: "Repository hygiene", args: ["run", "qa:repo"] },
  { name: "Unit and integration tests", args: ["test"] },
  { name: "Lint", args: ["run", "lint"] },
  { name: "Production build", args: ["run", "build"] },
  { name: "Connector rehearsal", args: ["run", "qa:connectors"] },
  { name: "Live stack rehearsal", args: ["run", "qa:rehearsal"] }
];

const reportDir = path.resolve("qa");
const markdownReportPath = path.join(reportDir, "quick-report.md");
const jsonReportPath = path.join(reportDir, "quick-report.json");

export function runQuickQa() {
  const runStartedAt = Date.now();
  const stepResults: QaStepResult[] = [];

  for (const [index, step] of quickQaSteps.entries()) {
    console.log(`\n[${index + 1}/${quickQaSteps.length}] ${step.name}`);

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
      console.error(`Quick QA failed during ${step.name}: ${result.error.message}`);
      break;
    }

    if (result.status !== 0) {
      console.error(`Quick QA failed during ${step.name}.`);
      break;
    }
  }

  const failedStep = stepResults.find((step) => step.status === "failed");
  const report: QuickQaReport = {
    status: failedStep ? "failed" : "passed",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - runStartedAt,
    reportFiles: {
      markdown: path.relative(process.cwd(), markdownReportPath),
      json: path.relative(process.cwd(), jsonReportPath)
    },
    steps: stepResults
  };

  writeQuickQaReport(report);

  if (report.status === "passed") {
    console.log("\nQuick QA passed");
  }

  console.log(`Quick QA report: ${report.reportFiles.markdown}`);
  process.exitCode = report.status === "passed" ? 0 : failedStep?.exitCode ?? 1;

  return report;
}

export function formatQuickQaReportMarkdown(report: QuickQaReport) {
  const lines = [
    "# Quick QA Report",
    "",
    `Status: ${report.status}`,
    `Generated: ${report.generatedAt}`,
    `Duration: ${formatDuration(report.durationMs)}`,
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

function writeQuickQaReport(report: QuickQaReport) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownReportPath, formatQuickQaReportMarkdown(report), "utf8");
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runQuickQa();
}
