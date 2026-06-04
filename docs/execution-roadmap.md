# Execution Roadmap

## Phase 0 - Repo And Product Contract

- [x] Create GitHub repo under `ramenxbt`
- [x] Commit research and scope docs
- [x] Decide final stack for first build
- [x] Define env var contract
- [x] Define normalized event schema

## Phase 1 - Skeleton

- [x] Scaffold TypeScript app
- [x] Add lint, typecheck, test, and build scripts
- [x] Add normalized event package/module
- [x] Add fixture connector
- [x] Build local fixture feed transport
- [x] Render basic dashboard from fixture stream

## Phase 2 - Real Connectors

- [x] Twitch EventSub WebSocket connector scaffold
- [x] Feed server env path for Twitch EventSub connector
- [ ] Twitch EventSub live auth/session run
- [x] Kick webhook receiver and subscription helper
- [x] X filtered stream connector
- [x] X Spaces lookup/search poller
- [x] Connector health model
- [x] Dedupe and replay buffer
- [x] Local feed WebSocket fanout

## Phase 3 - Storage And Sessions

- [x] Add database schema
- [x] Add server archive for sessions, events, and connector status runs
- [ ] Store normalized sources in durable database backend
- [x] Add local session capture/replay
- [x] Add export to JSON/CSV
- [x] Add recording JSON import/viewer
- [x] Add local session retention cap

## Phase 4 - Operator UX

- [x] Source filter
- [x] Pause/resume
- [x] Jump to live
- [x] Newest-first and oldest-first feed order
- [x] Search and keyword highlight
- [x] Source account and author quick filters
- [x] Source account activity roster
- [x] Cross-platform source identity grouping
- [x] Signal mode scoring
- [x] Author detail drawer
- [x] Connector diagnostics
- [x] Credential missing states
- [x] Recording controls
- [x] Submission mode
- [x] OBS browser source mode

## Phase 5 - Hardening

- [x] Backpressure tests
- [x] Reconnect tests
- [x] Webhook verification tests
- [x] Fixture replay tests
- [x] Browser UI checks
- [x] README setup guide

## Phase 6 - Final UI Pass

- [x] Hand stable functional app into final UI polish
- [x] Preserve all functional states
- [x] Visual QA desktop and mobile
- [x] Capture final screenshots/GIF
- [x] Prepare submission notes

## Immediate Next Tasks

1. Run `npm run preflight` with real Twitch, Kick, and X stream credentials.
2. Run Twitch EventSub, Kick webhooks, and X connector paths with real stream credentials.
3. Expose the Kick webhook endpoint through a public tunnel for the Market Bubble stream.
4. Store normalized sources in a durable database backend after live connector proof.
5. Add final UI polish pass after live connector proof.
6. Capture final submission video through OBS mode.
