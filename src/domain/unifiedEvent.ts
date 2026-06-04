import { z } from "zod";

export const sourcePlatformSchema = z.enum(["twitch", "kick", "x"]);

export const unifiedEventKindSchema = z.enum([
  "chat_message",
  "chat_delete",
  "chat_notice",
  "post",
  "space_metadata",
  "connector_status"
]);

export const connectorStateSchema = z.enum([
  "connecting",
  "live",
  "reconnecting",
  "degraded",
  "rate_limited",
  "unauthorized",
  "stopped"
]);

export const unifiedFragmentSchema = z.object({
  type: z.enum(["text", "emote", "mention", "cheermote", "link"]),
  text: z.string(),
  id: z.string().optional()
});

export const unifiedBadgeSchema = z.object({
  label: z.string(),
  type: z.string(),
  count: z.number().optional()
});

export const unifiedEventSchema = z.object({
  id: z.string(),
  platform: sourcePlatformSchema,
  kind: unifiedEventKindSchema,
  platformEventId: z.string(),
  sourceChannelId: z.string().optional(),
  sourceChannelName: z.string().optional(),
  authorId: z.string().optional(),
  authorName: z.string().optional(),
  authorAvatarUrl: z.string().url().optional(),
  authorColor: z.string().optional(),
  text: z.string().optional(),
  fragments: z.array(unifiedFragmentSchema).default([]),
  badges: z.array(unifiedBadgeSchema).default([]),
  parentEventId: z.string().optional(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  raw: z.unknown()
});

export const connectorStatusSchema = z.object({
  platform: sourcePlatformSchema,
  state: connectorStateSchema,
  label: z.string(),
  sourceName: z.string(),
  lastEventAt: z.string().datetime().optional(),
  eventCount: z.number().int().nonnegative(),
  droppedCount: z.number().int().nonnegative(),
  reconnectCount: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative().optional()
});

export type SourcePlatform = z.infer<typeof sourcePlatformSchema>;
export type UnifiedEventKind = z.infer<typeof unifiedEventKindSchema>;
export type ConnectorState = z.infer<typeof connectorStateSchema>;
export type UnifiedFragment = z.infer<typeof unifiedFragmentSchema>;
export type UnifiedBadge = z.infer<typeof unifiedBadgeSchema>;
export type UnifiedEvent = z.infer<typeof unifiedEventSchema>;
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export type PlatformFilter = Record<SourcePlatform, boolean>;

export const platformLabels: Record<SourcePlatform, string> = {
  twitch: "Twitch",
  kick: "Kick",
  x: "X"
};

export function buildUnifiedEventId(platform: SourcePlatform, platformEventId: string): string {
  return `${platform}:${platformEventId}`;
}

export function dedupeEvents(events: UnifiedEvent[]): UnifiedEvent[] {
  const seen = new Set<string>();
  const deduped: UnifiedEvent[] = [];

  for (const event of events) {
    const key = buildUnifiedEventId(event.platform, event.platformEventId);

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(event);
    }
  }

  return deduped;
}

export function scoreEventSignal(event: UnifiedEvent): number {
  const text = event.text?.toLowerCase() ?? "";
  let score = 0;

  if (event.kind === "post") score += 1;
  if (event.kind === "space_metadata") score += 1;
  if (event.badges.some((badge) => ["moderator", "subscriber", "verified"].includes(badge.type))) score += 2;
  if (/\b(alpha|alert|buy|sell|breakout|support|resistance|polymarket|news)\b/.test(text)) score += 3;
  if (/[!?]{2,}/.test(text)) score += 1;
  if (text.includes("@")) score += 1;

  return score;
}

export function isSignalEvent(event: UnifiedEvent): boolean {
  return scoreEventSignal(event) >= 3;
}

