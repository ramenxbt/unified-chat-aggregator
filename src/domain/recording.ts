import { z } from "zod";
import { unifiedEventSchema } from "./unifiedEvent";

export const recordingExportSchema = z.object({
  exportedAt: z.string().datetime(),
  source: z.string(),
  transportState: z.string().optional(),
  eventCount: z.number().int().nonnegative(),
  events: z.array(unifiedEventSchema)
});

export type RecordingExport = z.infer<typeof recordingExportSchema>;
