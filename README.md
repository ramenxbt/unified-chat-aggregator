# Unified Chat Aggregator

Competition build for the Market Bubble $10,000 Vibe Code Challenge.

## Challenge

Build a unified chat aggregator that combines Twitch, X, and Kick into one real-time feed with source labels.

Deadline: June 11

## Current Phase

Live-ready build. Platform constraints, scope, and architecture are documented. The app has a React/Vite dashboard powered by normalized fixture events or a local WebSocket feed server with Twitch, Kick, and X connector paths, plus OBS mode, proof gates, archives, and submission bundle tooling.

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
npm run live:doctor
npm run qa:quick
npm run preflight
npm run live:prepare
npm run live:ready
npm run live:stack -- --dry-run
npm run feed
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

If `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_USER_ID`, and `TWITCH_BOT_USER_ID` are set, `npm run feed` runs Twitch EventSub mode. If `KICK_WEBHOOK_ENABLED=true` or `KICK_WEBHOOK_PUBLIC_URL` is set, it also starts the Kick webhook receiver at `http://127.0.0.1:8788/webhooks/kick` by default. If `X_BEARER_TOKEN` is set with `X_FILTER_RULES` or `X_SPACES_QUERY`, it also runs the X filtered stream or Spaces poller. Without connector credentials it runs fixture mode.

`npm run live:doctor` runs the strict connector preflight plus local recording checks for available feed/dashboard/Kick ports, enabled server archive output, and writable archive/database/QA/bundle artifact paths. It exits non-zero on stream-day blockers before you start the capture stack.

`npm run qa:quick` runs the low-usage non-visual gate for active development: repository hygiene, unit/integration tests, lint, production build, connector rehearsal, and live stack rehearsal. It writes `qa/quick-report.md` and `qa/quick-report.json`. Use `npm run qa:final` only when you need the full submission evidence set, including browser workflows, stress rehearsal, and visual QA artifacts.

`npm run preflight` checks the live environment for Twitch, Kick, and X before you start the feed server. It exits non-zero until all three platforms are ready and Kick has a public HTTPS webhook URL for final delivery. When setup is incomplete, it prints a copy-ready `.env` checklist for the missing values. Use `npm run preflight -- --allow-partial` when intentionally testing only one live connector or a local-only Kick receiver.

`npm run live:prepare` prints the same strict readiness check plus the exact final-run feed command, dashboard command, target source labels such as `KICK (MARKETBUBBLE)`, OBS URLs, Kick webhook URL, archive path, database path, proof gate thresholds, post-recording finalizer command, clip-aware bundle command, and replay export commands. Add `--out qa/live-run-plan.txt` to save that exact run sheet for the stream setup. Use `npm run live:prepare -- --allow-partial` for one-platform dry runs only; the printed proof, evidence, finalizer, and bundle commands will include `--allow-partial`.

`npm run obs:handoff -- --out qa/obs` writes `obs-browser-sources.md` and `obs-browser-sources.json` with OBS browser source names, URLs, dimensions, FPS, transparent CSS, and focused Twitch/Kick/X proof shots. Run it after choosing the same `--app-port` used by `live:prepare`.

`npm run live:ready -- --out qa/final-readiness.txt` is the final go/no-go check before opening OBS. It requires strict Twitch/Kick/X preflight, three readable target source labels from `TWITCH_BROADCASTER_LOGIN`, `KICK_BROADCASTER_SLUG`, and X targeting, usable `qa/final-report.json` rehearsal evidence, usable `qa/visual/manifest.*` screenshot evidence, a strict current `qa/live-run-plan.txt` with the launch commands, OBS all-source URL for the current app port, and current evidence commands, valid current-commit `qa/obs` handoff files, and matching OBS all-source URLs between the run sheet and handoff. It accepts an older final QA report when Git shows no final-QA-relevant files changed since that report commit and the current cheap repo hygiene scan still passes. It accepts an older visual QA manifest when Git shows no UI-relevant files changed since that manifest commit, so you do not need to rerun screenshots after server-only, docs-only, or runbook-only changes. It also prints the saved Kick tunnel proof command required after the capture stack starts and the exact `npm run live:stack -- --require-ready --with-proof-gate` command for the final capture. Save the output to keep a timestamped setup proof next to the run sheet. If connector setup is incomplete, it also prints the strict preflight details and `.env` checklist.

