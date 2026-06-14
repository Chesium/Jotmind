import { Router, type RequestHandler } from 'express';
import {
  createEntitySchema,
  entitySchema,
  kbRoleSatisfies,
  mergeEntitySchema,
  updateEntitySchema,
  type Entity,
  type KbRole,
} from '@jotmind/schemas';
import type { EntityRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { checkEntityAgainstSchema, type SchemaStore } from '../schema-defs/index.js';
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
  /**
   * Custom schema store (US-027). When provided, entity writes are validated
   * against the active entity-type schema and stamped with its
   * `schemaVersionId` before save. Omitted in unit tests that have no DB.
   */
  schemaStore?: SchemaStore;
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
  const schemaStore = options.schemaStore;
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
      let schemaVersionId: string | undefined;
      if (schemaStore) {
        const check = await checkEntityAgainstSchema(
          schemaStore,
          req.params.kbId as string,
          parsed.data.type,
          parsed.data.properties ?? {},
        );
        if (!check.ok) {
          res.status(400).json({ error: 'Entity does not match its schema', issues: check.issues });
          return;
        }
        schemaVersionId = check.schemaVersionId;
      }
      const entity = await store.createEntity({
        knowledgeBaseId: req.params.kbId as string,
        type: parsed.data.type,
        name: parsed.data.name,
        aliases: parsed.data.aliases,
        description: parsed.data.description,
        tags: parsed.data.tags,
        properties: parsed.data.properties,
        schemaVersionId,
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

  // Explain the impact of deleting/merging an entity: claims that reference it
  // (viewer+). Surfaced in delete/merge confirmation dialogs (US-010 AC2).
  router.get(
    '/:entityId/impact',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const impact = await store.getEntityImpact(
        req.params.kbId as string,
        req.params.entityId as string,
      );
      if (!impact) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }
      res.json(impact);
    }),
  );

  // Soft-delete an entity (editor+). Viewers are read-only (US-010 AC1/AC7).
  router.delete(
    '/:entityId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const entity = await store.deleteEntity({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.entityId as string,
        actorUserId: ctx.user.id,
      });
      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }
      res.status(204).end();
    }),
  );

  // Merge this entity (source) into a survivor (editor+). Archive & Pointer
  // behavior preserves provenance and retargets claims (US-010 AC3-AC6).
  router.post(
    '/:entityId/merge',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = mergeEntitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid merge details' });
        return;
      }
      const result = await store.mergeEntities({
        knowledgeBaseId: req.params.kbId as string,
        sourceId: req.params.entityId as string,
        targetId: parsed.data.targetId,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        if (result.reason === 'same_entity') {
          res.status(400).json({ error: 'Cannot merge an entity into itself' });
          return;
        }
        res.status(404).json({ error: 'Entity not found' });
        return;
      }
      res.json(toEntity(result.entity));
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
      const fields: typeof parsed.data & { schemaVersionId?: string | null } = { ...parsed.data };
      // Re-validate against the active schema whenever the type or properties
      // change, using the existing record to fill in the unchanged half.
      if (schemaStore && (parsed.data.type !== undefined || parsed.data.properties !== undefined)) {
        const existing = await store.getEntity(
          req.params.kbId as string,
          req.params.entityId as string,
        );
        if (existing) {
          const effectiveType = parsed.data.type ?? existing.type;
          const effectiveProps =
            parsed.data.properties ?? (existing.properties as Record<string, unknown>);
          const check = await checkEntityAgainstSchema(
            schemaStore,
            req.params.kbId as string,
            effectiveType,
            effectiveProps,
          );
          if (!check.ok) {
            res
              .status(400)
              .json({ error: 'Entity does not match its schema', issues: check.issues });
            return;
          }
          fields.schemaVersionId = check.schemaVersionId ?? null;
        }
      }
      const entity = await store.updateEntity({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.entityId as string,
        actorUserId: ctx.user.id,
        fields,
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
