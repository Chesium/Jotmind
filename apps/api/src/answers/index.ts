import { Router, type RequestHandler } from 'express';
import {
  MOCK_EXTRACTION_LABEL,
  answerRequestSchema,
  answerResponseSchema,
  kbRoleSatisfies,
  resolveAiPolicy,
  type AnswerAiInfo,
  type AnswerCitation,
  type AnswerResponse,
  type GeneratedAnswer,
  type KbRole,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbAiPolicyStore, type AiPolicyStore } from '../ai-policy/store.js';
import { isRemoteProviderKind } from '../extraction/index.js';
import { dbSearchStore, type SearchStore } from '../search/store.js';
import { dbAnswerEvidenceStore, type AnswerEvidenceStore } from './evidence.js';
import { resolveAnswerGeneratorFromEnv, type AnswerGenerator } from './answerer.js';

export type { AnswerGenerator } from './answerer.js';
export type { AnswerEvidenceStore } from './evidence.js';
export {
  LlmAnswerGenerator,
  MockAnswerGenerator,
  parseAnswerOutput,
  resolveAnswerGeneratorFromEnv,
} from './answerer.js';
export { createAnswerEvidenceStore, dbAnswerEvidenceStore } from './evidence.js';

/** Max number of evidence citations gathered per answer. */
const EVIDENCE_LIMIT = 10;

export interface AnswerRouterOptions {
  searchStore?: SearchStore;
  evidenceStore?: AnswerEvidenceStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  aiPolicyStore?: AiPolicyStore;
  /** Configured generator, or null for a No-AI install (AC2). */
  generator?: AnswerGenerator | null;
}

/**
 * Whether answer generation may be used given the configured generator and the
 * resolved AI policy. Mirrors `computeInterpreterAvailability` (US-019): needs a
 * generator, a non-`off` policy, and (for remote providers) remote permission
 * — so viewer answer generation is only allowed when policy permits it (AC6).
 */
function computeAnswerAvailability(
  generator: AnswerGenerator | null,
  policy: { mode: string; remoteAllowed: boolean },
): { available: boolean; reason: string | null } {
  if (!generator) return { available: false, reason: 'No AI provider is configured' };
  if (policy.mode === 'off') return { available: false, reason: 'AI is disabled by policy' };
  if (isRemoteProviderKind(generator.providerKind) && !policy.remoteAllowed) {
    return { available: false, reason: 'Remote AI is not permitted by policy' };
  }
  return { available: true, reason: null };
}

/** Keep only statement citations that point at a real evidence ref (AC1/AC3). */
function clampCitations(answer: GeneratedAnswer, citations: AnswerCitation[]): GeneratedAnswer {
  const validRefs = new Set(citations.map((c) => c.ref));
  return {
    summary: answer.summary,
    statements: answer.statements.map((statement) => ({
      ...statement,
      citations: statement.citations.filter((ref) => validRefs.has(ref)),
    })),
  };
}

/**
 * Build the `/api/knowledge-bases/:kbId/answers` router (US-020). Mounted with
 * `mergeParams: true`, AFTER the KB router. The single `POST /` endpoint is a
 * READ — it never mutates the graph — so it requires `viewer` and no CSRF;
 * non-members get 404 to hide existence (mirrors the command/search routers).
 *
 * Manual token search ALWAYS runs as a fallback so No-AI mode still offers
 * search results (AC2). When AI is available it gathers graph evidence and
 * generates a structured answer citing it (AC1); each cited claim carries
 * predicate/entities/confidence/provenance (AC3), and statements are labeled
 * known/inferred/uncertain/missing (AC5). Viewer generation is only allowed
 * when policy permits (AC6).
 */
export function createAnswerRouter(options: AnswerRouterOptions = {}): Router {
  const searchStore = options.searchStore ?? dbSearchStore;
  const evidenceStore = options.evidenceStore ?? dbAnswerEvidenceStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const aiPolicyStore = options.aiPolicyStore ?? dbAiPolicyStore;
  const generator =
    options.generator !== undefined ? options.generator : resolveAnswerGeneratorFromEnv();
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

  router.post(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const parsed = answerRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid question' });
        return;
      }
      const query = parsed.data.q;

      // 1. Manual token search ALWAYS runs (No-AI fallback, AC2).
      const [fallbackResults, vectorSearch] = await Promise.all([
        searchStore.search(kbId, { query }),
        searchStore.getVectorSearchAvailability(),
      ]);
      const fallback = { results: fallbackResults, vectorSearch };

      // 2. Resolve AI availability from the layered policy (server + user + KB).
      const policies = await aiPolicyStore.getPolicies([
        { scope: 'server', scopeId: null },
        { scope: 'user', scopeId: ctx.user.id },
        { scope: 'knowledge_base', scopeId: kbId },
      ]);
      const resolved = resolveAiPolicy(policies);
      const availability = computeAnswerAvailability(generator, resolved);

      const ai: AnswerAiInfo = {
        attempted: false,
        available: availability.available,
        reason: availability.reason,
        repaired: false,
        provider: generator?.name ?? null,
        model: generator?.model ?? null,
        demo: generator?.demo ?? false,
        verified: generator?.verified ?? false,
        label: generator?.demo ? MOCK_EXTRACTION_LABEL : null,
      };

      let answer: GeneratedAnswer | null = null;
      let citations: AnswerCitation[] = [];

      // 3. Gather evidence + generate an answer when AI is available (AC1).
      if (availability.available && generator) {
        ai.attempted = true;
        try {
          citations = await evidenceStore.gatherEvidence(kbId, query, EVIDENCE_LIMIT);
          const result = await generator.generate(query, citations);
          ai.repaired = result.repaired;
          if (result.answer) {
            answer = clampCitations(result.answer, citations);
          }
        } catch (err) {
          ai.reason = err instanceof Error ? err.message : 'AI answer generation failed';
          citations = [];
        }
      }

      const response: AnswerResponse = {
        query,
        ai,
        answer,
        citations,
        fallback,
      };
      res.json(answerResponseSchema.parse(response));
    }),
  );

  return router;
}