`npm run live:stack` runs the same strict doctor check, then starts the feed server and dashboard together with the planned archive, database, ports, and `VITE_FEED_WS_URL` values. Use `npm run live:stack -- --dry-run` to verify the launch plan without starting long-lived processes, or `npm run live:stack -- --allow-partial --dry-run` for one-platform smoke setup only. Add `--require-ready --with-proof-gate` for the final capture stack: it requires the `live:ready` artifact gate before launch, runs the live proof gate beside feed and dashboard, and keeps feed/dashboard running after proof passes or fails.

`npm run live:tunnel -- --out qa/kick-tunnel-check.txt` checks the configured `KICK_WEBHOOK_PUBLIC_URL` after the feed server is running and saves proof for the final submission bundle. It expects the public HTTPS tunnel to return the Kick receiver health payload from `/webhooks/kick`, which catches dead tunnels or URLs pointed at the wrong local service before the OBS recording.

`live:doctor`, `live:prepare`, `live:ready`, and `live:stack` accept `--feed-port`, `--app-port`, `--archive-dir`, `--db`, `--clips`, `--qa-dir`, `--evidence-check`, and `--kick-tunnel-check` overrides. `live:ready` and `live:stack` also accept `--obs-handoff-dir` and `--visual-qa-dir` for custom final artifact folders. `live:prepare` and `live:ready` also accept `--out` for saved run sheets or readiness proof. Use these instead of hand-editing commands when a port, evidence path, clip queue export path, QA artifact folder, or tunnel proof path needs to change right before recording.

The feed server archives every accepted event and connector status update under `data/feed-sessions/<session-id>/` by default. Each session writes `manifest.json`, `events.jsonl`, and `statuses.jsonl`, which gives the submission run a server-side backup even if the browser reloads. Set `FEED_ARCHIVE_DIR` to change the folder or `FEED_ARCHIVE_ENABLED=false` to disable local archives.

Set `FEED_DB_PATH=data/feed.sqlite` to also persist sessions, normalized sources, events, and connector status samples into a queryable SQLite database. Source rows use the same platform/account label shape as the UI, such as `KICK (ANSEM)`, so the final run has durable proof of which account each message came from.

For high-volume fixture proof, set `FEED_INITIAL_EVENT_COUNT=0`, `FEED_FIXTURE_INTERVAL_MS=10`, and `FEED_FIXTURE_BURST_SIZE=25`, or run `npm run qa:stress`. The stress rehearsal drives burst traffic through WebSocket fanout, JSONL archive, SQLite, and evidence metrics.

Gate, check, or convert a server archive:

```bash
npm run proof:gate -- --archive-dir data/feed-sessions --watch --min-events 25 --min-source-labels 3 --max-p95-latency-ms 5000
npm run evidence:check -- --archive-dir data/feed-sessions --db data/feed.sqlite --out qa/evidence-check.txt
npm run submission:bundle -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt
npm run submission:finalize -- --archive-dir data/feed-sessions --db data/feed.sqlite --out submission-bundle --clips clip-queue.json --qa-dir qa --kick-tunnel-check qa/kick-tunnel-check.txt
npm run archive:export -- --archive-dir data/feed-sessions --out replay.json
npm run archive:export -- --archive-dir data/feed-sessions --format csv --out replay.csv
```

The proof gate reads the active JSONL archive while the feed server is still running. Use it before the final OBS capture; it waits for enough events, Twitch/Kick/X coverage, connector status samples, account source labels, and acceptable p95 latency.
Strict proof also requires a connector-mode archive. Fixture-mode archives are accepted only for explicit partial smoke or rehearsal checks.

Set `PROOF_MIN_EVENTS`, `PROOF_MIN_SOURCE_LABELS`, `PROOF_MAX_P95_LATENCY_MS`, `PROOF_TIMEOUT_MS`, and `PROOF_INTERVAL_MS` before `npm run live:prepare` when you want a stricter final capture gate or a longer wait window. The printed proof command will use those same values.

