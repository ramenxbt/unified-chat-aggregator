import { describe, expect, it } from "vitest";
import { checkCurrentRepoHygiene, checkFinalQaFreshness, isFinalQaRelevantFile, readCurrentTrackedChanges } from "./finalQaFreshness";

describe("final QA freshness", () => {
  it("treats docs-only changes as reusable", () => {
    const freshness = checkFinalQaFreshness("old123", "new456", () => "README.md\ndocs/submission-runbook.md\n");

    expect(freshness).toEqual({
      state: "unchanged",
      changedFiles: []
    });
  });

  it("treats source, test, script, and config changes as stale", () => {
    const freshness = checkFinalQaFreshness(
      "old123",
      "new456",
      () => "README.md\nsrc/App.tsx\nscripts/runFinalQa.ts\nplaywright.config.ts\n"
    );

    expect(freshness).toEqual({
      state: "stale",
      changedFiles: ["src/App.tsx", "scripts/runFinalQa.ts", "playwright.config.ts"]
    });
  });

  it("reports unknown freshness when commit metadata or Git diff is unavailable", () => {
    expect(checkFinalQaFreshness(null, "new456")).toEqual({
      state: "unknown",
      changedFiles: []
    });
    expect(checkFinalQaFreshness("old123", "new456", () => null)).toEqual({
      state: "unknown",
      changedFiles: []
    });
  });

  it("keeps the final QA relevant file list conservative", () => {
    expect(isFinalQaRelevantFile("src/server/finalReadiness.ts")).toBe(true);
    expect(isFinalQaRelevantFile("e2e/app.spec.ts")).toBe(true);
    expect(isFinalQaRelevantFile("package-lock.json")).toBe(true);
    expect(isFinalQaRelevantFile("docs/submission-runbook.md")).toBe(false);
    expect(isFinalQaRelevantFile("README.md")).toBe(false);
  });

  it("summarizes current repo hygiene findings", () => {
    expect(checkCurrentRepoHygiene(() => [])).toEqual({
      ok: true,
      issues: []
    });
    expect(
      checkCurrentRepoHygiene(() => [
        { filePath: "README.md", lineNumber: 12, message: "issue one" },
        { filePath: "src/App.tsx", lineNumber: 24, message: "issue two" }
      ])
    ).toEqual({
      ok: false,
      issues: ["README.md:12 issue one", "src/App.tsx:24 issue two"]
    });
  });

  it("reads tracked working tree changes without untracked files", () => {
    expect(readCurrentTrackedChanges(() => " M src/App.tsx\nA  src/server/new.ts\n")).toEqual(["M src/App.tsx", "A  src/server/new.ts"]);
    expect(readCurrentTrackedChanges(() => "")).toEqual([]);
    expect(readCurrentTrackedChanges(() => null)).toEqual(["unknown"]);
  });
});
