import { describe, expect, it } from "vitest";
import { formatUiHandoff } from "./createUiHandoff";

describe("UI handoff", () => {
  it("formats a complete UI polish contract with tests and blockers", () => {
    const markdown = formatUiHandoff({
      generatedAt: "2026-06-09T15:00:00.000Z",
      repo: {
        commit: "abc1234",
        branch: "main",
        remote: "https://github.com/ramenxbt/unified-chat-aggregator.git",
        trackedFilesClean: true,
        trackedChanges: []
      },
      sourceContractPath: "docs/final-ui-handoff.md",
      contract: "# Final UI Handoff\n\nKeep source labels visible."
    });

    expect(markdown).toContain("# UI Enhancement Handoff");
    expect(markdown).toContain("Commit: abc1234");
    expect(markdown).toContain("Tracked files clean: yes");
    expect(markdown).toContain("Do not add attribution text or tool credits");
    expect(markdown).toContain("npm run test:e2e");
    expect(markdown).toContain("npm run qa:visual");
    expect(markdown).toContain("KICK_WEBHOOK_PUBLIC_URL");
    expect(markdown).toContain("## Source Contract: docs/final-ui-handoff.md");
    expect(markdown).toContain("Keep source labels visible.");
  });

  it("includes dirty tracked files when present", () => {
    const markdown = formatUiHandoff({
      generatedAt: "2026-06-09T15:00:00.000Z",
      repo: {
        commit: "abc1234",
        branch: "main",
        remote: "https://github.com/ramenxbt/unified-chat-aggregator.git",
        trackedFilesClean: false,
        trackedChanges: ["M src/App.tsx"]
      },
      sourceContractPath: "docs/final-ui-handoff.md",
      contract: "# Final UI Handoff"
    });

    expect(markdown).toContain("Tracked files clean: no");
    expect(markdown).toContain("- M src/App.tsx");
  });
});
