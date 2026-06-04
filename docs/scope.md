# Scope

## Goal

Build the strongest competition-grade unified chat aggregator for Twitch, Kick, and X by optimizing for reliability, speed, clarity, and a polished operator experience.

The final app should feel like a live command center: one feed, platform labels, unified filtering, resilient connectors, and enough diagnostics to prove it is more than a visual mockup.

## Product Promise

One dashboard shows messages and live social activity from:

- Twitch channel chat
- Kick channel chat
- X public posts matching configured rules
- X Spaces metadata and participant/speaker updates where official APIs allow it

## Important Constraint

X does not appear to expose an official "Spaces chat" or live video chat stream comparable to Twitch/Kick chat. The X source should therefore be treated as public conversation activity:

- Near-real-time filtered posts for configured accounts, keywords, cashtags, hashtags, or URLs
- Spaces discovery/lookup metadata for live or scheduled Spaces
- Optional tracking of replies to a specific post or stream-related hashtag when configured

This avoids depending on brittle scraping or private APIs.

## MVP

The MVP must include:

- Real-time unified feed with normalized message shape
- Source labels for Twitch, Kick, and X
- Connector health indicators and last-event timestamps
- Per-source toggles
- Search and keyword highlight
- Basic author filtering
- Deduplication by platform message ID
- In-memory replay buffer for recent messages
- Persistent storage for sessions and captured events
- Demo mode with fixture streams when platform credentials are missing

## Winning Features

These should differentiate the project:

- Stream-grade ingestion with backpressure, reconnects, and rate-limit handling
- "Signal mode" that ranks or highlights messages likely worth responding to
- Cross-platform identity grouping by username similarity and manual aliasing
- Moderation queue for spam, deleted messages, or held messages where the platform provides events
- Time-sync controls: newest-first, oldest-first, pause, resume, jump to live
- Export session to JSON/CSV
- Shareable read-only replay link for a stream segment
- Observability panel showing connector status, dropped events, retry counts, and latency

## Non-Goals For First Build

- Sending messages back to all platforms
- Scraping private/internal X endpoints
- Full bot moderation actions across platforms
- AI-generated final UI design before the backend and UX skeleton are proven
- Mobile-first UX at the cost of desktop operator density

## Success Criteria

- Each connector is isolated, typed, and testable.
- The app can run without credentials in demo mode.
- At least one real connector can be verified locally with credentials.
- Feed remains usable under bursty message volume.
- UI clearly shows source, author, message, timestamp, and connection health.
- Final presentation includes proof: screenshots, fixture replay, and architecture notes.

