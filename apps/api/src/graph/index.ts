import { Router } from 'express';
import { GRAPH_REBUILD_JOB_TYPE, graphProjectionStatusSchema } from '@jotmind/schemas';
import { asyncHandler, requireAdmin, requireAuth, requireCsrf } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbJobStore, type JobStore } from '../jobs/store.js';
import { toPublicJob } from '../jobs/index.js';
import {
  dbProjectionStatusStore,
  dbProjectionStore,
  getProjectionStatus,
  processOutbox,
  stubProjector,
  type Projector,
  type ProjectionStatusStore,
  type ProjectionStore,
} from './projector.js';

export type { GraphWriteStore } from './store.js';
export { dbGraphWriteStore } from './store.js';
export {
  stubProjector,
  dbProjectionStore,
  dbProjectionStatusStore,
  processOutbox,
  rebuildProjection,
  getProjectionStatus,
  type Projector,
  type ProjectionStore,
  type ProjectionStatusStore,
} from './projector.js';
export { ageProjector } from './age-projector.js';
export {
  ageTraversalService,
  createAgeTraversalService,
  GraphProjectionUnavailableError,
  type GraphTraversalService,
} from './traversal.js';
export { enqueueGraphOutbox, outboxEventType } from './outbox.js';

export interface GraphRouterOptions {
  authStore?: AuthStore;
  projectionStore?: ProjectionStore;
  projectionStatusStore?: ProjectionStatusStore;
  projector?: Projector;
  jobStore?: JobStore;
}

/**
 * Build the `/api/graph` router (US-006). Exposes the projection seam:
 *   - `GET  /projection/status` — projector identity (incl. `stubbed`) + outbox
 *     backlog counts, so the stub projector is visible via the API.
 *   - `POST /projection/process` — drain pending outbox events (admin).
 *   - `POST /projection/rebuild` — regenerate projection from relational tables
 *     (admin). Optional `knowledgeBaseId` body limits the scope.
 */
export function createGraphRouter(options: GraphRouterOptions = {}): Router {
  const authStore = options.authStore ?? dbAuthStore;
  const projectionStore = options.projectionStore ?? dbProjectionStore;
  const projectionStatusStore = options.projectionStatusStore ?? dbProjectionStatusStore;
  const projector = options.projector ?? stubProjector;
  const jobStore = options.jobStore ?? dbJobStore;
  const router = Router();
  const authed = requireAuth(authStore);

  router.get(
    '/projection/status',
    authed,
    asyncHandler(async (_req, res) => {
      const status = await getProjectionStatus({
        store: projectionStore,
        projector,
        statusStore: projectionStatusStore,
      });
      res.json(graphProjectionStatusSchema.parse(status));
    }),
  );

  router.post(
    '/projection/process',
    authed,
    requireAdmin,
    requireCsrf,
    asyncHandler(async (_req, res) => {
      const result = await processOutbox({ store: projectionStore, projector });
      res.json(result);
    }),
  );

  router.post(
    '/projection/rebuild',
    authed,
    requireAdmin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      // Rebuild runs as a durable job so it never blocks the app and its
      // progress/failure is visible through the job + projection status UI
      // (US-026 AC4/AC7).
      const knowledgeBaseId =
        typeof req.body?.knowledgeBaseId === 'string' ? req.body.knowledgeBaseId : undefined;
      const userId = req.auth?.user.id ?? null;
      const job = await jobStore.enqueue({
        type: GRAPH_REBUILD_JOB_TYPE,
        payload: {
          ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
          requestedBy: userId,
        },
        ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
        ownerUserId: userId,
      });
      res.status(202).json({ job: toPublicJob(job) });
    }),
  );

  return router;
}
