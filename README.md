# Unified Chat Aggregator

Competition build for the Market Bubble $10,000 Vibe Code Challenge.

## Challenge

Build a unified chat aggregator that combines Twitch, X, and Kick into one real-time feed with source labels.

Deadline: June 11

## Current Phase

Functional skeleton. Platform constraints, scope, and architecture are documented. The app now has a React/Vite dashboard powered by normalized fixture events or a local WebSocket feed server with Twitch, Kick, and X connector paths.

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

If `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_USER_ID`, and `TWITCH_BOT_USER_ID` are set, `npm run feed` runs Twitch EventSub mode. If `KICK_WEBHOOK_ENABLED=true` or `KICK_WEBHOOK_PUBLIC_URL` is set, it also starts the Kick webhook receiver at `http://127.0.0.1:8788/webhooks/kick` by default. If `X_BEARER_TOKEN` is set with `X_FILTER_RULES` or `X_SPACES_QUERY`, it also runs the X filtered stream or Spaces poller. Without connector credentials it runs fixture mode.

Kick live setup:

```bash
KICK_WEBHOOK_ENABLED=true npm run feed
```

Expose `http://127.0.0.1:8788/webhooks/kick` through Cloudflare Tunnel, ngrok, or another public tunnel, then use that public URL in the Kick Developer app webhook settings. To have the feed server request a chat subscription on startup, set `KICK_ACCESS_TOKEN`, `KICK_BROADCASTER_USER_ID`, and `KICK_SUBSCRIBE_ON_START=true`.

Kick signature verification is on by default. Only set `KICK_VERIFY_SIGNATURE=false` for local smoke testing with manually posted payloads.

OBS browser source mode:

```text
http://127.0.0.1:5173/?obs=1
```

Use that URL after starting the dashboard. For live events, start `npm run feed` first, then run the dashboard with `VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev`.

During a recording, scroll the feed to inspect older messages. The toolbar switches from `Live` to `Jump live` so you can return to the newest events immediately.

Feed rows label both platform and account/channel, for example `TWITCH (ANSEM)`, `KICK (MARKETBUBBLE)`, or `X (@USER1337)`.

The diagnostics rail includes a `Readiness` panel. In fixture mode it shows the exact connector env vars and public webhook setup still needed for Twitch, Kick, and X before a real stream recording.

Use `Import recording JSON` to load a previous export back into the dashboard as replay mode. This is useful for rehearsing or recording the submission if a live connector is unavailable.

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
