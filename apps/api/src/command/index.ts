import { Router, type RequestHandler } from 'express';
import {
  COMMAND_CONFIDENCE_THRESHOLD,
  MOCK_EXTRACTION_LABEL,
  commandRequestSchema,
  commandResponseSchema,
  kbRoleSatisfies,
  resolveAiPolicy,
  type CommandAiInfo,
  type CommandInterpretation,
  type CommandResponse,
  type KbRole,
  type SearchResult,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbAiPolicyStore, type AiPolicyStore } from '../ai-policy/store.js';
import { isRemoteProviderKind } from '../extraction/index.js';
import { dbSearchStore, type SearchFilters, type SearchStore } from '../search/store.js';
import { resolveCommandInterpreterFromEnv, type CommandInterpreter } from './interpreter.js';

export type { CommandInterpreter } from './interpreter.js';
export {
  LlmCommandInterpreter,
  MockCommandInterpreter,
  parseCommandOutput,
  resolveCommandInterpreterFromEnv,
} from './interpreter.js';

export interface CommandRouterOptions {
  searchStore?: SearchStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  aiPolicyStore?: AiPolicyStore;
  /** Configured interpreter, or null for a No-AI install (AC1). */
  interpreter?: CommandInterpreter | null;
}

/**
 * Whether the command interpreter may be used given the configured interpreter
 * and the resolved AI policy. Mirrors `computeExtractionAvailability` (US-017):
 * needs an interpreter, a non-`off` policy, and (for remote providers) remote
 * permission.
 */
function computeInterpreterAvailability(
  interpreter: CommandInterpreter | null,
  policy: { mode: string; remoteAllowed: boolean },
): { available: boolean; reason: string | null } {
  if (!interpreter) return { available: false, reason: 'No AI provider is configured' };
  if (policy.mode === 'off') return { available: false, reason: 'AI is disabled by policy' };
  if (isRemoteProviderKind(interpreter.providerKind) && !policy.remoteAllowed) {
    return { available: false, reason: 'Remote AI is not permitted by policy' };
  }
  return { available: true, reason: null };
}

/**
 * Build the `/api/knowledge-bases/:kbId/command` router (US-019). Mounted with
 * `mergeParams: true`, AFTER the KB router. The single `POST /` endpoint is a
 * READ — it never mutates the graph — so it requires `viewer` and no CSRF;
 * non-members get 404 to hide existence (mirrors the search router).
 *
 * It ALWAYS runs manual token search (`fallback`) so the box works with AI
 * disabled (AC1). When AI is available it additionally interprets the query
 * into a structured command constrained by Zod (AC2); invalid output is
 * discarded (AC3) after one repair retry (AC4), and low-confidence/invalid
 * interpretations leave only the search fallback (AC5). Structured
 * interpretation and fallback results are returned in separate fields (AC6).
 */
export function createCommandRouter(options: CommandRouterOptions = {}): Router {
  const searchStore = options.searchStore ?? dbSearchStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const aiPolicyStore = options.aiPolicyStore ?? dbAiPolicyStore;
  const interpreter =
    options.interpreter !== undefined ? options.interpreter : resolveCommandInterpreterFromEnv();
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
      const parsed = commandRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid command' });
        return;
      }
      const query = parsed.data.q;

      // 1. Manual token search ALWAYS runs (AC1/AC5).
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
      const availability = computeInterpreterAvailability(interpreter, resolved);

      const ai: CommandAiInfo = {
        attempted: false,
        available: availability.available,
        reason: availability.reason,
        repaired: false,
        lowConfidence: false,
        provider: interpreter?.name ?? null,
        model: interpreter?.model ?? null,
        demo: interpreter?.demo ?? false,
        label: interpreter?.demo ? MOCK_EXTRACTION_LABEL : null,
      };

      let interpretation: CommandInterpretation | null = null;
      let interpretedResults: SearchResult[] | null = null;

      // 3. Interpret (when available) into a structured command (AC2/AC3/AC4).
      if (availability.available && interpreter) {
        ai.attempted = true;
        try {
          const result = await interpreter.interpret(query);
          ai.repaired = result.repaired;
          if (result.interpretation) {
            // Discard low-confidence interpretations → fall back to search (AC5).
            if (result.interpretation.confidence < COMMAND_CONFIDENCE_THRESHOLD) {
              ai.lowConfidence = true;
            } else {
              interpretation = result.interpretation;
            }
          }
        } catch (err) {
          ai.reason = err instanceof Error ? err.message : 'AI interpretation failed';
        }
      }

      // 4. Execute a `search` interpretation to produce structured results.
      if (interpretation && interpretation.intent === 'search') {
        const f = interpretation.filters;
        const filters: SearchFilters = {
          query: f.q,
          kinds: f.kinds,
          type: f.type,
          predicate: f.predicate,
          tag: f.tag,
          confidenceMin: f.confidenceMin,
          confidenceMax: f.confidenceMax,
        };
        interpretedResults = await searchStore.search(kbId, filters);
      }

      const response: CommandResponse = {
        query,
        ai,
        interpretation,
        interpretedResults,
        fallback,
      };
      res.json(commandResponseSchema.parse(response));
    }),
  );

  return router;
}
