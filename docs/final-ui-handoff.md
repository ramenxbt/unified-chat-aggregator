# Final UI Handoff

Use this contract for the final visual polish pass. The app is functionally stable; polish should improve hierarchy, spacing, motion, and finish without changing the recording workflow or connector behavior.

## Must Preserve

- Unified feed with newest-first and oldest-first order controls.
- Platform plus account labels such as `TWITCH (ANSEM)`, `KICK (MARKETBUBBLE)`, and `X (@USER1337)`.
- Search across message text, author, source account, platform, and event kind.
- Source toggles for Twitch, Kick, and X.
- Source account activity roster with one-click filters.
- Cross-platform source identity grouping for matching account names.
- Review queue for held, deleted, or spam-risk normalized events.
- Clip queue for marking exact submission moments with source-account labels.
- Performance panel with buffer throughput, average latency, p95 latency, and latest event freshness.
- Submission checklist for live transport, platform coverage, account labels, recording proof, and performance proof.
- Feed-panel `Run proof` strip visible in dashboard, submission, and OBS captures, including clip count.
- Signal mode.
- Pause, resume, clear, order toggle, and jump-live behavior.
- Recording start/stop, JSON export, CSV export, and clip queue JSON export.
- Import recording JSON into replay mode and exit replay.
- Copy replay link and hash-based replay loading.
- Local session save, load, delete, and 12-session retention.
- Connector cards with state, event count, drops, latency, label, and source account.
- Readiness panel with missing env vars and Kick tunnel guidance.
- Author and selected-event diagnostics with raw IDs.
- OBS preset links in the diagnostics rail.
- OBS handoff generation through `npm run obs:handoff`.
- Submission mode hiding operator rails.
- OBS route at `/?obs=1`, including `sources`, `q`, `signal`, and `limit` URL presets.
- Transparent OBS body background.
- Dashboard transport via `VITE_FEED_WS_URL`.
- Server archive and archive export flows.

## Routes And States To Check

Dashboard:

```text
http://127.0.0.1:5173/
```

OBS all-source overlay:

```text
http://127.0.0.1:5173/?obs=1&sources=twitch,kick,x&limit=14
```

Focused proof overlay:

```text
http://127.0.0.1:5173/?obs=1&sources=twitch&limit=8&q=ansem
```

Signal overlay:

```text
http://127.0.0.1:5173/?obs=1&signal=1&limit=10
```

Live transport rehearsal:

```bash
npm run qa:rehearsal
```

## Visual Direction

- Keep the dashboard dense and operator-focused.
- Make rows feel native to each source: Twitch purple chat density, Kick green chat density, X post/card treatment.
- Keep source labels highly legible in every row.
- Keep diagnostics compact but readable.
- Keep buttons icon-led and utilitarian.
- Avoid marketing-page composition, hero sections, decorative blobs, or oversized empty space.
- Do not obscure source labels, author names, timestamps, badges, or message text.

## Required Gates After Polish

Run these before declaring the final UI pass ready:

```bash
npm test
npm run test:e2e
npm run qa:visual
npm run qa:rehearsal
npm run qa:stress
npm run lint
npm run build
npm audit --audit-level=moderate
```

Inspect these generated screenshots:

```text
qa/visual/desktop-dashboard.png
qa/visual/mobile-dashboard.png
qa/visual/obs-overlay.png
```

## Known Live-Only Requirements

These cannot be closed without real credentials and a public Kick tunnel:

- Twitch EventSub live auth/session run.
- Kick webhook delivery from a public URL.
- X API live filtered stream or Spaces query proof.
- Final Market Bubble stream recording.
