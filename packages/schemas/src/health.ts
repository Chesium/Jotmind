import { z } from 'zod';

/**
 * Shared health-check response schema, imported by both the API (to validate
 * outgoing responses) and the web app (to validate incoming responses).
 */
export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
