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

- Twitch EventSub WebSocket connector
- Kick webhook receiver and subscription helper
- X filtered stream connector
- X Spaces lookup/search poller
- Connector health model
- Dedupe and replay buffer

## Phase 3 - Storage And Sessions

- Add database schema
- Store sources, sessions, events, connector runs
- Add session capture/replay
- Add export to JSON/CSV
- Add event retention settings

## Phase 4 - Operator UX

- Source filter
- Pause/resume/jump to live
- Search and keyword highlight
- Signal mode scoring
- Author detail drawer
- Connector diagnostics
- Credential missing states

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

1. Add server-side connector package boundaries.
2. Implement Twitch EventSub WebSocket connector.
3. Implement Kick webhook receiver and signature verification.
4. Implement X filtered stream connector and Spaces lookup poller.
5. Add durable storage for captured sessions and exports.
