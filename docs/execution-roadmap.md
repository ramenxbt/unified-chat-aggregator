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

- Add database schema
- Store sources, sessions, events, connector runs
- Add session capture/replay
- Add export to JSON/CSV
- [x] Add recording JSON import/viewer
- Add event retention settings

## Phase 4 - Operator UX

- [x] Source filter
- [x] Pause/resume
- [x] Jump to live
- [x] Search and keyword highlight
- [x] Signal mode scoring
- Author detail drawer
- [x] Connector diagnostics
- Credential missing states
- [x] Recording controls
- [x] Submission mode
- [x] OBS browser source mode

## Phase 5 - Hardening

- Backpressure tests
- Reconnect tests
- [x] Webhook verification tests
- Fixture replay tests
- Browser UI checks
- README setup guide

## Phase 6 - Final UI Pass

- Hand stable functional app into final UI polish
- Preserve all functional states
- Visual QA desktop and mobile
- Capture final screenshots/GIF
- Prepare submission notes

## Immediate Next Tasks

1. Run Twitch EventSub, Kick webhooks, and X connector paths with real stream credentials.
2. Expose the Kick webhook endpoint through a public tunnel for the Market Bubble stream.
3. Add durable storage for captured sessions and exports.
4. Add final UI polish pass after live connector proof.
5. Capture final submission video through OBS mode.
