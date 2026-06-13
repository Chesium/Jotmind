import { Router } from 'express';
import { graphProjectionStatusSchema } from '@jotmind/schemas';
import { asyncHandler, requireAdmin, requireAuth, requireCsrf } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import {
  dbProjectionStore,
  getProjectionStatus,
  processOutbox,
  rebuildProjection,
  stubProjector,
  type Projector,
  type ProjectionStore,
} from './projector.js';

export type { GraphWriteStore } from './store.js';
export { dbGraphWriteStore } from './store.js';
export {
  stubProjector,
  dbProjectionStore,
  processOutbox,
  rebuildProjection,
  getProjectionStatus,
  type Projector,
  type ProjectionStore,
} from './projector.js';
export { enqueueGraphOutbox, outboxEventType } from './outbox.js';

export interface GraphRouterOptions {
  authStore?: AuthStore;
  projectionStore?: ProjectionStore;
  projector?: Projector;
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
  const projector = options.projector ?? stubProjector;
  const router = Router();
  const authed = requireAuth(authStore);

  router.get(
    '/projection/status',
    authed,
    asyncHandler(async (_req, res) => {
      const status = await getProjectionStatus({ store: projectionStore, projector });
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
      const knowledgeBaseId =
        typeof req.body?.knowledgeBaseId === 'string' ? req.body.knowledgeBaseId : undefined;
      const result = await rebuildProjection({
        store: projectionStore,
        projector,
        knowledgeBaseId,
      });
      res.json(result);
    }),
  );

  return router;
}
