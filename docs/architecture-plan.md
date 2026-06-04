# Architecture Plan

## Stack Recommendation

Use a TypeScript monorepo.

Recommended initial stack:

- Next.js app for dashboard and API routes
- Node worker process for connectors
- Postgres for durable sessions/messages
- Redis or in-process queue for MVP fanout
- Prisma or Drizzle for schema management
- Zod for normalized event validation
- WebSocket or Server-Sent Events for browser feed updates
- Playwright for UI verification

Why this stack:

- Fast to build before the June 11 deadline
- Strong TypeScript contracts across connectors and UI
- Easy demo/deploy path
- Easy handoff for final UI polish

## System Shape

```text
Platform APIs
  Twitch EventSub WS
  Kick Webhooks
  X Filtered Stream + Spaces REST
        |
        v
Connector adapters
        |
        v
Normalized event bus
        |
        +--> Durable message store
        +--> Live feed fanout
        +--> Observability counters
        |
        v
Dashboard
```

## Normalized Event

```ts
type SourcePlatform = "twitch" | "kick" | "x";

type UnifiedEventKind =
  | "chat_message"
  | "chat_delete"
  | "chat_notice"
  | "post"
  | "space_metadata"
  | "connector_status";

type UnifiedEvent = {
  id: string;
  platform: SourcePlatform;
  kind: UnifiedEventKind;
  platformEventId: string;
  sourceChannelId?: string;
  sourceChannelName?: string;
  authorId?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  authorColor?: string;
  text?: string;
  fragments?: UnifiedFragment[];
  badges?: UnifiedBadge[];
  parentEventId?: string;
  occurredAt: string;
  receivedAt: string;
  raw: unknown;
};
```

## Connector Contract

Each connector should expose:

```ts
type Connector = {
  platform: SourcePlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ConnectorStatus;
  subscribe(listener: (event: UnifiedEvent) => void): () => void;
};
```

## Data Model

Initial tables:

- `sources`: platform, display name, external channel/account IDs, auth status
- `sessions`: named capture sessions
- `events`: normalized event data plus raw payload
- `connector_runs`: lifecycle and error logs for each connector run
- `aliases`: optional cross-platform identity mapping
- `filters`: saved keywords, muted authors, source toggles

## Runtime Modes

### Demo Mode

No credentials required.

- Fixture generators produce Twitch, Kick, and X-like events.
- Burst mode simulates high message volume.
- Reconnect mode simulates platform failures.

### Real Mode

Credentials required.

- Twitch: EventSub WebSocket
- Kick: webhook receiver plus event subscription setup
- X: filtered stream plus Spaces polling/lookup

## Reliability Requirements

- Dedupe using `platform + platformEventId`.
- Reconnect with exponential backoff and jitter.
- Track last successful event per connector.
- Surface degraded auth/rate-limit states in UI.
- Keep raw payloads for debugging.
- Never expose tokens to the client.
- Validate inbound webhook signatures for Kick.

## UI Requirements For First Build

The first UI should be clean and functional, not final-polished:

- Left source/config rail
- Main unified feed
- Right diagnostics/detail panel
- Header with session state and connector health
- Message rows with platform label, timestamp, author, badges, and content
- Controls: pause, clear, search, source filter, signal mode
- Empty, loading, degraded, and credential-missing states

Final visual polish should happen after the functional surface exists.
