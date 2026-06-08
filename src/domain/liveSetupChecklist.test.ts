import { describe, expect, it } from "vitest";
import {
  credentialAssignmentCandidates,
  readinessRequirements,
  streamDayEnvChecklist,
  streamDayEnvChecklistText
} from "./liveSetupChecklist";

describe("live setup checklist", () => {
  it("keeps stream-day env checklist values copy-ready", () => {
    expect(streamDayEnvChecklist).toEqual([
      "TWITCH_CLIENT_ID=",
      "TWITCH_ACCESS_TOKEN=",
      "TWITCH_BROADCASTER_USER_ID=",
      "TWITCH_BOT_USER_ID=",
      "TWITCH_BROADCASTER_LOGIN=marketbubble",
      "KICK_WEBHOOK_ENABLED=true",
      "KICK_WEBHOOK_PUBLIC_URL=https://YOUR-TUNNEL.example/webhooks/kick",
      "KICK_BROADCASTER_SLUG=marketbubble",
      "X_BEARER_TOKEN=",
      "X_FILTER_RULES=from:marketbubble,Market Bubble,marketbubble",
      "X_SPACES_QUERY=Market Bubble"
    ]);
    expect(streamDayEnvChecklistText).toBe(streamDayEnvChecklist.join("\n"));
  });

  it("maps preflight missing states to the same operator placeholders", () => {
    expect(credentialAssignmentCandidates("KICK_WEBHOOK_ENABLED=true or KICK_WEBHOOK_PUBLIC_URL")).toEqual([
      ["KICK_WEBHOOK_ENABLED", "true"],
      ["KICK_WEBHOOK_PUBLIC_URL", "https://YOUR-TUNNEL.example/webhooks/kick"]
    ]);
    expect(credentialAssignmentCandidates("X_FILTER_RULES or X_SPACES_QUERY")).toEqual([
      ["X_FILTER_RULES", "from:marketbubble,Market Bubble,marketbubble"],
      ["X_SPACES_QUERY", "Market Bubble"]
    ]);
    expect(credentialAssignmentCandidates("X_BEARER_TOKEN (replace placeholder)")).toEqual([
      ["X_BEARER_TOKEN", ""]
    ]);
    expect(credentialAssignmentCandidates("real KICK_WEBHOOK_PUBLIC_URL")).toEqual([
      ["KICK_WEBHOOK_PUBLIC_URL", "https://YOUR-TUNNEL.example/webhooks/kick"]
    ]);
  });

  it("lists per-platform dashboard readiness requirements", () => {
    expect(readinessRequirements.twitch).toContain("TWITCH_ACCESS_TOKEN");
    expect(readinessRequirements.twitch).toContain("TWITCH_BROADCASTER_LOGIN for source labels");
    expect(readinessRequirements.kick).toContain("public /webhooks/kick URL");
    expect(readinessRequirements.kick).toContain("KICK_BROADCASTER_SLUG for source labels");
    expect(readinessRequirements.x).toContain("X_BEARER_TOKEN");
  });
});
