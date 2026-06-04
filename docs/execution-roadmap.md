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
- [ ] Twitch EventSub live auth/session run
- Kick webhook receiver and subscription helper
- X filtered stream connector
- X Spaces lookup/search poller
- [x] Connector health model
- [x] Dedupe and replay buffer
- [x] Local feed WebSocket fanout

## Phase 3 - Storage And Sessions

- Add database schema
- Store sources, sessions, events, connector runs
- Add session capture/replay
- Add export to JSON/CSV
- Add event retention settings

## Phase 4 - Operator UX

- [x] Source filter
- [x] Pause/resume
- [ ] Jump to live
- [x] Search and keyword highlight
- [x] Signal mode scoring
- Author detail drawer
- [x] Connector diagnostics
- Credential missing states
- [x] Recording controls
- [x] Submission mode

## Phase 5 - Hardening

- Backpressure tests
- Reconnect tests
- Webhook verification tests
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

1. Wire Twitch EventSub connector into the feed server with real credentials.
2. Implement X filtered stream connector and Spaces lookup poller.
3. Implement Kick webhook receiver and signature verification.
4. Add durable storage for captured sessions and exports.
5. Add replay import/viewer for recorded JSON.
