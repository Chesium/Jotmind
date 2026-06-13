import { Router, type RequestHandler } from 'express';
import {
  createEntitySchema,
  entitySchema,
  kbRoleSatisfies,
  updateEntitySchema,
  type Entity,
  type KbRole,
} from '@jotmind/schemas';
import type { EntityRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbEntityStore, type EntityStore } from './store.js';

export type { EntityStore } from './store.js';
export { dbEntityStore } from './store.js';

function toEntity(row: EntityRow): Entity {
  return entitySchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    type: row.type,
    name: row.name,
    aliases: row.aliases,
    description: row.description,
    tags: row.tags,
    properties: row.properties,
    schemaVersionId: row.schemaVersionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export interface EntityRouterOptions {
  store?: EntityStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/entities` router (US-008). Mounted with
 * `mergeParams: true` so the parent `:kbId` is visible. Reads require `viewer`,
 * mutations require `editor` (so viewers are read-only). Non-members get 404 to
 * hide existence (mirrors the KB router). Entity writes emit audit + graph
 * outbox events inside the store transaction.
 */
export function createEntityRouter(options: EntityRouterOptions = {}): Router {
  const store = options.store ?? dbEntityStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);

  /** Require the caller to have at least `min` role on the `:kbId` Knowledge Base. */
  function requireKbRole(min: KbRole): RequestHandler {
    return asyncHandler(async (req, res, next) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId;
      if (!kbId) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      const role = await kbStore.getRole(kbId, ctx.user.id);
      // Hide existence from non-members: 404 rather than 403.
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

  // List entities in the Knowledge Base (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listEntities(req.params.kbId as string);
      res.json(list.map(toEntity));
    }),
  );

  // Create an entity (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createEntitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid entity details' });
        return;
      }
      const entity = await store.createEntity({
        knowledgeBaseId: req.params.kbId as string,
        type: parsed.data.type,
        name: parsed.data.name,
        aliases: parsed.data.aliases,
        description: parsed.data.description,
        tags: parsed.data.tags,
        properties: parsed.data.properties,
        actorUserId: ctx.user.id,
      });
      res.status(201).json(toEntity(entity));
    }),
  );

  // Read a single entity (viewer+).
  router.get(
    '/:entityId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const entity = await store.getEntity(
        req.params.kbId as string,
        req.params.entityId as string,
      );
      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }
      res.json(toEntity(entity));
    }),
  );

  // Edit an entity (editor+).
  router.patch(
    '/:entityId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateEntitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid entity details' });
        return;
      }
      const entity = await store.updateEntity({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.entityId as string,
        actorUserId: ctx.user.id,
        fields: parsed.data,
      });
      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }
      res.json(toEntity(entity));
    }),
  );

  return router;
}
