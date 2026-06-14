import { Router, type RequestHandler } from 'express';
import {
  BUILTIN_MODULES,
  findBuiltinModule,
  findBuiltinRulePack,
  installModuleResultSchema,
  installModuleSchema,
  kbRoleSatisfies,
  moduleStatusListSchema,
  type KbRole,
  type ModuleInstallItem,
  type ModuleStatus,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbSchemaStore, type SchemaStore } from '../schema-defs/store.js';
import { dbRuleStore, type RuleStore } from '../rules/store.js';

export interface ModuleRouterOptions {
  schemaStore?: SchemaStore;
  ruleStore?: RuleStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/modules` router (US-029). A Module is an
 * installable bundle of default schema definitions (US-027) + rule pack
 * references (US-022). Mounted with `mergeParams: true` AFTER the KB router.
 * Reads require `viewer`; install requires `editor` + `requireCsrf` (viewers are
 * read-only). Non-members get 404 to hide existence.
 *
 * Install happens IN THE ROUTER (not a dedicated store), reusing the injected
 * `schemaStore.createDefinition` + `ruleStore.installRulePack` so created
 * content goes through the canonical write paths (audit, idempotency). This
 * mirrors the proposal-accept pattern (US-018).
 */
export function createModuleRouter(options: ModuleRouterOptions = {}): Router {
  const schemaStore = options.schemaStore ?? dbSchemaStore;
  const ruleStore = options.ruleStore ?? dbRuleStore;
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

  // Catalog of built-in Modules with per-KB installed status (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const defs = await schemaStore.listDefinitions(kbId);
      const entityTypeNames = new Set(
        defs.filter((d) => d.kind === 'entity_type').map((d) => d.name),
      );
      const predicateNames = new Set(
        defs.filter((d) => d.kind === 'claim_predicate').map((d) => d.name),
      );

      const statuses: ModuleStatus[] = BUILTIN_MODULES.map((mod) => {
        const installedEntityTypes = mod.entityTypes
          .map((e) => e.name)
          .filter((n) => entityTypeNames.has(n));
        const installedClaimPredicates = mod.claimPredicates
          .map((p) => p.name)
          .filter((n) => predicateNames.has(n));
        const fullyInstalled =
          installedEntityTypes.length === mod.entityTypes.length &&
          installedClaimPredicates.length === mod.claimPredicates.length;
        return {
          ...mod,
          installedEntityTypes,
          installedClaimPredicates,
          fullyInstalled,
        };
      });

      res.json(moduleStatusListSchema.parse(statuses));
    }),
  );

  // Install a built-in Module into the Knowledge Base (editor+). Idempotent:
  // schema definitions already present (by name) and rules already installed are
  // skipped rather than failing.
  router.post(
    '/install',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = installModuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid module install request' });
        return;
      }
      const mod = findBuiltinModule(parsed.data.moduleId);
      if (!mod) {
        res.status(404).json({ error: 'Module not found' });
        return;
      }
      const kbId = req.params.kbId as string;
      const items: ModuleInstallItem[] = [];

      for (const entityType of mod.entityTypes) {
        const result = await schemaStore.createDefinition({
          knowledgeBaseId: kbId,
          kind: 'entity_type',
          name: entityType.name,
          displayName: entityType.displayName,
          description: entityType.description,
          propertySchema: entityType.propertySchema,
          actorUserId: ctx.user.id,
        });
        items.push({
          kind: 'entity_type',
          name: entityType.name,
          status: result.ok ? 'installed' : 'skipped',
          ...(result.ok ? {} : { reason: 'already exists' }),
        });
      }

      for (const predicate of mod.claimPredicates) {
        const result = await schemaStore.createDefinition({
          knowledgeBaseId: kbId,
          kind: 'claim_predicate',
          name: predicate.name,
          displayName: predicate.displayName,
          description: predicate.description,
          spec: predicate.spec,
          actorUserId: ctx.user.id,
        });
        items.push({
          kind: 'claim_predicate',
          name: predicate.name,
          status: result.ok ? 'installed' : 'skipped',
          ...(result.ok ? {} : { reason: 'already exists' }),
        });
      }

      for (const ref of mod.rulePacks) {
        const found = findBuiltinRulePack(ref.moduleId, ref.packId);
        if (!found) {
          items.push({
            kind: 'rule_pack',
            name: ref.packId,
            status: 'skipped',
            reason: 'pack not found',
          });
          continue;
        }
        const result = await ruleStore.installRulePack({
          knowledgeBaseId: kbId,
          module: found.module,
          pack: found.pack,
          actorUserId: ctx.user.id,
        });
        const installedAny = result.installed.length > 0;
        items.push({
          kind: 'rule_pack',
          name: found.pack.id,
          status: installedAny ? 'installed' : 'skipped',
          ...(installedAny ? {} : { reason: 'already installed' }),
        });
      }

      res.status(201).json(installModuleResultSchema.parse({ moduleId: mod.id, items }));
    }),
  );

  return router;
}
