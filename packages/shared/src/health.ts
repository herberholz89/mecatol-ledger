import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  database: z.enum(['ok', 'error']),
  factionCount: z.number().int().nonnegative().nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
