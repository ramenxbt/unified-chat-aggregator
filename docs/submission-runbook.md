# Submission Runbook

Use this as the final checklist for the Market Bubble stream recording.

## 1. Live Credential Check

Copy the template and fill in the real stream credentials:

```bash
cp .env.example .env
```

The dashboard reads `VITE_*` values from `.env`. Server-side commands such as `feed`, `preflight`, `live:prepare`, and `proof:gate` also load `.env` automatically without overriding values already exported in your shell.

Run the fixture rehearsal once before connecting real credentials:

```bash
npm run qa:repo
npm run qa:connectors
npm run qa:rehearsal
npm run qa:stress
```

This checks tracked files for accidental live credentials or attribution issues, then proves the real connector paths against local Twitch/Kick/X mocks, the feed WebSocket, dashboard transport, server archive path, SQLite archive path, and high-volume burst handling work together.

Run the local doctor first:

```bash
npm run live:doctor
```

This checks strict connector readiness plus local blockers: feed/dashboard/Kick port availability, server archive output, and writable archive/database paths.

Run the strict connector check next:

```bash
npm run preflight
npm run live:prepare
```

The strict check should say `Live preflight: ready` before the final full-platform recording.
If you set `PROOF_MIN_EVENTS`, `PROOF_MIN_SOURCE_LABELS`, or `PROOF_MAX_P95_LATENCY_MS`, use the proof-gate command printed by `npm run live:prepare` so the final wait gate matches your configured thresholds.

For a one-platform dry run, use:

```bash
npm run preflight -- --allow-partial
npm run live:prepare -- --allow-partial
```

Do not treat partial mode as final proof. It is only for connector smoke testing.

## 2. Kick Tunnel

Kick needs a public URL for webhook delivery.

1. Start a tunnel to `http://127.0.0.1:8788`.
2. Set `KICK_WEBHOOK_PUBLIC_URL` to the public `/webhooks/kick` URL.
3. Put the same public URL in the Kick Developer app webhook settings.
4. Run `npm run preflight` again.

If `KICK_SUBSCRIBE_ON_START=true`, also set `KICK_ACCESS_TOKEN` and `KICK_BROADCASTER_USER_ID`.

## 3. Start The Capture Stack

Terminal 1:

```bash
FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed
```

Confirm the feed server prints:

- `Feed server mode: connectors`
- `Feed archive: data/feed-sessions/<session-id>`

For the final evidence run, start the feed server with `FEED_DB_PATH=data/feed.sqlite` as well. This keeps a queryable SQLite copy of sessions, normalized sources, events, and connector status samples next to the JSONL archive.

Terminal 2:

```bash
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Confirm the dashboard shows connector cards for Twitch, Kick, and X. At least one live event should arrive before recording.

Terminal 3:

```bash
npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000
```

Wait for `Live proof gate: ready`. This reads the active JSONL archive while the feed server is still running and confirms event volume, Twitch/Kick/X event coverage, connector status samples, account source labels, and p95 latency before the OBS capture.

## 4. Record The Main Submission

1. Click `Record`.
2. Let live events arrive from the stream.
3. Open the `All sources` OBS preset from the diagnostics rail.
4. Add that URL as an OBS browser source.
5. Record the overlay plus the real Market Bubble stream.
6. Stop recording in the dashboard.
7. Export recording JSON and CSV.

Use these backup OBS URLs if needed:

```text
http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14
http://127.0.0.1:5173/?obs=1&sources=twitch,kick&limit=12
http://127.0.0.1:5173/?obs=1&signal=1&limit=10
```

## 5. Recovery If Browser Reloads

The feed server archive is the source of truth if the browser loses its local recording.

Check the archive and database evidence:

```bash
npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite
npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle
```

These commands use the newest archive session. Pass `--archive data/feed-sessions/<session-id>` instead when reviewing an older run.

Export replay JSON:

```bash
npm run archive:export -- --archive-dir data/feed-sessions --out replay.json
```

Export CSV:

```bash
npm run archive:export -- --archive-dir data/feed-sessions --format csv --out replay.csv
```

Then use `Import recording JSON` in the dashboard to load `replay.json`.

## 6. Submission Evidence Checklist

- Live dashboard recording with source labels visible.
- OBS overlay recording with source labels visible.
- Passing tracked-file hygiene output from `npm run qa:repo`.
- Visual QA screenshots from `npm run qa:visual`.
- Passing stress output from `npm run qa:stress`.
- Final UI handoff checked against `docs/final-ui-handoff.md`.
- Connector diagnostics showing Twitch, Kick, and X readiness.
- Passing `npm run evidence:check` output for the recorded session, including throughput and latency metrics.
- `submission-bundle/` containing `evidence-report.txt`, `replay.json`, `replay.csv`, `submission-notes.md`, and `summary.json`.
- Exported recording JSON.
- Exported recording CSV.
- Server archive folder with `manifest.json`, `events.jsonl`, and `statuses.jsonl`.
- SQLite database when `FEED_DB_PATH` is enabled.
- Final repo pushed to `ramenxbt/unified-chat-aggregator`.
