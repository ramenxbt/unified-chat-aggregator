import { describe, expect, it } from "vitest";
import { parseLivePrepareCliArgs, parseLiveRunCliArgs, parseLiveStackCliArgs } from "./liveCliArgs";

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
        "data/final proof.sqlite",
        "--qa-dir",
        "qa/final",
        "--evidence-check",
        "qa/final evidence.txt",
        "--kick-tunnel-check",
        "qa/final kick tunnel.txt",
        "--proof-timeout-ms",
        "300000",
        "--proof-interval-ms",
        "2000"
      ])
    ).toEqual({
      allowPartial: true,
      feedPort: 8899,
      appPort: 5260,
      archiveDir: "data/final sessions",
      databasePath: "data/final proof.sqlite",
      qaDir: "qa/final",
      evidenceCheckPath: "qa/final evidence.txt",
      kickTunnelCheckPath: "qa/final kick tunnel.txt",
      proofTimeoutMs: 300000,
      proofIntervalMs: 2000
    });
  });

  it("parses live stack switches with database-path alias", () => {
    expect(
      parseLiveStackCliArgs([
        "--dry-run",
        "--with-proof-gate",
        "--require-ready",
        "--qa-dir",
        "qa/final",
        "--obs-handoff-dir",
        "qa/final-obs",
        "--database-path",
        "data/live.sqlite",
        "--feed-port",
        "8789"
      ])
    ).toEqual({
      allowPartial: false,
      dryRun: true,
      requireReady: true,
      withProofGate: true,
      qaDir: "qa/final",
      obsHandoffDir: "qa/final-obs",
      databasePath: "data/live.sqlite",
      feedPort: 8789
    });
  });

  it("parses live prepare output path aliases", () => {
    expect(parseLivePrepareCliArgs(["--allow-partial", "--out", "qa/live-run-plan.txt"])).toEqual({
      allowPartial: true,
      outPath: "qa/live-run-plan.txt"
    });

    expect(parseLivePrepareCliArgs(["--output", "qa/plan.txt"])).toEqual({
      allowPartial: false,
      outPath: "qa/plan.txt"
    });
  });

  it("ignores invalid numeric overrides", () => {
    expect(
      parseLiveRunCliArgs([
        "--feed-port",
        "nope",
        "--app-port",
        "0",
        "--proof-timeout-ms",
        "-1",
        "--proof-interval-ms",
        "NaN"
      ])
    ).toEqual({
      allowPartial: false
    });
  });
});
