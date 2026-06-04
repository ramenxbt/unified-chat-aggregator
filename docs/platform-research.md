# Platform Research

Research date: 2026-06-04

## Twitch

Best path: EventSub WebSocket for chat messages.

Useful official facts:

- Twitch says EventSub subscriptions support Webhook, WebSocket, and Conduits transports.
- Twitch recommends EventSub and Twitch API as the preferred method for viewing and sending chat, while IRC remains historical and feature-limited.
- `channel.chat.message` requires `broadcaster_user_id` and `user_id`.
- Channel Chat Message events include broadcaster info, chatter info, `message_id`, plain text, and ordered fragments for text, cheermotes, emotes, and mentions.
- EventSub notifications are at-least-once, so message IDs must be tracked for deduplication.
- EventSub WebSocket sends a welcome message with the session ID. By default, a subscription must be created within 10 seconds.
- On disconnect, there is no replay for lost events after reconnect. Reconnect messages provide a `reconnect_url` that should be used before closing the old socket.
- Twitch concurrent join limits matter. The docs list a 100 channel join limit for a single user account, with exceptions when authorized by the broadcaster using app access token plus `channel:bot`.

Implementation notes:

- Prefer EventSub WebSocket over IRC for the main connector.
- Keep IRC as an optional fallback only if EventSub permissions block a demo.
- Persist Twitch `message_id` for dedupe.
- Preserve fragments so emotes can be rendered later.
- Model reconnect as a first-class state.

Sources:

- https://dev.twitch.tv/docs/eventsub/
- https://dev.twitch.tv/docs/eventsub/handling-websocket-events
- https://dev.twitch.tv/docs/chat
- https://dev.twitch.tv/docs/eventsub/eventsub-reference/

## Kick

Best path: Events API webhook subscription for `chat.message.sent`.

Useful official facts:

- Kick Public API has Chat APIs for sending/deleting chat messages.
- Real-time receiving is handled by the Events API using webhooks.
- Events API can send real-time updates such as chat messages to the app.
- Webhook URL must be publicly accessible. Localhost requires a tunnel such as Cloudflare Tunnel or ngrok.
- Event subscription endpoint is `/public/v1/events/subscriptions`.
- `chat.message.sent` has version `1` and fires when a message is sent in a stream chat.
- Subscription limit is 10,000 per event type for a single app, with `chat.message.sent` limited to 1,000 for unverified apps.
- Kick chat payload includes `message_id`, optional `replies_to`, broadcaster, sender, content, emotes, identity badges, username color, and `created_at`.
- Kick OAuth supports App Access Tokens via client credentials and User Access Tokens via authorization code.
- Required scope for event subscriptions is `events:subscribe`.

Implementation notes:

- Use a webhook receiver service and verify webhook signatures/public key before accepting events.
- Provide a local tunnel setup guide.
- Persist Kick `message_id` for dedupe.
- Preserve emote positions and badge metadata.
- Treat Kick as webhook-based rather than WebSocket-based.

Sources:

- https://docs.kick.com/
- https://docs.kick.com/apis/chat
- https://docs.kick.com/events/introduction
- https://docs.kick.com/events/subscribe-to-events
- https://docs.kick.com/events/event-types
- https://docs.kick.com/getting-started/generating-tokens-oauth2-flow
- https://docs.kick.com/getting-started/scopes

## X

Best path: Filtered Stream for near-real-time public posts, plus Spaces lookup/search metadata.

Useful official facts:

- X API v2 provides public conversation access through pay-per-use plans.
- Filtered Stream delivers near-real-time posts matching filter rules.
- Filtered Stream latency is documented around 6-7 seconds P99; lower latency is enterprise Powerstream.
- Standard tier lists 1,000 rules, 1,024 character rule length, and one connection.
- Stream rules can match keywords, hashtags, users, phrases, and other operators.
- Stream sends blank keep-alive lines every 20 seconds. If data or keep-alive is not received, reconnect.
- Stream Connections endpoints can inspect active/historical connections and terminate duplicates.
- Spaces API supports lookup and search for live or scheduled Spaces.
- Spaces become unavailable after they end, so stored Spaces data must be refreshed/removed to respect platform lifecycle.
- Spaces listener information is returned as aggregate participant count, not a listener list.

Implementation notes:

- Do not claim X live/Spaces chat if the official API does not provide it.
- Represent X source as `post` or `space_metadata`, not `chat`, unless tracking replies around a configured live event.
- Use Filtered Stream rules for accounts, hashtags, cashtags, URLs, and reply tracking.
- Use Spaces Search/Lookup for discovery, title, state, host IDs, speaker IDs, started/scheduled time, and participant count.
- Enforce one streaming connection in standard mode.

Sources:

- https://docs.x.com/x-api/overview
- https://docs.x.com/x-api/posts/filtered-stream/introduction
- https://docs.x.com/x-api/connections/introduction
- https://docs.x.com/x-api/spaces/introduction
- https://docs.x.com/x-api/spaces/search/introduction
- https://docs.x.com/x-api/spaces/search-spaces

## Real-Time Aggregator Architecture Research

General best practices for this class of app:

- Isolate each platform connector behind a common adapter contract.
- Normalize incoming events into a platform-agnostic envelope, but keep raw payload for audit/debug.
- Use durable queue or append-only event log between ingestion and UI broadcast.
- Deduplicate at the ingestion boundary by platform event/message ID.
- Handle backpressure explicitly: bounded buffers, drop policies for fixture/demo mode, and persistent backlog for production mode.
- Track connector state: connecting, live, reconnecting, degraded, rate-limited, unauthorized, stopped.
- Broadcast to browser clients via WebSocket or Server-Sent Events.
- Keep platform credentials server-side only.
- Build demo fixtures so judges can evaluate without credentials.

