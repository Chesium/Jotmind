import { Router, type RequestHandler } from 'express';
import {
  BUILTIN_RULE_MODULES,
  builtinRuleModuleListSchema,
  findBuiltinRulePack,
  installRulePackResultSchema,
  installRulePackSchema,
  kbRoleSatisfies,
  ruleDefinitionSchema,
  updateRuleStatusSchema,
  type KbRole,
  type RuleDefinition,
} from '@jotmind/schemas';
import type { RuleDefinitionRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbRuleStore, readBuiltinMeta, type RuleStore } from './store.js';

export type { RuleStore } from './store.js';
export { dbRuleStore } from './store.js';

function toRule(row: RuleDefinitionRow): RuleDefinition {
  const meta = readBuiltinMeta(row.compiled);
  return ruleDefinitionSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    name: row.name,
    description: row.description,
    ruleText: row.ruleText,
    status: row.status,
    version: row.version,
    moduleId: meta?.moduleId ?? null,
    packId: meta?.packId ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export interface RuleRouterOptions {
  store?: RuleStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/rules` router (US-022). Mounted with
 * `mergeParams: true`. Reads require `viewer`; install + enable/disable require
 * `editor` (so viewers cannot mutate) + `requireCsrf`. Non-members get 404 to
 * hide existence (mirrors the entity/claim/note routers).
 */
export function createRuleRouter(options: RuleRouterOptions = {}): Router {
  const store = options.store ?? dbRuleStore;
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

  // Catalog of built-in Module rule packs (viewer+). Static content.
  router.get('/packs', authed, requireKbRole('viewer'), (_req, res) => {
    res.json(builtinRuleModuleListSchema.parse(BUILTIN_RULE_MODULES));
  });

  // List installed rules in the Knowledge Base (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listRules(req.params.kbId as string);
      res.json(list.map(toRule));
    }),
  );

  // Install a built-in rule pack as Module bundle content (editor+).
  router.post(
    '/install',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = installRulePackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid rule pack selection' });
        return;
      }
      const found = findBuiltinRulePack(parsed.data.moduleId, parsed.data.packId);
      if (!found) {
        res.status(404).json({ error: 'Rule pack not found' });
        return;
      }
      const result = await store.installRulePack({
        knowledgeBaseId: req.params.kbId as string,
        module: found.module,
        pack: found.pack,
        actorUserId: ctx.user.id,
      });
      res.status(201).json(
        installRulePackResultSchema.parse({
          installed: result.installed.map(toRule),
          skipped: result.skipped,
        }),
      );
    }),
  );

  // Enable/disable an installed rule (editor+). Auditable (AC4).
  router.patch(
    '/:ruleId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateRuleStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid rule status' });
        return;
      }
      const rule = await store.setRuleStatus({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.ruleId as string,
        status: parsed.data.status,
        actorUserId: ctx.user.id,
      });
      if (!rule) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }
      res.json(toRule(rule));
    }),
  );

  return router;
}
