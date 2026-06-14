import { Router, type RequestHandler } from 'express';
import {
  kbRoleSatisfies,
  resolveAiPolicy,
  updateAiPolicySchema,
  type KbRole,
} from '@jotmind/schemas';
import {
  asyncHandler,
  requireAdmin,
  requireAuth,
  requireCsrf,
  type AuthContext,
} from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/index.js';
import { dbAiPolicyStore, type AiPolicyStore } from './store.js';

export type { AiPolicyStore } from './store.js';
export { dbAiPolicyStore } from './store.js';

export interface AiPolicyRouterOptions {
  store?: AiPolicyStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/ai` router for the layered AI privacy policy (US-016).
 *
 * - `GET /policy/server`  — read the server-layer policy (any authed user).
 * - `PUT /policy/server`  — set the server-layer policy (system admin + CSRF).
 * - `GET /policy/me`      — read the caller's user-layer policy.
 * - `PUT /policy/me`      — set the caller's user-layer policy (CSRF).
 * - `GET /policy`         — the caller's effective NON-KB policy (server + user).
 *
 * Knowledge-Base-scoped policy lives in {@link createAiPolicyKbRouter}.
 */
export function createAiPolicyRouter(options: AiPolicyRouterOptions = {}): Router {
  const store = options.store ?? dbAiPolicyStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router();
  const authed = requireAuth(authStore);

  router.get(
    '/policy/server',
    authed,
    asyncHandler(async (_req, res) => {
      res.json(await store.getPolicy({ scope: 'server', scopeId: null }));
    }),
  );

  router.put(
    '/policy/server',
    authed,
    requireAdmin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateAiPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid AI policy' });
        return;
      }
      const ctx = req.auth as AuthContext;
      const policy = await store.updatePolicy({
        scope: 'server',
        scopeId: null,
        changes: parsed.data,
        actorUserId: ctx.user.id,
      });
      res.json(policy);
    }),
  );

  router.get(
    '/policy/me',
    authed,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      res.json(await store.getPolicy({ scope: 'user', scopeId: ctx.user.id }));
    }),
  );

  router.put(
    '/policy/me',
    authed,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateAiPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid AI policy' });
        return;
      }
      const ctx = req.auth as AuthContext;
      const policy = await store.updatePolicy({
        scope: 'user',
        scopeId: ctx.user.id,
        changes: parsed.data,
        actorUserId: ctx.user.id,
      });
      res.json(policy);
    }),
  );

  // Effective NON-KB policy for the caller (server + user). KB-scoped calls use
  // the KB route, which also folds in the Knowledge Base layer.
  router.get(
    '/policy',
    authed,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const server = await store.getPolicy({ scope: 'server', scopeId: null });
      const user = await store.getPolicy({ scope: 'user', scopeId: ctx.user.id });
      res.json({
        server,
        user,
        effective: resolveAiPolicy([server, user]),
      });
    }),
  );

  return router;
}

export interface AiPolicyKbRouterOptions {
  store?: AiPolicyStore;
  authStore?: AuthStore;
  kbStore?: KnowledgeBaseStore;
}

/**
 * Build the Knowledge-Base-scoped AI policy router, mounted at
 * `/api/knowledge-bases/:kbId/ai/policy` (US-016). Reads require `viewer`;
 * mutations require `admin` + CSRF; non-members get 404 (hide existence).
 *
 * - `GET /`  — KB policy + effective policy (server + KB + user).
 * - `PUT /`  — set the KB-layer policy (KB admin + CSRF).
 */
export function createAiPolicyKbRouter(options: AiPolicyKbRouterOptions = {}): Router {
  const store = options.store ?? dbAiPolicyStore;
  const authStore = options.authStore ?? dbAuthStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
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
      next();
    });
  }

  async function effectiveForKb(kbId: string, userId: string) {
    const server = await store.getPolicy({ scope: 'server', scopeId: null });
    const kb = await store.getPolicy({ scope: 'knowledge_base', scopeId: kbId });
    const user = await store.getPolicy({ scope: 'user', scopeId: userId });
    return {
      policy: kb,
      server,
      user,
      effective: resolveAiPolicy([server, kb, user]),
    };
  }

  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      res.json(await effectiveForKb(req.params.kbId as string, ctx.user.id));
    }),
  );

  router.put(
    '/',
    authed,
    requireKbRole('admin'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateAiPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid AI policy' });
        return;
      }
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      await store.updatePolicy({
        scope: 'knowledge_base',
        scopeId: kbId,
        changes: parsed.data,
        actorUserId: ctx.user.id,
      });
      res.json(await effectiveForKb(kbId, ctx.user.id));
    }),
  );

  return router;
}
