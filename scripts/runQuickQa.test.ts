import { describe, expect, it } from "vitest";
import { formatQuickQaReportMarkdown, quickQaSteps } from "./runQuickQa";

describe("quick QA report", () => {
  it("documents the non-visual QA steps", () => {
    expect(quickQaSteps.map((step) => step.name)).toEqual([
      "Repository hygiene",
      "Unit and integration tests",
      "Lint",
      "Production build",
      "Connector rehearsal",
      "Live stack rehearsal"
    ]);
  });

  it("formats a compact markdown summary", () => {
    const markdown = formatQuickQaReportMarkdown({
      status: "passed",
      generatedAt: "2026-06-08T15:00:00.000Z",
      durationMs: 1200,
      reportFiles: {
        markdown: "qa/quick-report.md",
        json: "qa/quick-report.json"
      },
      steps: [
        {
          name: "Lint",
          command: "npm run lint",
          startedAt: "2026-06-08T15:00:00.000Z",
          endedAt: "2026-06-08T15:00:01.000Z",
          durationMs: 1000,
          status: "passed",
          exitCode: 0
        }
      ]
    });

    expect(markdown).toContain("# Quick QA Report");
    expect(markdown).toContain("Status: passed");
    expect(markdown).toContain("| Lint | `npm run lint` | passed | 1.00s |");
  });
});
