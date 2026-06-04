# Winning Strategy

## Core Position

The product should not feel like a generic log viewer. It should feel like Twitch, Kick, and X are being watched directly in one place.

The differentiator is:

- Unified chronological feed
- Native-feeling source rows
- Source labels that remain obvious
- Real connector health proof
- Recording/submission mode for a clean demo video
- OBS browser-source mode for direct stream overlay capture

## UX Direction

### Twitch

- Purple accent
- Chat-room density
- Badge strip
- Username color support
- Channel metadata shown as `#channel`

### Kick

- Green accent
- Black/green chat-room feel
- Username color support
- Badges and source channel visible

### X

- Post-card feel inside the unified stream
- Author rendered as `@handle`
- `filtered post` and `live Space` metadata
- Higher-latency source treatment is acceptable because X filtered stream is near-real-time, not chat-native

## Submission Flow

The app should support a clean recording workflow:

1. Open the dashboard.
2. Start recording.
3. Toggle submission mode to hide operator rails.
4. Let the live or fixture feed run.
5. Export recording JSON for proof/replay.
6. Capture a screen recording for the challenge submission.

Live transport for recording:

```bash
npm run feed
VITE_FEED_WS_URL=ws://127.0.0.1:8787 npm run dev
```

OBS browser source URL:

```text
http://127.0.0.1:5173/?obs=1
```

This mode starts in submission layout, hides operator controls, and uses a transparent page background so it can sit over the Market Bubble stream recording.

## Real Stream Priority

For a live Market Bubble stream, prioritize connectors in this order:

1. Twitch EventSub WebSocket
2. X filtered stream and Spaces lookup
3. Kick webhook receiver, which needs a public tunnel

The app should always remain demoable if one platform lacks credentials.

Kick setup for recording:

1. Run the feed server with `KICK_WEBHOOK_ENABLED=true`.
2. Expose `http://127.0.0.1:8788/webhooks/kick` through a tunnel.
3. Put that public tunnel URL in the Kick Developer app webhook settings.
4. If `KICK_ACCESS_TOKEN`, `KICK_BROADCASTER_USER_ID`, and `KICK_SUBSCRIBE_ON_START=true` are set, let the feed server request `chat.message.sent` on startup.
