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

For a live run, copy `.env.example` to `.env` and fill in the platform credentials:

```bash
cp .env.example .env
```

Vite reads `VITE_*` values from `.env` for the dashboard. Server-side commands such as `feed`, `preflight`, `live:prepare`, and `proof:gate` also load `.env` automatically without overriding values already exported in your shell.

Live feed server mode:

```bash
npm run preflight
npm run live:prepare
npm run feed
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

If `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_USER_ID`, and `TWITCH_BOT_USER_ID` are set, `npm run feed` runs Twitch EventSub mode. If `KICK_WEBHOOK_ENABLED=true` or `KICK_WEBHOOK_PUBLIC_URL` is set, it also starts the Kick webhook receiver at `http://127.0.0.1:8788/webhooks/kick` by default. If `X_BEARER_TOKEN` is set with `X_FILTER_RULES` or `X_SPACES_QUERY`, it also runs the X filtered stream or Spaces poller. Without connector credentials it runs fixture mode.

`npm run preflight` checks the live environment for Twitch, Kick, and X before you start the feed server. It exits non-zero until all three platforms are ready. Use `npm run preflight -- --allow-partial` when intentionally testing only one live connector.

`npm run live:prepare` prints the same strict readiness check plus the exact final-run feed command, dashboard command, OBS URLs, Kick webhook URL, archive path, database path, and replay export commands. Use `npm run live:prepare -- --allow-partial` for one-platform dry runs only.

The feed server archives every accepted event and connector status update under `data/feed-sessions/<session-id>/` by default. Each session writes `manifest.json`, `events.jsonl`, and `statuses.jsonl`, which gives the submission run a server-side backup even if the browser reloads. Set `FEED_ARCHIVE_DIR` to change the folder or `FEED_ARCHIVE_ENABLED=false` to disable local archives.

Set `FEED_DB_PATH=data/feed.sqlite` to also persist sessions, normalized sources, events, and connector status samples into a queryable SQLite database. Source rows use the same platform/account label shape as the UI, such as `KICK (ANSEM)`, so the final run has durable proof of which account each message came from.

For high-volume fixture proof, set `FEED_INITIAL_EVENT_COUNT=0`, `FEED_FIXTURE_INTERVAL_MS=10`, and `FEED_FIXTURE_BURST_SIZE=25`, or run `npm run qa:stress`. The stress rehearsal drives burst traffic through WebSocket fanout, JSONL archive, SQLite, and evidence metrics.

Gate, check, or convert a server archive:

```bash
npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000
npm run evidence:check -- --archive data/feed-sessions/<session-id> --db data/feed.sqlite
npm run submission:bundle -- --archive data/feed-sessions/<session-id> --db data/feed.sqlite --out submission-bundle
npm run archive:export -- data/feed-sessions/<session-id> --out replay.json
npm run archive:export -- data/feed-sessions/<session-id> --format csv --out replay.csv
```

The proof gate reads the active JSONL archive while the feed server is still running. Use it before the final OBS capture; it waits for enough events, Twitch/Kick/X coverage, connector status samples, account source labels, and acceptable p95 latency.

The evidence check validates the archive manifest, parsed events, connector statuses, required Twitch/Kick/X coverage, source labels, ingest duration, throughput, latency, and optional SQLite database rows before you package the final submission.

The submission bundle command writes `evidence-report.txt`, `replay.json`, `replay.csv`, `submission-notes.md`, and `summary.json` into one folder for the final handoff. The notes file gives a human-readable proof summary, while the JSON summary keeps platform counts, source labels, throughput, and latency metrics from the recorded run.

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

OBS URLs can be preset for a source-specific shot:

```text
http://127.0.0.1:5173/?obs=1&sources=twitch,kick&limit=12
http://127.0.0.1:5173/?obs=1&sources=twitch&limit=8&q=ansem
http://127.0.0.1:5173/?obs=1&signal=1&limit=10
```

The diagnostics rail also shows ready-to-open OBS preset links while the dashboard is not in submission mode.

During a recording, scroll the feed to inspect older messages. The toolbar switches from `Live` to `Jump live` so you can return to the newest events immediately. Use the `Newest first` / `Oldest first` control to switch between live monitoring and chronological replay review.

Feed rows label both platform and account/channel, for example `TWITCH (ANSEM)`, `KICK (MARKETBUBBLE)`, or `X (@USER1337)`.

The diagnostics rail includes an `Accounts` roster with live source-account activity, event counts, signal counts, and one-click filters. The `Identities` panel groups matching source accounts across platforms, such as `TWITCH (ANSEM)` and `KICK (ANSEM)`, into a focused search. Selecting a row opens author/source diagnostics with the platform account, author handle, badge stack, buffer counts, signal score, and platform IDs. From there, the operator can filter to the selected source account or selected author without changing the search box. This makes it easier to prove where a clipped message came from during the final submission recording.

The `Review queue` flags held, deleted, or spam-risk messages when those signals are present in normalized events. It gives the operator a quick way to inspect questionable chat without mutating the platform.

The diagnostics rail includes a `Performance` panel with current buffer throughput, average latency, p95 latency, and latest event freshness for visible proof during the recording.

The diagnostics rail includes a `Submission checklist` panel that tracks whether the current run has live WebSocket transport, Twitch/Kick/X coverage, account-qualified source labels, active recording proof, and visible performance metrics before the final capture.

The diagnostics rail includes a `Readiness` panel. In fixture mode it shows the exact connector env vars and public webhook setup still needed for Twitch, Kick, and X before a real stream recording.

Use `Save current buffer` to persist the current in-browser feed buffer to local sessions. The app keeps the latest 12 saved sessions and can load any saved session back into replay mode without needing a JSON file.

Recordings can be exported as JSON for replay or CSV for spreadsheet review.

Use `Import recording JSON` to load a previous export back into the dashboard as replay mode. This is useful for rehearsing or recording the submission if a live connector is unavailable.

Use `Copy replay link` to create a local read-only replay URL for the current buffer. Opening that URL loads replay mode immediately, which is useful for handing a proof clip to another reviewer on the same app build.

Verification:

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

Visual QA screenshots:

```bash
npm run qa:visual
```

This writes desktop, mobile, and OBS overlay captures to `qa/visual/`.

Final stack rehearsal:

```bash
npm run qa:rehearsal
npm run qa:stress
```

The rehearsal starts the feed server and dashboard on alternate local ports, verifies the browser is reading from `VITE_FEED_WS_URL`, and confirms server archive output under `qa/rehearsal/`. The stress run records high-volume proof under `qa/stress/` and fails if throughput or p95 latency miss the configured thresholds.

## Docs

- [Scope](docs/scope.md)
- [Platform Research](docs/platform-research.md)
- [Architecture Plan](docs/architecture-plan.md)
- [Execution Roadmap](docs/execution-roadmap.md)
- [Final UI Handoff](docs/final-ui-handoff.md)
- [Storage Schema](docs/storage-schema.sql)
- [Submission Runbook](docs/submission-runbook.md)
- [Winning Strategy](docs/winning-strategy.md)
