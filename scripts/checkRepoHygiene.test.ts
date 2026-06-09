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
    const secretKey = ["X", "BEARER", "TOKEN"].join("_");
    const findings = scanContent("src/config.ts", `export const env = { ${secretKey}: 'live-secret-value' };\n`);

    expect(findings).toContainEqual({
      filePath: "src/config.ts",
      lineNumber: 1,
      message: `possible committed secret for ${secretKey}`
    });
  });

  it("allows documented placeholders and local rehearsal token values", () => {
    const twitchKey = ["TWITCH", "ACCESS", "TOKEN"].join("_");
    const kickKey = ["KICK", "ACCESS", "TOKEN"].join("_");
    const xKey = ["X", "BEARER", "TOKEN"].join("_");
    const findings = scanContent(
      ".env.example",
      [`${twitchKey}=`, `${kickKey}=kick-token`, `${xKey}=placeholder`].join("\n")
    );

    expect(findings).toEqual([]);
  });

  it("allows deterministic live-readiness fixture token values", () => {
    const twitchKey = ["TWITCH", "ACCESS", "TOKEN"].join("_");
    const kickKey = ["KICK", "ACCESS", "TOKEN"].join("_");
    const xKey = ["X", "BEARER", "TOKEN"].join("_");
    const findings = scanContent(
      "src/server/livePreflight.test.ts",
      [
        `${twitchKey}: "twitch-access-live-123",`,
        `${kickKey}: "kick-access-live-123",`,
        `${xKey}: "x-bearer-live-123"`
      ].join("\n")
    );

    expect(findings).toEqual([]);
  });

  it("does not treat expected checklist output as a committed secret", () => {
    const twitchKey = ["TWITCH", "ACCESS", "TOKEN"].join("_");
    const kickKey = ["KICK", "ACCESS", "TOKEN"].join("_");
    const xKey = ["X", "BEARER", "TOKEN"].join("_");
    const findings = scanContent(
      "src/server/livePreflight.test.ts",
      [
        `expect(formatted).toContain("${twitchKey}=");`,
        `expect(formatted).toContain("${kickKey}=");`,
        `expect(formatted).toContain("${xKey}=");`
      ].join("\n")
    );

    expect(findings).toEqual([]);
  });
});
