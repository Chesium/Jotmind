import { Router, type RequestHandler } from 'express';
import {
  createSourceSchema,
  kbRoleSatisfies,
  sourceSchema,
  updateSourceSchema,
  type KbRole,
  type Source,
} from '@jotmind/schemas';
import type { SourceRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbSourceStore, type SourceStore } from './store.js';

export type { SourceStore } from './store.js';
export { dbSourceStore } from './store.js';

function toSource(row: SourceRow): Source {
  return sourceSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    sourceType: row.sourceType,
    uri: row.uri,
    content: row.content,
    metadata: row.metadata,
    properties: row.properties,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export interface SourceRouterOptions {
  store?: SourceStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/sources` router (US-011). Mounted with
 * `mergeParams: true` so the parent `:kbId` is visible. Reads require `viewer`,
 * mutations require `editor` (so viewers are read-only). Non-members get 404 to
 * hide existence (mirrors the entity/claim routers). No AI provider is required
 * to capture a source.
 */
export function createSourceRouter(options: SourceRouterOptions = {}): Router {
  const store = options.store ?? dbSourceStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
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

  // List sources in the Knowledge Base (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listSources(req.params.kbId as string);
      res.json(list.map(toSource));
    }),
  );

  // Create a source (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid source details' });
        return;
      }
      const source = await store.createSource({
        knowledgeBaseId: req.params.kbId as string,
        title: parsed.data.title,
        sourceType: parsed.data.sourceType,
        uri: parsed.data.uri,
        content: parsed.data.content,
        metadata: parsed.data.metadata,
        properties: parsed.data.properties,
        actorUserId: ctx.user.id,
      });
      res.status(201).json(toSource(source));
    }),
  );

  // Read a single source (viewer+).
  router.get(
    '/:sourceId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const source = await store.getSource(
        req.params.kbId as string,
        req.params.sourceId as string,
      );
      if (!source) {
        res.status(404).json({ error: 'Source not found' });
        return;
      }
      res.json(toSource(source));
    }),
  );

  // Edit a source (editor+).
  router.patch(
    '/:sourceId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid source details' });
        return;
      }
      const source = await store.updateSource({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.sourceId as string,
        actorUserId: ctx.user.id,
        fields: parsed.data,
      });
      if (!source) {
        res.status(404).json({ error: 'Source not found' });
        return;
      }
      res.json(toSource(source));
    }),
  );

  // Soft-delete a source (editor+). Viewers are read-only.
  router.delete(
    '/:sourceId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const source = await store.deleteSource({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.sourceId as string,
        actorUserId: ctx.user.id,
      });
      if (!source) {
        res.status(404).json({ error: 'Source not found' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