The evidence commands use the newest session in `data/feed-sessions` by default. Pass `--archive data/feed-sessions/<session-id>` instead when you need to inspect an older run. The evidence check validates the archive manifest, parsed events, connector statuses, required Twitch/Kick/X coverage, source labels, ingest duration, throughput, latency, and optional SQLite database rows before you package the final submission.

The submission finalize command is the lowest-mistake post-recording path: it writes `qa/evidence-check.txt`, then builds the bundle. The lower-level bundle command writes `evidence-report.txt`, `replay.json`, `replay.csv`, `submission-notes.md`, and `summary.json` into one folder for the final handoff. If `qa/evidence-check.txt`, `qa/live-run-plan.txt`, `qa/final-readiness.txt`, `qa/final-report.md`, `qa/final-report.json`, `qa/obs/obs-browser-sources.*`, `qa/visual/manifest.*`, or `qa/kick-tunnel-check.txt` exists, it also copies them into the bundle. Pass `--evidence-out <path>` to `submission:finalize` or `--evidence-check <path>` to `submission:bundle` when the saved proof lives outside `qa/evidence-check.txt`. Pass `--clips clip-queue.json` after exporting the dashboard clip queue to copy and summarize the marked submission moments as `clip-queue.json`. Strict final bundles reject missing or non-ready saved evidence proof, stale final QA reports when final-QA-relevant files changed, current repo hygiene failures after an older final QA report, missing or stale final-readiness proof, partial run sheets, saved run sheets from a different commit, run sheets missing launch or evidence commands, OBS handoff files from a different commit, missing or malformed OBS handoff files, stale visual QA manifest files when UI-relevant files changed, missing or malformed visual QA manifest files, missing or stale Kick tunnel proof, missing or malformed clip queue exports when `--clips` is provided, and OBS handoff URLs that do not match the run sheet. Regenerate `qa/evidence-check.txt`, `qa/live-run-plan.txt`, `qa/final-readiness.txt`, `qa/obs/`, and `qa/kick-tunnel-check.txt` after the final commit, port change, proof-threshold change, or evidence path change. Regenerate `qa/final-report.*` after source, script, e2e, config, or dependency changes. Regenerate `qa/visual/` only after UI-relevant changes such as `src/App.tsx`, `src/styles.css`, route/fixture/protocol changes, or visual capture script changes. The notes file gives a human-readable proof summary, repo commit, clip queue summary, and external artifact checklist, while the JSON summary keeps platform counts, source labels, throughput, latency metrics, evidence-check proof path, run-sheet paths, final-readiness proof path, OBS handoff paths, visual QA manifest paths, Kick tunnel proof path, clip queue path, and repo metadata from the recorded run.

Kick live setup:

```bash
KICK_WEBHOOK_ENABLED=true npm run feed
```

Expose `http://127.0.0.1:8788/webhooks/kick` through Cloudflare Tunnel, ngrok, or another public tunnel, then use that public URL in the Kick Developer app webhook settings. To have the feed server request a chat subscription on startup, set `KICK_ACCESS_TOKEN`, `KICK_BROADCASTER_USER_ID`, and `KICK_SUBSCRIBE_ON_START=true`.
When the feed server is running, the Kick webhook path responds to `GET` and `HEAD` with a safe receiver health check. Use the `tunnel health check` command from `npm run live:prepare` to verify the public tunnel reaches the local receiver and write `qa/kick-tunnel-check.txt` before the final recording.

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
For stream-day setup files, run `npm run obs:handoff -- --out qa/obs` and add `Unified Chat - All Sources` as the primary OBS browser source.

During a recording, scroll the feed to inspect older messages. The toolbar switches from `Live` to `Jump live` so you can return to the newest events immediately. Use the `Newest first` / `Oldest first` control to switch between live monitoring and chronological replay review.

Feed rows label both platform and account/channel, for example `TWITCH (ANSEM)`, `KICK (MARKETBUBBLE)`, or `X (@USER1337)`.

