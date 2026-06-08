import { describe, expect, it } from "vitest";
import { parseLiveRunCliArgs, parseLiveStackCliArgs } from "./liveCliArgs";

describe("live CLI args", () => {
  it("parses live run plan overrides", () => {
    expect(
      parseLiveRunCliArgs([
        "--allow-partial",
        "--feed-port",
        "8899",
        "--app-port",
        "5260",
        "--archive-dir",
        "data/final sessions",
        "--db",
        "data/final proof.sqlite"
      ])
    ).toEqual({
      allowPartial: true,
      feedPort: 8899,
      appPort: 5260,
      archiveDir: "data/final sessions",
      databasePath: "data/final proof.sqlite"
    });
  });

  it("parses live stack switches with database-path alias", () => {
    expect(
      parseLiveStackCliArgs([
        "--dry-run",
        "--with-proof-gate",
        "--database-path",
        "data/live.sqlite",
        "--feed-port",
        "8789"
      ])
    ).toEqual({
      allowPartial: false,
      dryRun: true,
      withProofGate: true,
      databasePath: "data/live.sqlite",
      feedPort: 8789
    });
  });
});
