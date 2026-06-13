import { Router } from 'express';
import {
  jobListQuerySchema,
  jobStatsSchema,
  publicJobSchema,
  type PublicJob,
} from '@jotmind/schemas';
import { asyncHandler, requireAdmin, requireAuth } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import type { JobRow } from '../db/schema.js';
import { dbJobStore, type JobStore } from './store.js';

export type { JobStore, EnqueueJobInput, ListJobsFilter } from './store.js';
export { dbJobStore } from './store.js';
export {
  computeBackoffMs,
  runNextJob,
  processAvailableJobs,
  runWorkerLoop,
  startInProcessWorker,
  type JobHandler,
  type JobHandlerRegistry,
} from './worker.js';

/** Serialize a canonical job row into the public API shape (ISO timestamps). */
export function toPublicJob(job: JobRow): PublicJob {
  return publicJobSchema.parse({
    id: job.id,
    knowledgeBaseId: job.knowledgeBaseId,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter.toISOString(),
    payload: job.payload ?? {},
    result: job.result ?? null,
    failureReason: job.failureReason,
    ownerUserId: job.ownerUserId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}

export interface JobsRouterOptions {
  store?: JobStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/jobs` admin/status router (US-007 AC4). All endpoints require
 * an authenticated system **admin** (mirrors the projection admin endpoints):
 *   - `GET /`       — list jobs, optional `?status` / `?knowledgeBaseId` / `?limit`.
 *   - `GET /stats`  — per-status job counts.
 *   - `GET /:id`    — a single job (404 if unknown).
 */
export function createJobsRouter(options: JobsRouterOptions = {}): Router {
  const store = options.store ?? dbJobStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router();
  const authed = requireAuth(authStore);

  router.get(
    '/',
    authed,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const parsed = jobListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });
        return;
      }
      const rows = await store.list(parsed.data);
      res.json({ jobs: rows.map(toPublicJob) });
    }),
  );

  router.get(
    '/stats',
    authed,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const counts = await store.countByStatus();
      res.json(jobStatsSchema.parse(counts));
    }),
  );

  router.get(
    '/:id',
    authed,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const job = await store.getById(req.params.id as string);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(toPublicJob(job));
    }),
  );

  return router;
}
