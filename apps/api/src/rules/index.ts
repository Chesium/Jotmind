import { Router, type RequestHandler } from 'express';
import {
  BUILTIN_RULE_MODULES,
  builtinRuleModuleListSchema,
  createRuleSchema,
  findBuiltinRulePack,
  installRulePackResultSchema,
  installRulePackSchema,
  kbRoleSatisfies,
  parseRule,
  ruleDefinitionSchema,
  ruleValidationResultSchema,
  updateRuleSchema,
  updateRuleStatusSchema,
  validateRuleSchema,
  type KbRole,
  type RuleDefinition,
} from '@jotmind/schemas';
import type { RuleDefinitionRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbRuleStore, readAuthoredCap, readBuiltinMeta, type RuleStore } from './store.js';

export type { RuleStore } from './store.js';
export { dbRuleStore } from './store.js';

function toRule(row: RuleDefinitionRow): RuleDefinition {
  const meta = readBuiltinMeta(row.compiled);
  const storedCap = readAuthoredCap(row.compiled);
  // Re-parse the canonical text as the single source of truth for validity so
  // built-in and authored rules surface validation consistently (US-023).
  const analysis = parseRule(
    row.ruleText,
    storedCap === null ? undefined : { recursionCap: storedCap },
  );
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
    valid: analysis.valid,
    validationErrors: analysis.errors,
    recursionCap: analysis.recursionCap,
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

  // Validate rule text without saving (viewer+, read-only — live UI preview, US-023).
  router.post(
    '/validate',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const parsed = validateRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid rule validation request' });
        return;
      }
      const analysis = parseRule(
        parsed.data.ruleText,
        parsed.data.recursionCap === undefined
          ? undefined
          : { recursionCap: parsed.data.recursionCap },
      );
      res.json(
        ruleValidationResultSchema.parse({
          valid: analysis.valid,
          errors: analysis.errors,
          recursive: analysis.recursive,
          recursionCap: analysis.recursionCap,
        }),
      );
    }),
  );

  // Author a custom rule (editor+). Validation runs before save (AC5); a rule is
  // always created as a `draft` and can only be enabled later if valid (AC6).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid rule', details: parsed.error.flatten() });
        return;
      }
      const result = await store.createRule({
        knowledgeBaseId: req.params.kbId as string,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        ruleText: parsed.data.ruleText,
        recursionCap: parsed.data.recursionCap,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        res.status(409).json({ error: 'A rule with that name already exists' });
        return;
      }
      res.status(201).json(toRule(result.rule));
    }),
  );

  // Edit an authored rule's text/name/cap (editor+). Re-validates (AC5).
  router.put(
    '/:ruleId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid rule update', details: parsed.error.flatten() });
        return;
      }
      const result = await store.updateRule({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.ruleId as string,
        name: parsed.data.name,
        description: parsed.data.description,
        ruleText: parsed.data.ruleText,
        recursionCap: parsed.data.recursionCap,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        if (result.reason === 'duplicate_name') {
          res.status(409).json({ error: 'A rule with that name already exists' });
          return;
        }
        res.status(404).json({ error: 'Rule not found' });
        return;
      }
      res.json(toRule(result.rule));
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
      // Validation runs before enable (AC5): an invalid rule cannot be enabled
      // or executed (AC6).
      if (parsed.data.status === 'enabled') {
        const existing = await store.getRule(
          req.params.kbId as string,
          req.params.ruleId as string,
        );
        if (!existing) {
          res.status(404).json({ error: 'Rule not found' });
          return;
        }
        const storedCap = readAuthoredCap(existing.compiled);
        const analysis = parseRule(
          existing.ruleText,
          storedCap === null ? undefined : { recursionCap: storedCap },
        );
        if (!analysis.valid) {
          res.status(422).json({
            error: 'Cannot enable an invalid rule',
            validationErrors: analysis.errors,
          });
          return;
        }
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
