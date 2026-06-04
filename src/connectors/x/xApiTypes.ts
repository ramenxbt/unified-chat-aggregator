import { z } from "zod";

export const xPostSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().optional(),
  conversation_id: z.string().optional(),
  edit_history_tweet_ids: z.array(z.string()).optional()
});

export const xUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  username: z.string().optional(),
  profile_image_url: z.string().url().optional(),
  verified: z.boolean().optional()
});

export const xFilteredStreamPayloadSchema = z.object({
  data: xPostSchema,
  includes: z
    .object({
      users: z.array(xUserSchema).optional()
    })
    .optional(),
  matching_rules: z
    .array(
      z.object({
        id: z.string(),
        tag: z.string().optional()
      })
    )
    .optional()
});

export const xRulesResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        value: z.string(),
        tag: z.string().optional()
      })
    )
    .optional()
});

export const xSpaceSchema = z.object({
  id: z.string(),
  state: z.enum(["live", "scheduled", "all"]).or(z.string()),
  title: z.string().optional(),
  creator_id: z.string().optional(),
  host_ids: z.array(z.string()).optional(),
  speaker_ids: z.array(z.string()).optional(),
  participant_count: z.number().optional(),
  subscriber_count: z.number().optional(),
  scheduled_start: z.string().optional(),
  started_at: z.string().optional(),
  updated_at: z.string().optional()
});

export const xSpacesSearchResponseSchema = z.object({
  data: z.array(xSpaceSchema).optional(),
  includes: z
    .object({
      users: z.array(xUserSchema).optional()
    })
    .optional(),
  meta: z
    .object({
      result_count: z.number().optional()
    })
    .optional()
});

export type XFilteredStreamPayload = z.infer<typeof xFilteredStreamPayloadSchema>;
export type XSpace = z.infer<typeof xSpaceSchema>;
export type XUser = z.infer<typeof xUserSchema>;
