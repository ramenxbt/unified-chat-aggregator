# Unified Chat Aggregator

Competition build for the Market Bubble $10,000 Vibe Code Challenge.

## Challenge

Build a unified chat aggregator that combines Twitch, X, and Kick into one real-time feed with source labels.

Deadline: June 11

## Current Phase

Functional skeleton. Platform constraints, scope, and architecture are documented. The app now has a React/Vite dashboard powered by normalized fixture events or a local WebSocket feed server.

## Local Development

```bash
npm install
npm run dev
```

Live feed server mode:

```bash
npm run feed
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

If `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_USER_ID`, and `TWITCH_BOT_USER_ID` are set, `npm run feed` runs Twitch EventSub mode. Without those values it runs fixture mode.

Verification:

```bash
npm test
npm run lint
npm run build
```

## Docs

- [Scope](docs/scope.md)
- [Platform Research](docs/platform-research.md)
- [Architecture Plan](docs/architecture-plan.md)
- [Execution Roadmap](docs/execution-roadmap.md)
- [Winning Strategy](docs/winning-strategy.md)
