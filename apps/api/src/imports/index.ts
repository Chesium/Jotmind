import { Router, type RequestHandler } from 'express';
import {
  IMPORT_JOB_TYPE,
  importEnqueueResponseSchema,
  importRequestSchema,
  kbRoleSatisfies,
  publicJobSchema,
  type ImportEnqueueResponse,
  type KbRole,
  type PublicJob,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbJobStore, type JobStore } from '../jobs/store.js';
import type { JobRow } from '../db/schema.js';

export { runImport, type ImportRunnerDeps } from './runner.js';

/** Serialize a job row into the public, user-visible shape (ISO timestamps). */
function toPublicJob(job: JobRow): PublicJob {
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

export interface ImportRouterOptions {
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  jobStore?: JobStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/imports` router (US-031). Mounted with
 * `mergeParams: true`, AFTER the KB router. Non-members get 404 to hide
 * existence (mirrors the entity/claim routers).
 *
 * - `GET /`  — list this KB's import jobs (viewer+) so users can watch their
 *              import status + failure details (AC4). User-visible (unlike the
 *              system-admin `/api/jobs` endpoint).
 * - `POST /` — enqueue a durable import job (AC4). Restricted to `editor`+ (so
 *              the resulting proposed mutations are editor/admin/owner-only,
 *              AC5) + CSRF. The job parses the payload into a reviewable
 *              proposal (AC3); nothing mutates the graph until the proposal is
 *              accepted (US-018). Returns 202 + the job id.
 */
export function createImportRouter(options: ImportRouterOptions = {}): Router {
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const jobStore = options.jobStore ?? dbJobStore;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);

  function requireKbRole(min: KbRole): RequestHandler {
    return asyncHandler(async (req, res, next) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId;
      if (!kbId) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      const role = await kbStore.getRole(kbId, ctx.user.id);
      if (!role) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      if (!kbRoleSatisfies(role, min)) {
        res.status(403).json({ error: 'Insufficient Knowledge Base role' });
        return;
      }
      req.kbRole = role;
      next();
    });
  }

  // List import jobs for this KB (viewer+), newest first (AC4).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const jobs = await jobStore.list({ knowledgeBaseId: req.params.kbId as string });
      const imports = jobs.filter((j) => j.type === IMPORT_JOB_TYPE).map(toPublicJob);
      res.json({ jobs: imports });
    }),
  );

  // Enqueue an import job (editor+, AC5).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const parsed = importRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid import request', issues: parsed.error.issues });
        return;
      }
      const job = await jobStore.enqueue({
        type: IMPORT_JOB_TYPE,
        knowledgeBaseId: kbId,
        ownerUserId: ctx.user.id,
        payload: {
          knowledgeBaseId: kbId,
          requestedBy: ctx.user.id,
          request: parsed.data,
        },
      });
      const response: ImportEnqueueResponse = { jobId: job.id, status: job.status };
      res.status(202).json(importEnqueueResponseSchema.parse(response));
    }),
  );

  return router;
}
