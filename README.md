# Unified Chat Aggregator

One real-time feed for Twitch, Kick, and X. Watch every chat in one place, with the source always visible.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React](https://img.shields.io/badge/React-19-61dafb)
![Vite](https://img.shields.io/badge/Vite-7-646cff)
![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20playwright-6e9f18)

![Dashboard](docs/images/dashboard.png)

## Why

Streaming to Twitch, Kick, and X at the same time means three chats in three windows. This app merges them into one chronological feed. Every message keeps its platform color, its logo, and its account label, such as `TWITCH (ANSEM)` or `KICK (MARKETBUBBLE)`, so you always know where a message came from.

## Features

- Unified live feed with Twitch, Kick, and X messages in one stream
- Platform logos and account labels on every row
- Search across messages, authors, accounts, and platforms
- One-click source toggles and a signal-only mode for high-value messages
- Clip queue to mark the best moments, with reload-safe persistence and JSON export
- Recording with JSON/CSV export, replay import, and shareable replay links
- OBS browser-source overlay mode with a transparent background
- Connector health, latency, and throughput proof built into the UI
- Server-side session archives (JSONL and SQLite) that survive browser reloads

## Quick start

You need [Node.js](https://nodejs.org) 20.19 or newer (npm comes with it) and [Git](https://git-scm.com). Check with `node -v` and `git --version`.

```bash
git clone https://github.com/ramenxbt/unified-chat-aggregator.git
cd unified-chat-aggregator
npm install
npm run dev
```

Then open `http://127.0.0.1:5173/` in your browser. The dashboard starts in demo mode with realistic fixture events, so you can explore everything without any accounts or credentials.

## Going live

Copy the env template and fill in credentials for the platforms you want:

```bash
cp .env.example .env
```

| Platform | Required values |
| --- | --- |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_USER_ID`, `TWITCH_BOT_USER_ID` |
| Kick | `KICK_WEBHOOK_ENABLED=true` plus a public `KICK_WEBHOOK_PUBLIC_URL` ending in `/webhooks/kick` |
| X | `X_BEARER_TOKEN` with `X_FILTER_RULES` or `X_SPACES_QUERY` |

Then start the feed server and point the dashboard at it:

```bash
npm run feed
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

Platforms without credentials simply stay in demo mode, so a partial setup still works. The Setup tab in the dashboard shows exactly which values are still missing.

## OBS overlay

Add a browser source pointing at:

```text
http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14
```

The overlay uses a transparent background and supports `sources`, `q`, `signal`, and `limit` URL presets. Ready-to-open preset links are listed in the dashboard's Setup tab.

![OBS overlay](docs/images/obs-overlay.png)

## How it works

```text
Twitch EventSub      Kick webhooks       X filtered stream
       \                  |                   /
        +------- feed server (WebSocket) ----+
        |        normalizes to one event shape
        |        archives JSONL + SQLite
        v
   React dashboard
   feed, search, clips, recording, OBS overlay
```

Connectors normalize every platform event into one shared shape with stable IDs, author info, badges, and source labels. The dashboard renders them in real time and never touches platform credentials; only the feed server does.

## Verify

```bash
npm run qa:quick   # fast gate: hygiene, tests, lint, build, rehearsals
npm test           # unit and integration tests
npm run test:e2e   # browser tests
npm run lint
npm run build
```

## Docs

- [User Guide](docs/user-guide.md) for the full walkthrough: every control, going live, and OBS setup
- [Operations Reference](docs/operations.md) for every live-run, proof, and archive command
- [Submission Runbook](docs/submission-runbook.md) for the stream-day checklist
- [Architecture Plan](docs/architecture-plan.md)
- [Platform Research](docs/platform-research.md)
- [Scope](docs/scope.md)
- [Storage Schema](docs/storage-schema.sql)

## License

MIT
