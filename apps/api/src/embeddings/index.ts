import { Router, type RequestHandler } from 'express';
import {
  EMBEDDING_INDEX_JOB_TYPE,
  EMBEDDING_TARGET_TYPES,
  embeddingStatusSchema,
  kbRoleSatisfies,
  reindexEmbeddingsSchema,
  reindexEmbeddingsResponseSchema,
  resolveAiPolicy,
  type AiContentCategory,
  type EmbeddingTargetType,
  type EmbeddingStatus,
  type KbRole,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import {
  buildRemoteConfirmation,
  remoteConfirmationMatches,
  remoteConfirmationRequiredBody,
} from '../ai/remote-consent.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbAiPolicyStore, type AiPolicyStore } from '../ai-policy/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbJobStore, type JobStore } from '../jobs/store.js';
import { dbEmbeddingStore, type EmbeddingStore } from './store.js';
import { resolveEmbeddingProviderFromEnv, type ConfiguredEmbeddingProvider } from './provider.js';

export type { EmbeddingStore } from './store.js';
export { dbEmbeddingStore } from './store.js';
export { runEmbeddingIndex, type EmbeddingIndexDeps } from './indexer.js';
export { dbEmbeddingTargetSource } from './targets.js';

export interface EmbeddingsRouterOptions {
  store?: EmbeddingStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  aiPolicyStore?: AiPolicyStore;
  jobStore?: JobStore;
  /** Resolve the configured embedding provider. Defaults to env resolution. */
  resolveProvider?: () => ConfiguredEmbeddingProvider | null;
}

const EMBEDDING_CATEGORY_BY_TARGET: Record<EmbeddingTargetType, AiContentCategory> = {
  entity: 'entity_data',
  claim: 'claim_data',
  note: 'note_text',
  source: 'source_text',
};

function categoriesForTargets(targetTypes: EmbeddingTargetType[] | undefined): AiContentCategory[] {
  const selected = targetTypes ?? [...EMBEDDING_TARGET_TYPES];
  return [...new Set(selected.map((targetType) => EMBEDDING_CATEGORY_BY_TARGET[targetType]))];
}

/**
 * Build the `/api/knowledge-bases/:kbId/embeddings` router (US-021). Mounted with
 * `mergeParams: true` (AFTER the KB router). Reads require `viewer`; enqueuing a
 * reindex requires `editor` (so viewers are read-only) + CSRF. Non-members get
 * 404 to hide existence (mirrors the entity/claim routers).
 *
 * - `GET /`         — embedding status: stored counts + whether vector search is
 *                     available (existing embeddings exist, AC4) and whether new
 *                     embeddings can be generated now (provider + policy, AC3).
 * - `POST /reindex` — enqueue a durable embedding indexing job (US-007). Its
 *                     status is visible via `GET /api/knowledge-bases/:id/jobs`
 *                     (US-014) so users can watch their indexing tasks (AC5).
 */
export function createEmbeddingsRouter(options: EmbeddingsRouterOptions = {}): Router {
  const store = options.store ?? dbEmbeddingStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const aiPolicyStore = options.aiPolicyStore ?? dbAiPolicyStore;
  const jobStore = options.jobStore ?? dbJobStore;
  const resolveProvider = options.resolveProvider ?? resolveEmbeddingProviderFromEnv;
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

  // Embedding status (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;

      const [stats, policies] = await Promise.all([
        store.getStats(kbId),
        aiPolicyStore.getPolicies([
          { scope: 'server', scopeId: null },
          { scope: 'knowledge_base', scopeId: kbId },
          { scope: 'user', scopeId: ctx.user.id },
        ]),
      ]);
      const resolved = resolveAiPolicy(policies);
      const provider = resolveProvider();

      // Vector search is available whenever embeddings exist, independent of the
      // generation provider's current availability (AC4).
      const vectorSearchAvailable = stats.total > 0;

      // Whether NEW embeddings can be generated right now (AC3).
      let generationAvailable = true;
      let reason: string | null = null;
      if (!provider) {
        generationAvailable = false;
        reason = 'No embedding provider is configured';
      } else if (resolved.mode === 'off') {
        generationAvailable = false;
        reason = 'AI is disabled by policy';
      } else if (provider.remote && !resolved.remoteEmbeddingsAllowed) {
        generationAvailable = false;
        reason = 'Remote embeddings are not permitted by policy';
      }

      const status: EmbeddingStatus = {
        vectorSearchAvailable,
        generationAvailable,
        reason,
        total: stats.total,
        counts: stats.counts,
        model: stats.model,
        dimensions: stats.dimensions,
        lastIndexedAt: stats.lastIndexedAt ? stats.lastIndexedAt.toISOString() : null,
        providerKind: provider?.kind ?? null,
      };
      res.json(embeddingStatusSchema.parse(status));
    }),
  );

  // Enqueue a reindex job (editor+).
  router.post(
    '/reindex',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const parsed = reindexEmbeddingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid reindex request' });
        return;
      }
      const [policies, provider] = await Promise.all([
        aiPolicyStore.getPolicies([
          { scope: 'server', scopeId: null },
          { scope: 'knowledge_base', scopeId: kbId },
          { scope: 'user', scopeId: ctx.user.id },
        ]),
        Promise.resolve(resolveProvider()),
      ]);
      const resolved = resolveAiPolicy(policies);
      const remoteConfirmation =
        provider?.remote && resolved.remoteEmbeddingsAllowed
          ? buildRemoteConfirmation({
              provider: provider.name,
              model: provider.model,
              feature: 'Embedding reindex',
              contentCategories: categoriesForTargets(parsed.data.targetTypes),
            })
          : null;

      if (
        remoteConfirmation &&
        resolved.requiresPerRequestConfirmation &&
        !remoteConfirmationMatches(parsed.data.remoteConfirmation, remoteConfirmation)
      ) {
        res.status(409).json(remoteConfirmationRequiredBody(remoteConfirmation));
        return;
      }
      const job = await jobStore.enqueue({
        type: EMBEDDING_INDEX_JOB_TYPE,
        knowledgeBaseId: kbId,
        ownerUserId: ctx.user.id,
        payload: {
          knowledgeBaseId: kbId,
          requestedBy: ctx.user.id,
          ...(parsed.data.targetTypes ? { targetTypes: parsed.data.targetTypes } : {}),
          ...(remoteConfirmation ? { remoteConfirmation } : {}),
        },
      });
      res
        .status(202)
        .json(reindexEmbeddingsResponseSchema.parse({ jobId: job.id, status: job.status }));
    }),
  );

  return router;
}
