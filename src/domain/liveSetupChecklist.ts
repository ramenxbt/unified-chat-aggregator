import type { SourcePlatform } from "./unifiedEvent";

export const readinessRequirements: Record<SourcePlatform, string[]> = {
  twitch: [
    "TWITCH_CLIENT_ID",
    "TWITCH_ACCESS_TOKEN",
    "TWITCH_BROADCASTER_USER_ID",
    "TWITCH_BOT_USER_ID",
    "TWITCH_BROADCASTER_LOGIN for source labels"
  ],
  kick: [
    "KICK_WEBHOOK_ENABLED=true",
    "public /webhooks/kick URL",
    "KICK_BROADCASTER_SLUG for source labels",
    "KICK_ACCESS_TOKEN for auto subscribe"
  ],
  x: ["X_BEARER_TOKEN", "X_FILTER_RULES or X_SPACES_QUERY"]
};

export const streamDayEnvChecklist = [
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
];

export const streamDayEnvChecklistText = streamDayEnvChecklist.join("\n");

export function credentialAssignmentCandidates(missing: string): Array<[key: string, value: string]> {
  if (missing === "KICK_WEBHOOK_ENABLED=true or KICK_WEBHOOK_PUBLIC_URL") {
    return [
      ["KICK_WEBHOOK_ENABLED", "true"],
      ["KICK_WEBHOOK_PUBLIC_URL", "https://YOUR-TUNNEL.example/webhooks/kick"]
    ];
  }

  if (
    missing === "KICK_WEBHOOK_PUBLIC_URL" ||
    missing === "valid KICK_WEBHOOK_PUBLIC_URL" ||
    missing === "HTTPS KICK_WEBHOOK_PUBLIC_URL" ||
    missing === "public KICK_WEBHOOK_PUBLIC_URL host" ||
    missing === "real KICK_WEBHOOK_PUBLIC_URL" ||
    missing.startsWith("KICK_WEBHOOK_PUBLIC_URL ending in")
  ) {
    return [["KICK_WEBHOOK_PUBLIC_URL", "https://YOUR-TUNNEL.example/webhooks/kick"]];
  }

  const placeholderCredential = missing.match(/^([A-Z0-9_]+) \(replace placeholder\)$/);
  if (placeholderCredential) {
    return [[placeholderCredential[1], ""]];
  }

  if (/^[A-Z0-9_]+$/.test(missing)) {
    return [[missing, ""]];
  }

  if (missing === "X_FILTER_RULES or X_SPACES_QUERY") {
    return [
      ["X_FILTER_RULES", "from:marketbubble,Market Bubble,marketbubble"],
      ["X_SPACES_QUERY", "Market Bubble"]
    ];
  }

  return [];
}
