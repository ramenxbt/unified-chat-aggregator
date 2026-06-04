import { z } from "zod";
import { connectorStatusSchema, unifiedEventSchema } from "../domain/unifiedEvent";

export const feedServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    events: z.array(unifiedEventSchema),
    statuses: z.array(connectorStatusSchema),
    generatedAt: z.string().datetime()
  }),
  z.object({
    type: z.literal("event"),
    event: unifiedEventSchema
  }),
  z.object({
    type: z.literal("status"),
    status: connectorStatusSchema
  }),
  z.object({
    type: z.literal("heartbeat"),
    generatedAt: z.string().datetime()
  })
]);

export type FeedServerMessage = z.infer<typeof feedServerMessageSchema>;

