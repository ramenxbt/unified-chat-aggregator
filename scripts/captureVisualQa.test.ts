import { describe, expect, it } from "vitest";
import { formatVisualQaManifestMarkdown } from "./captureVisualQa";

describe("visual QA manifest", () => {
  it("formats screenshot metadata for final evidence review", () => {
    const markdown = formatVisualQaManifestMarkdown({
      generatedAt: "2026-06-08T00:00:00.000Z",
      baseUrl: "http://127.0.0.1:5174",
      repo: {
        commit: "abc1234",
        branch: "main"
      },
      captures: [
        {
          file: "qa/visual/desktop-dashboard.png",
          route: "/",
          url: "http://127.0.0.1:5174/",
          viewport: {
            width: 1440,
            height: 900
          },
          fullPage: false,
          bytes: 153_600
        }
      ]
    });

    expect(markdown).toContain("# Visual QA Manifest");
    expect(markdown).toContain("Commit: abc1234");
    expect(markdown).toContain("`qa/visual/desktop-dashboard.png`");
    expect(markdown).toContain("1440x900");
    expect(markdown).toContain("150.0 KB");
  });
});
