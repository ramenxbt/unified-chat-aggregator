import { describe, expect, it } from "vitest";
import { formatFinalQaReportMarkdown } from "./runFinalQa";

describe("final QA report", () => {
  it("formats a submission-ready markdown summary", () => {
    const markdown = formatFinalQaReportMarkdown({
      status: "passed",
      generatedAt: "2026-06-08T14:00:00.000Z",
      durationMs: 1200,
      repo: {
        commit: "abc1234",
        branch: "main",
        remote: "https://github.com/ramenxbt/unified-chat-aggregator.git",
        trackedFilesClean: true,
        trackedChanges: []
      },
      reportFiles: {
        markdown: "qa/final-report.md",
        json: "qa/final-report.json"
      },
      steps: [
        {
          name: "Repository hygiene",
          command: "npm run qa:repo",
          startedAt: "2026-06-08T14:00:00.000Z",
          endedAt: "2026-06-08T14:00:01.000Z",
          durationMs: 1000,
          status: "passed",
          exitCode: 0
        }
      ]
    });

    expect(markdown).toContain("# Final QA Report");
    expect(markdown).toContain("Status: passed");
    expect(markdown).toContain("Commit: abc1234");
    expect(markdown).toContain("Tracked files clean: yes");
    expect(markdown).toContain("| Repository hygiene | `npm run qa:repo` | passed | 1.00s |");
  });
});
