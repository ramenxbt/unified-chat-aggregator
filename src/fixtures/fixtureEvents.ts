import {
  buildUnifiedEventId,
  type ConnectorStatus,
  type SourcePlatform,
  type UnifiedEvent
} from "../domain/unifiedEvent";

type FixtureTemplate = {
  platform: SourcePlatform;
  kind: UnifiedEvent["kind"];
  sourceChannelId: string;
  sourceChannelName: string;
  authorId?: string;
  authorName?: string;
  authorColor?: string;
  text: string;
  badges?: UnifiedEvent["badges"];
};

const templates: FixtureTemplate[] = [
  {
    platform: "kick",
    kind: "chat_message",
    sourceChannelId: "kick_marketbubble",
    sourceChannelName: "marketbubble",
    authorId: "kick_91",
    authorName: "user91",
    authorColor: "#79f15e",
    text: "HYPE just different",
    badges: [{ label: "Sub", type: "subscriber", count: 3 }]
  },
  {
    platform: "x",
    kind: "post",
    sourceChannelId: "x_rules_crypto",
    sourceChannelName: "crypto rule set",
    authorId: "x_1337",
    authorName: "user1337",
    text: "thanks for the polymarket picks"
  },
  {
    platform: "twitch",
    kind: "chat_message",
    sourceChannelId: "twitch_ansem",
    sourceChannelName: "ansem",
    authorId: "tw_67",
    authorName: "user67",
    authorColor: "#a970ff",
    text: "Ansem is cooking again",
    badges: [{ label: "Mod", type: "moderator" }]
  },
  {
    platform: "twitch",
    kind: "chat_message",
    sourceChannelId: "twitch_ansem",
    sourceChannelName: "ansem",
    authorId: "tw_204",
    authorName: "chartmaxi",
    authorColor: "#56c2ff",
    text: "BTC breakout if 72.4k reclaims cleanly"
  },
  {
    platform: "kick",
    kind: "chat_message",
    sourceChannelId: "kick_marketbubble",
    sourceChannelName: "marketbubble",
    authorId: "kick_440",
    authorName: "rangefinder",
    authorColor: "#e7c35a",
    text: "invalid below the base, clean setup"
  },
  {
    platform: "x",
    kind: "space_metadata",
    sourceChannelId: "x_space_crypto",
    sourceChannelName: "live spaces",
    text: "Live Space: Market structure and election odds, 2.4k participants"
  },
  {
    platform: "x",
    kind: "post",
    sourceChannelId: "x_rules_crypto",
    sourceChannelName: "crypto rule set",
    authorId: "x_505",
    authorName: "tape_reader",
    text: "news flow is getting aggressive around open interest"
  },
  {
    platform: "kick",
    kind: "chat_message",
    sourceChannelId: "kick_ansem",
    sourceChannelName: "ansem",
    authorId: "kick_388",
    authorName: "greenwick",
    authorColor: "#67e85f",
    text: "Kick side is locked on the Ansem trade",
    badges: [{ label: "VIP", type: "vip" }]
  },
  {
    platform: "kick",
    kind: "chat_message",
    sourceChannelId: "kick_marketbubble",
    sourceChannelName: "marketbubble",
    authorId: "kick_871",
    authorName: "liquiditymaps",
    authorColor: "#ff6b6b",
    text: "@marketbubble support is still holding"
  },
  {
    platform: "twitch",
    kind: "chat_notice",
    sourceChannelId: "twitch_ansem",
    sourceChannelName: "ansem",
    authorId: "tw_spam_bot",
    authorName: "promo_drop",
    text: "Held for review: claim free tokens at sketchy-airdrop.test"
  }
];

export const initialConnectorStatuses: ConnectorStatus[] = [
  {
    platform: "twitch",
    state: "live",
    label: "EventSub fixture",
    sourceName: "ansem",
    eventCount: 0,
    droppedCount: 0,
    reconnectCount: 0,
    latencyMs: 124
  },
  {
    platform: "kick",
    state: "live",
    label: "Webhook fixture",
    sourceName: "marketbubble",
    eventCount: 0,
    droppedCount: 0,
    reconnectCount: 0,
    latencyMs: 188
  },
  {
    platform: "x",
    state: "degraded",
    label: "Filtered stream fixture",
    sourceName: "crypto rules",
    eventCount: 0,
    droppedCount: 0,
    reconnectCount: 0,
    latencyMs: 6200
  }
];

export function createFixtureEvent(sequence: number, receivedAt = new Date()): UnifiedEvent {
  const template = templates[sequence % templates.length];
  const occurredAt = new Date(receivedAt.getTime() - (sequence % 4) * 410).toISOString();
  const platformEventId = `${template.platform}_fixture_${sequence}`;

  return {
    id: buildUnifiedEventId(template.platform, platformEventId),
    platform: template.platform,
    kind: template.kind,
    platformEventId,
    sourceChannelId: template.sourceChannelId,
    sourceChannelName: template.sourceChannelName,
    authorId: template.authorId,
    authorName: template.authorName,
    authorColor: template.authorColor,
    text: template.text,
    fragments: [{ type: "text", text: template.text }],
    badges: template.badges ?? [],
    occurredAt,
    receivedAt: receivedAt.toISOString(),
    raw: {
      fixture: true,
      sequence,
      template
    }
  };
}

export function createInitialFixtureEvents(count = 24, now = new Date()): UnifiedEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = count - index - 1;
    const receivedAt = new Date(now.getTime() - index * 1700);

    return createFixtureEvent(sequence, receivedAt);
  });
}

export function createInitialFixtureState(count = 24, now = new Date()) {
  const events = createInitialFixtureEvents(count, now);
  const statuses = events.reduce(updateFixtureStatuses, initialConnectorStatuses);

  return {
    events,
    statuses
  };
}

export function updateFixtureStatuses(
  statuses: ConnectorStatus[],
  event: UnifiedEvent
): ConnectorStatus[] {
  return statuses.map((status) => {
    if (status.platform !== event.platform) return status;

    return {
      ...status,
      state: "live",
      eventCount: status.eventCount + 1,
      lastEventAt: event.receivedAt,
      latencyMs: Math.max(
        80,
        new Date(event.receivedAt).getTime() - new Date(event.occurredAt).getTime()
      )
    };
  });
}
