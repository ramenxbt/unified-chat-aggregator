# AGENTS.md

## Project Mission

Build a competition-grade unified live feed for Twitch, Kick, and X. Optimize for real connectors, resilient ingestion, a clean operator workflow, and a strong demo mode.

## Working Order

1. Research platform constraints before connector work.
2. Keep source connectors isolated behind a common event contract.
3. Build fixture/demo mode for every platform before relying on credentials.
4. Verify with tests and browser checks before calling a phase done.
5. Defer final visual polish until the functional app is stable.

## Technical Defaults

- TypeScript-first.
- Server owns all platform credentials.
- Store raw payloads for debugging, but render normalized events.
- Never depend on private or scraped X endpoints.
- Preserve official platform IDs for dedupe.

## UI Defaults

- Dense operator dashboard.
- Clear source labels.
- Visible connector health.
- No marketing landing page.
- Final UI polish happens after connector and feed behavior are proven.

