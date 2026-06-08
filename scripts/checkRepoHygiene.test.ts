import { describe, expect, it } from "vitest";
import { scanContent } from "./checkRepoHygiene";

describe("repository hygiene", () => {
  it("flags forbidden attribution terms without storing the term literally", () => {
    const forbiddenTerm = ["Co", "dex"].join("");
    const findings = scanContent("README.md", `Built with ${forbiddenTerm}\n`);

    expect(findings).toContainEqual({
      filePath: "README.md",
      lineNumber: 1,
      message: `forbidden attribution term present: ${forbiddenTerm}`
    });
  });

  it("flags committed live-looking platform secrets", () => {
    const findings = scanContent("src/config.ts", "export const env = { X_BEARER_TOKEN: 'live-secret-value' };\n");

    expect(findings).toContainEqual({
      filePath: "src/config.ts",
      lineNumber: 1,
      message: "possible committed secret for X_BEARER_TOKEN"
    });
  });

  it("allows documented placeholders and local rehearsal token values", () => {
    const findings = scanContent(
      ".env.example",
      ["TWITCH_ACCESS_TOKEN=", "KICK_ACCESS_TOKEN=kick-token", "X_BEARER_TOKEN=placeholder"].join("\n")
    );

    expect(findings).toEqual([]);
  });
});
