import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareLiveRun } from "./prepareLiveRun";
import type { LivePreflightEnv } from "./livePreflight";

const completeEnv: LivePreflightEnv = {
  TWITCH_CLIENT_ID: "tw-client",
  TWITCH_ACCESS_TOKEN: "tw-token",
  TWITCH_BROADCASTER_USER_ID: "1337",
  TWITCH_BOT_USER_ID: "9001",
  TWITCH_BROADCASTER_LOGIN: "marketbubble",
  KICK_WEBHOOK_ENABLED: "true",
  KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick",
  KICK_ACCESS_TOKEN: "kick-token",
  KICK_BROADCASTER_USER_ID: "123456789",
  KICK_BROADCASTER_SLUG: "marketbubble",
  KICK_SUBSCRIBE_ON_START: "true",
  X_BEARER_TOKEN: "x-token",
  X_FILTER_RULES: "from:marketbubble, market bubble",
  X_SPACES_QUERY: "Market Bubble"
};

describe("prepare live run", () => {
  it("writes the final run sheet when an output path is provided", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "prepare-live-run-"));
    const outPath = path.join(baseDir, "nested", "live-run-plan.txt");
    const result = await prepareLiveRun(completeEnv, [
      "--out",
      outPath,
      "--archive-dir",
      "data/final sessions",
      "--db",
      "data/final.sqlite",
      "--clips",
      "exports/final clips.json"
    ]);
    const savedPlan = await readFile(outPath, "utf8");

    expect(result.plan.ok).toBe(true);
    expect(result.outPath).toBe(outPath);
    expect(savedPlan).toContain("Live run sheet:");
    expect(savedPlan).toMatch(/^generated at: \d{4}-\d{2}-\d{2}T/m);
    expect(savedPlan).toMatch(/^commit: \S+/m);
    expect(savedPlan).toMatch(/^branch: \S+/m);
    expect(savedPlan).toContain("Live preflight: ready");
    expect(savedPlan).toContain("Target source labels:");
    expect(savedPlan).toContain("KICK (MARKETBUBBLE)");
    expect(savedPlan).toContain("TWITCH (MARKETBUBBLE)");
    expect(savedPlan).toContain("X (@MARKETBUBBLE)");
    expect(savedPlan).toContain("OBS all sources: http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14");
    expect(savedPlan).toContain(
      "submission bundle: npm run submission:bundle -- --archive-dir 'data/final sessions' --db data/final.sqlite --out submission-bundle --clips 'exports/final clips.json'"
    );
  });
});