The diagnostics rail includes an `Accounts` roster with live source-account activity, event counts, signal counts, and one-click filters. The `Identities` panel groups matching source accounts across platforms, such as `TWITCH (ANSEM)` and `KICK (ANSEM)`, into a focused search. Selecting a row opens author/source diagnostics with the platform account, author handle, badge stack, buffer counts, signal score, and platform IDs. From there, the operator can filter to the selected source account or selected author without changing the search box. This makes it easier to prove where a clipped message came from during the final submission recording.

The `Review queue` flags held, deleted, or spam-risk messages when those signals are present in normalized events. It gives the operator a quick way to inspect questionable chat without mutating the platform.

The `Clip queue` lets the operator mark selected messages during the stream. Marked clips preserve the full normalized event, source-account label, and clip timestamp, stay visible in the run-proof strip, survive a browser refresh through local storage, and can be exported as a separate JSON file for choosing the best submission moments after the recording.

The diagnostics rail includes a `Performance` panel with current buffer throughput, average latency, p95 latency, and latest event freshness for visible proof during the recording.

The diagnostics rail includes a `Submission checklist` panel that tracks whether the current run has live WebSocket transport, Twitch/Kick/X coverage, account-qualified source labels, active recording proof, and visible performance metrics before the final capture.

The feed panel includes a compact `Run proof` strip for dashboard, submission, and OBS captures. It keeps transport state, platform coverage, account-label count, p95 latency, recording count, and clip count visible even when operator rails are hidden.

The diagnostics rail includes a `Readiness` panel. In fixture mode it shows the exact connector env vars and public webhook setup still needed for Twitch, Kick, and X before a real stream recording.

Use `Save current buffer` to persist the current in-browser feed buffer to local sessions. The app keeps the latest 12 saved sessions and can load any saved session back into replay mode without needing a JSON file.

Recordings can be exported as JSON for replay or CSV for spreadsheet review.

Clip queues can be exported as JSON for a compact list of the exact marked messages to use in the final submission edit.

Use `Import recording JSON` to load a previous export back into the dashboard as replay mode. This is useful for rehearsing or recording the submission if a live connector is unavailable.

Use `Copy replay link` to create a local read-only replay URL for the current buffer. Opening that URL loads replay mode immediately, which is useful for handing a proof clip to another reviewer on the same app build.

Verification:

```bash
npm run qa:repo
npm test
npm run test:e2e
npm run lint
npm run build
```

Visual QA screenshots:

```bash
npm run qa:visual
```

This writes desktop, mobile, and OBS overlay captures to `qa/visual/`, plus `qa/visual/manifest.md` and `qa/visual/manifest.json` with routes, viewport sizes, file sizes, and repo metadata.
Do this after UI-relevant changes. If the latest visual manifest is from an older commit but only server, docs, runbook, or packaging files changed afterward, `live:ready` and `submission:bundle` can reuse it.

Final stack rehearsal:

```bash
npm run qa:final
```

This runs repository hygiene, tests, lint, build, browser workflows, connector rehearsal, live stack rehearsal, stress rehearsal, and visual QA in submission order. It writes durable proof artifacts to `qa/final-report.md` and `qa/final-report.json`.

Individual rehearsal commands:

```bash
npm run qa:connectors
npm run qa:rehearsal
npm run qa:stress
```

The connector rehearsal runs the real feed server against local Twitch EventSub, Kick webhook, and X API mocks, then validates unified feed output and durable archive evidence under `qa/connectors/`. The live-stack rehearsal starts the feed server and dashboard on alternate local ports, verifies the browser is reading from `VITE_FEED_WS_URL`, and confirms server archive output under `qa/rehearsal/`. The stress run records high-volume proof under `qa/stress/` and fails if throughput or p95 latency miss the configured thresholds.

## Docs

- [Scope](docs/scope.md)
- [Platform Research](docs/platform-research.md)
- [Architecture Plan](docs/architecture-plan.md)
- [Execution Roadmap](docs/execution-roadmap.md)
- [Final UI Handoff](docs/final-ui-handoff.md)
- [Storage Schema](docs/storage-schema.sql)
- [Submission Runbook](docs/submission-runbook.md)
- [Winning Strategy](docs/winning-strategy.md)
