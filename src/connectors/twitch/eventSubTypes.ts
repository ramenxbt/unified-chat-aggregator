import { z } from "zod";

export const twitchEventSubMessageSchema = z.object({
  metadata: z.object({
    message_id: z.string(),
    message_type: z.enum([
      "session_welcome",
      "session_keepalive",
      "session_reconnect",
      "notification",
      "revocation"
    ]),
    message_timestamp: z.string(),
    subscription_type: z.string().optional(),
    subscription_version: z.string().optional()
  }),
  payload: z.unknown()
});

export const twitchSessionPayloadSchema = z.object({
  session: z.object({
    id: z.string(),
    status: z.string(),
    connected_at: z.string(),
    keepalive_timeout_seconds: z.number().optional(),
    reconnect_url: z.string().optional()
  })
});

export const twitchChatFragmentSchema = z.object({
  type: z.string(),
  text: z.string(),
  cheermote: z.unknown().nullable().optional(),
  emote: z
    .object({
      id: z.string(),
      emote_set_id: z.string().optional(),
      owner_id: z.string().optional(),
      format: z.array(z.string()).optional()
    })
    .nullable()
    .optional(),
  mention: z
    .object({
      user_id: z.string(),
      user_name: z.string(),
      user_login: z.string()
    })
    .nullable()
    .optional()
});

export const twitchChatMessageEventSchema = z.object({
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
  chatter_user_id: z.string(),
  chatter_user_login: z.string(),
  chatter_user_name: z.string(),
  message_id: z.string(),
  message: z.object({
    text: z.string(),
    fragments: z.array(twitchChatFragmentSchema)
  }),
  color: z.string().optional(),
  badges: z
    .array(
      z.object({
        set_id: z.string(),
        id: z.string(),
        info: z.string().optional()
      })
    )
    .default([])
});

export const twitchChatNotificationPayloadSchema = z.object({
  subscription: z.object({
    id: z.string(),
    type: z.literal("channel.chat.message"),
    version: z.string(),
    condition: z.object({
      broadcaster_user_id: z.string(),
      user_id: z.string()
    }),
    transport: z.object({
      method: z.literal("websocket"),
      session_id: z.string()
    })
  }),
  event: twitchChatMessageEventSchema
});

export type TwitchEventSubMessage = z.infer<typeof twitchEventSubMessageSchema>;
export type TwitchChatMessageEvent = z.infer<typeof twitchChatMessageEventSchema>;

