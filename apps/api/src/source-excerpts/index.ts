import { Router, type RequestHandler } from 'express';
import {
  createSourceExcerptSchema,
  kbRoleSatisfies,
  sourceExcerptViewSchema,
  updateSourceExcerptSchema,
  type KbRole,
  type SourceExcerptView,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import {
  dbSourceExcerptStore,
  type SourceExcerptStore,
  type SourceExcerptWithClaim,
} from './store.js';

export type { SourceExcerptStore } from './store.js';
export { dbSourceExcerptStore } from './store.js';

function toView(row: SourceExcerptWithClaim): SourceExcerptView {
  return sourceExcerptViewSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    sourceId: row.sourceId,
    noteId: row.noteId,
    claimId: row.claimId,
    excerpt: row.excerpt,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
    metadata: row.metadata,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    claim: row.claim,
  });
}

export interface SourceExcerptRouterOptions {
  store?: SourceExcerptStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/source-excerpts` router (US-011).
 * Mounted with `mergeParams: true`. Reads require `viewer`, mutations require
 * `editor`. Non-members get 404 to hide existence. Excerpts cite a span/excerpt
 * in exactly one origin (note or source) and optionally a claim they support;
 * list results carry the linked claim summary for note/source views (AC4).
 * Excerpts are NOT a graph projection target, so writes emit audit only.
 */
export function createSourceExcerptRouter(options: SourceExcerptRouterOptions = {}): Router {
  const store = options.store ?? dbSourceExcerptStore;
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

  // List source excerpts (viewer+). Filterable by ?noteId / ?sourceId / ?claimId.
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const filter = {
        noteId: typeof req.query.noteId === 'string' ? req.query.noteId : undefined,
        sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
        claimId: typeof req.query.claimId === 'string' ? req.query.claimId : undefined,
      };
      const list = await store.listSourceExcerpts(req.params.kbId as string, filter);
      res.json(list.map(toView));
    }),
  );

  // Create a source excerpt / citation (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createSourceExcerptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid excerpt details' });
        return;
      }
      const result = await store.createSourceExcerpt({
        knowledgeBaseId: req.params.kbId as string,
        sourceId: parsed.data.sourceId,
        noteId: parsed.data.noteId,
        claimId: parsed.data.claimId,
        excerpt: parsed.data.excerpt,
        spanStart: parsed.data.spanStart,
        spanEnd: parsed.data.spanEnd,
        metadata: parsed.data.metadata,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        res.status(404).json({ error: excerptErrorMessage(result.reason) });
        return;
      }
      res.status(201).json(toView(result.excerpt));
    }),
  );

  // Read a single source excerpt (viewer+).
  router.get(
    '/:excerptId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const excerpt = await store.getSourceExcerpt(
        req.params.kbId as string,
        req.params.excerptId as string,
      );
      if (!excerpt) {
        res.status(404).json({ error: 'Source excerpt not found' });
        return;
      }
      res.json(toView(excerpt));
    }),
  );

  // Edit a source excerpt (editor+). Origin (note/source) is immutable.
  router.patch(
    '/:excerptId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateSourceExcerptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid excerpt details' });
        return;
      }
      const result = await store.updateSourceExcerpt({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.excerptId as string,
        actorUserId: ctx.user.id,
        fields: parsed.data,
      });
      if (!result.ok) {
        res.status(404).json({ error: excerptErrorMessage(result.reason) });
        return;
      }
      res.json(toView(result.excerpt));
    }),
  );

  // Soft-delete a source excerpt (editor+).
  router.delete(
    '/:excerptId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const excerpt = await store.deleteSourceExcerpt({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.excerptId as string,
        actorUserId: ctx.user.id,
      });
      if (!excerpt) {
        res.status(404).json({ error: 'Source excerpt not found' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}

function excerptErrorMessage(
  reason: 'note_not_found' | 'source_not_found' | 'claim_not_found' | 'not_found',
): string {
  switch (reason) {
    case 'note_not_found':
      return 'Note not found';
    case 'source_not_found':
      return 'Source not found';
    case 'claim_not_found':
      return 'Claim not found';
    case 'not_found':
      return 'Source excerpt not found';
  }
}
