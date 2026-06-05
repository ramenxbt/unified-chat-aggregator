import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnv } from "./loadLocalEnv";

describe("loadLocalEnv", () => {
  it("loads .env values without overriding exported env", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "local-env-"));
    const envPath = path.join(baseDir, ".env");
    const target = {
      TWITCH_CLIENT_ID: "exported-client"
    };

    await writeFile(
      envPath,
      [
        "# final run",
        "TWITCH_CLIENT_ID=file-client",
        "TWITCH_ACCESS_TOKEN=token-value",
        "KICK_WEBHOOK_PATH=/webhooks/kick # inline comment",
        "X_FILTER_RULES=\"Market Bubble,marketbubble\"",
        "export FEED_DB_PATH='data/feed.sqlite'",
        "BAD KEY=ignored"
      ].join("\n"),
      "utf8"
    );

    const result = loadLocalEnv({
      envPath,
      target
    });

    expect(result.loaded).toBe(4);
    expect(target).toMatchObject({
      TWITCH_CLIENT_ID: "exported-client",
      TWITCH_ACCESS_TOKEN: "token-value",
      KICK_WEBHOOK_PATH: "/webhooks/kick",
      X_FILTER_RULES: "Market Bubble,marketbubble",
      FEED_DB_PATH: "data/feed.sqlite"
    });
  });

  it("ignores missing .env files", () => {
    const target = {};
    const result = loadLocalEnv({
      envPath: path.join(os.tmpdir(), "missing-chat-aggregator-env"),
      target
    });

    expect(result.loaded).toBe(0);
    expect(target).toEqual({});
  });
});
