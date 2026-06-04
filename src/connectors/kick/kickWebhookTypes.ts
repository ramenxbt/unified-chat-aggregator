import { z } from "zod";

export const kickWebhookHeadersSchema = z.object({
  messageId: z.string().min(1),
  subscriptionId: z.string().optional(),
  signature: z.string().min(1),
  timestamp: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.string().min(1)
});

export const kickIdentityBadgeSchema = z.object({
  text: z.string(),
  type: z.string(),
  count: z.number().optional()
});

export const kickUserIdentitySchema = z
  .object({
    username_color: z.string().optional(),
    badges: z.array(kickIdentityBadgeSchema).optional()
  })
  .nullable()
  .optional();

export const kickUserSchema = z.object({
  is_anonymous: z.boolean().optional(),
  user_id: z.number().nullable().optional(),
  username: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  profile_picture: z.string().nullable().optional(),
  channel_slug: z.string().nullable().optional(),
  identity: kickUserIdentitySchema
});

export const kickChatMessagePayloadSchema = z.object({
  message_id: z.string(),
  replies_to: z
    .object({
      message_id: z.string(),
      content: z.string().optional(),
      sender: kickUserSchema.optional()
    })
    .nullable()
    .optional(),
  broadcaster: kickUserSchema,
  sender: kickUserSchema,
  content: z.string(),
  emotes: z
    .array(
      z.object({
        emote_id: z.string(),
        positions: z.array(
          z.object({
            s: z.number(),
            e: z.number()
          })
        )
      })
    )
    .optional(),
  created_at: z.string().optional()
});

export type KickChatMessagePayload = z.infer<typeof kickChatMessagePayloadSchema>;
export type KickUser = z.infer<typeof kickUserSchema>;
export type KickWebhookHeaders = z.infer<typeof kickWebhookHeadersSchema>;
