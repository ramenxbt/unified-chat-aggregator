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
npm run qa:final
```

This checks tracked files for accidental live credentials or attribution issues, then proves tests, lint, build, browser workflows, connector paths against local Twitch/Kick/X mocks, the feed WebSocket, dashboard transport, server archive path, SQLite archive path, high-volume burst handling, and visual captures work together. It writes `qa/final-report.md` and `qa/final-report.json` for the final evidence packet.

Run the local doctor first:

```bash
npm run live:doctor
```

This checks strict connector readiness plus local blockers: feed/dashboard/Kick port availability, server archive output, and writable archive/database paths.

Run the strict connector check next:

```bash
npm run preflight
npm run live:prepare -- --out qa/live-run-plan.txt
npm run obs:handoff -- --out qa/obs
npm run live:ready
npm run live:stack -- --require-ready --with-proof-gate --dry-run
```

The strict check should say `Live preflight: ready` before the final full-platform recording.
The saved `qa/live-run-plan.txt` file keeps the exact commands, OBS URLs, tunnel health check, evidence commands, replay export commands, and repo commit metadata available during setup.
The OBS handoff writes `qa/obs/obs-browser-sources.md` and `qa/obs/obs-browser-sources.json` with the browser source URLs, settings, and focused proof shots for the same app port.
The final `live:ready` gate checks strict connector preflight, current final QA, current strict run sheet with the launch commands, OBS all-source URL for the current app port, and current evidence commands, valid current-commit OBS handoff files, and matching OBS all-source URLs between the run sheet and handoff before OBS setup.
If you set `PROOF_MIN_EVENTS`, `PROOF_MIN_SOURCE_LABELS`, `PROOF_MAX_P95_LATENCY_MS`, `PROOF_TIMEOUT_MS`, or `PROOF_INTERVAL_MS`, use the proof-gate command printed by `npm run live:prepare` so the final wait gate matches your configured thresholds and wait window.
Use the `OBS browser source settings` block printed by `npm run live:prepare` for the browser source dimensions, FPS, transparent background, and refresh toggles.
If a default port, evidence path, or proof wait window is unavailable, pass the same overrides to `live:doctor`, `live:prepare`, `live:ready`, and `live:stack`, for example `--feed-port 8899 --app-port 5260 --archive-dir data/final-sessions --db data/final.sqlite --proof-timeout-ms 300000`.

For a one-platform dry run, use:

```bash
npm run preflight -- --allow-partial
npm run live:prepare -- --allow-partial --out qa/live-run-plan.partial.txt
```

Do not treat partial mode as final proof. It is only for connector smoke testing. If you use the printed proof, evidence, or bundle commands during a partial rehearsal, keep the included `--allow-partial` flag.
Before the final strict bundle, regenerate `qa/live-run-plan.txt` without `--allow-partial` and rerun `npm run obs:handoff -- --out qa/obs`; `submission:bundle` will fail with an artifact issue if the run sheet is partial, stale, or missing launch/evidence commands, if the OBS handoff files are stale, missing, or malformed, or if the OBS handoff URL does not match the run sheet.

## 2. Kick Tunnel

Kick needs a public URL for webhook delivery.

1. Start a tunnel to `http://127.0.0.1:8788`.
2. Set `KICK_WEBHOOK_PUBLIC_URL` to the public HTTPS `/webhooks/kick` URL.
3. Put the same public URL in the Kick Developer app webhook settings.
4. Run `npm run preflight` again.
5. After the capture stack is running, run the `tunnel health check` command printed by `npm run live:prepare`.

If `KICK_SUBSCRIBE_ON_START=true`, also set `KICK_ACCESS_TOKEN` and `KICK_BROADCASTER_USER_ID`.

## 3. Start The Capture Stack

Lowest-mistake path:

```bash
npm run live:stack -- --with-proof-gate
```

This runs the same doctor checks, then starts the feed server, dashboard, and live proof gate with the planned archive, database, ports, and WebSocket URL. When the proof gate reports ready, the feed and dashboard keep running for capture. If the proof gate exits non-zero or times out, the feed and dashboard still keep running; keep capturing live events, then rerun the printed proof-gate command once there is enough signal. Stop the stack with `Ctrl-C` after exporting evidence.

Manual fallback:

Terminal 1:

```bash
FEED_SERVER_PORT=8787 FEED_DB_PATH=data/feed.sqlite FEED_ARCHIVE_DIR=data/feed-sessions npm run feed
```

Confirm the feed server prints:

- `Feed server mode: connectors`
- `Feed archive: data/feed-sessions/<session-id>`

For the final evidence run, start the feed server with `FEED_DB_PATH=data/feed.sqlite` as well. This keeps a queryable SQLite copy of sessions, normalized sources, events, and connector status samples next to the JSONL archive.

Terminal 2:

```bash
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev -- --host 127.0.0.1 --port 5173
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
Strict proof requires `Mode: connectors`. A fixture-mode archive is rehearsal proof only and should not be used for the final submission recording.

## 4. Record The Main Submission

Start the capture stack with `npm run live:stack -- --require-ready --with-proof-gate`.

1. Click `Record`.
2. Let live events arrive from the stream.
3. Open `qa/obs/obs-browser-sources.md`.
4. Add `Unified Chat - All Sources` as an OBS browser source.
5. Apply the `OBS browser source settings` from `npm run live:prepare`.
6. Mark the strongest messages with `Clip` as they happen so the exact source-account labels are preserved for editing. The clip queue is saved in local storage, so refreshes should not lose marked moments before export.
7. Record the overlay plus the real Market Bubble stream.
8. Stop recording in the dashboard.
9. Export recording JSON, recording CSV, and clip queue JSON.

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
- Passing final local rehearsal report from `qa/final-report.md`.
- Final `qa/live-run-plan.txt` regenerated after the final commit.
- OBS browser source handoff files in `qa/obs/`.
- Visual QA screenshots from `qa/visual/`.
- Passing stress output from the final QA run.
- Final UI handoff checked against `docs/final-ui-handoff.md`.
- Connector diagnostics showing Twitch, Kick, and X readiness.
- Passing `npm run live:ready` output before opening OBS.
- Passing `npm run evidence:check` output for the recorded session, including throughput and latency metrics.
- `submission-bundle/` containing `evidence-report.txt`, `replay.json`, `replay.csv`, `submission-notes.md`, `summary.json`, and copied run/QA reports when `qa/live-run-plan.txt` or `qa/final-report.*` exists.
- `submission-bundle/` containing copied OBS handoff files from `qa/obs/`.
- `submission-notes.md` reviewed for repo commit, source labels, proof metrics, and external artifacts to attach.
- Exported recording JSON.
- Exported recording CSV.
- Exported clip queue JSON.
- Server archive folder with `manifest.json`, `events.jsonl`, and `statuses.jsonl`.
- SQLite database when `FEED_DB_PATH` is enabled.
- Final repo pushed to `ramenxbt/unified-chat-aggregator`.
