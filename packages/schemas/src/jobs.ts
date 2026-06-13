import { z } from 'zod';
import { JOB_STATUSES, jobStatusSchema } from './graph.js';

/**
 * Durable jobs API shapes (US-007). The `jobs` table is canonical-adjacent
 * operational state (no soft-delete); these schemas describe the public,
 * serializable view exposed by the admin/status API and the query filters it
 * accepts. Timestamps are ISO-8601 strings on the wire.
 */
export const publicJobSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string().nullable(),
  type: z.string(),
  status: jobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAfter: z.string(),
  payload: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  failureReason: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicJob = z.infer<typeof publicJobSchema>;

/** Query filters accepted by `GET /api/jobs`. */
export const jobListQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  knowledgeBaseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

/** Per-status job counts returned by `GET /api/jobs/stats`. */
export const jobStatsSchema = z.object(
  Object.fromEntries(JOB_STATUSES.map((s) => [s, z.number().int().nonnegative()])) as Record<
    (typeof JOB_STATUSES)[number],
    z.ZodNumber
  >,
);
export type JobStats = z.infer<typeof jobStatsSchema>;
