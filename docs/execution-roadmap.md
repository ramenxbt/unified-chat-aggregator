# Execution Roadmap

## Phase 0 - Repo And Product Contract

- Create GitHub repo under `ramenxbt`
- Commit research and scope docs
- Decide final stack
- Define env var contract
- Define normalized event schema

## Phase 1 - Skeleton

- Scaffold TypeScript app
- Add lint, typecheck, test, and formatting scripts
- Add normalized event package/module
- Add fixture connector
- Build local feed transport
- Render basic dashboard from fixture stream

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

1. Resolve GitHub CLI auth for `ramenxbt`.
2. Create remote repo and push this planning commit.
3. Scaffold the TypeScript project.
4. Implement normalized event schema and fixture connector.
5. Build the first live feed UI against fixtures.
