import { Router, type RequestHandler } from 'express';
import {
  SEARCH_RESULT_KINDS,
  kbRoleSatisfies,
  searchQuerySchema,
  searchResponseSchema,
  type KbRole,
  type SearchResultKind,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbSearchStore, type SearchFilters, type SearchStore } from './store.js';

export type { SearchStore, SearchFilters } from './store.js';
export { dbSearchStore } from './store.js';

export interface SearchRouterOptions {
  store?: SearchStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/** Parse the `kinds` CSV param into valid SearchResultKinds (ignoring unknowns). */
function parseKinds(raw: string | undefined): SearchResultKind[] | undefined {
  if (raw === undefined) return undefined;
  const valid = new Set<string>(SEARCH_RESULT_KINDS);
  const kinds = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is SearchResultKind => valid.has(k));
  return kinds.length > 0 ? kinds : undefined;
}

/**
 * Build the `/api/knowledge-bases/:kbId/search` router (US-012). Mounted with
 * `mergeParams: true` so the parent `:kbId` is visible. Search is a read, so it
 * requires the `viewer` role (search respects KB permissions, AC3); non-members
 * get 404 to hide existence (mirrors the entity/claim routers).
 */
export function createSearchRouter(options: SearchRouterOptions = {}): Router {
  const store = options.store ?? dbSearchStore;
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

  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid search query' });
        return;
      }
      const q = parsed.data;
      const filters: SearchFilters = {
        query: q.q,
        kinds: parseKinds(q.kinds),
        type: q.type,
        predicate: q.predicate,
        tag: q.tag,
        confidenceMin: q.confidenceMin,
        confidenceMax: q.confidenceMax,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
        hasProvenance: q.hasProvenance,
        limit: q.limit,
      };

      const [results, vectorSearch] = await Promise.all([
        store.search(req.params.kbId as string, filters),
        store.getVectorSearchAvailability(),
      ]);

      res.json(searchResponseSchema.parse({ results, vectorSearch }));
    }),
  );

  return router;
}
