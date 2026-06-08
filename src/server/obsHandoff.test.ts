import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLiveRunPlan } from "./liveRunPlan";
import { buildObsHandoff, createObsHandoff, formatObsHandoffMarkdown } from "./obsHandoff";
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

describe("OBS handoff", () => {
  it("builds browser source settings and focused source URLs from the live run plan", () => {
    const plan = buildLiveRunPlan(completeEnv, {
      appPort: 5260,
      feedPort: 8899
    });
    const handoff = buildObsHandoff(plan, "2026-06-08T00:00:00.000Z");
    const markdown = formatObsHandoffMarkdown(handoff);

    expect(handoff.browserSourceSettings).toMatchObject({
      width: 1280,
      height: 720,
      fps: 30,
      background: "transparent"
    });
    expect(handoff.repo.commit).toBe(currentCommit());
    expect(handoff.sources.map((source) => source.name)).toEqual([
      "Unified Chat - All Sources",
      "Unified Chat - Twitch + Kick",
      "Unified Chat - Signals",
      "Unified Chat - Twitch Ansem Focus",
      "Unified Chat - Kick Ansem Focus",
      "Unified Chat - X Market Bubble Focus"
    ]);
    expect(handoff.sources[0].url).toBe("http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14");
    expect(handoff.sources[3].url).toBe("http://127.0.0.1:5260/?obs=1&sources=twitch&limit=8&q=ansem");
    expect(markdown).toContain("# OBS Browser Source Handoff");
    expect(markdown).toContain(`Commit: ${currentCommit()}`);
    expect(markdown).toContain("Unified Chat - All Sources");
    expect(markdown).toContain("Confirm account-qualified labels are visible");
  });

  it("writes Markdown and JSON handoff files", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "obs-handoff-"));
    const result = await createObsHandoff(completeEnv, ["--app-port", "5260", "--out", outDir]);
    const markdown = await readFile(result.files.markdown, "utf8");
    const json = JSON.parse(await readFile(result.files.json, "utf8"));

    expect(markdown).toContain("OBS Browser Source Handoff");
    expect(json.sources).toHaveLength(6);
    expect(json.sources[0]).toMatchObject({
      name: "Unified Chat - All Sources",
      url: "http://127.0.0.1:5260/?obs=1&sources=twitch,kick,x&limit=14"
    });
    expect(json.repo.commit).toBe(currentCommit());
  });
});

function currentCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}
