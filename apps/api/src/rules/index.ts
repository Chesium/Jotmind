import { Router, type RequestHandler } from 'express';
import {
  acceptInferredResultResultSchema,
  acceptInferredResultSchema,
  BUILTIN_RULE_MODULES,
  builtinRuleModuleListSchema,
  createRuleSchema,
  findBuiltinRulePack,
  inferredResultArgumentSchema,
  inferredResultListSchema,
  inferredResultSchema,
  inferredResultTraceSchema,
  INFERRED_CLAIM_ORIGIN,
  installRulePackResultSchema,
  installRulePackSchema,
  kbRoleSatisfies,
  parseRule,
  ruleDefinitionSchema,
  ruleRunListSchema,
  ruleRunResultSchema,
  ruleRunSchema,
  ruleValidationResultSchema,
  updateRuleSchema,
  updateRuleStatusSchema,
  validateRuleSchema,
  type InferredResult,
  type InferredResultArgument,
  type KbRole,
  type RuleDefinition,
  type RuleRun,
} from '@jotmind/schemas';
import { z } from 'zod';
import type { InferredResultRow, RuleDefinitionRow, RuleRunRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbRuleStore, readAuthoredCap, readBuiltinMeta, type RuleStore } from './store.js';
import { executeRule } from './engine.js';
import { dbRuleRunStore, type PersistableInferredResult, type RuleRunStore } from './run-store.js';
import { dbClaimStore, type ClaimArgumentInput, type ClaimStore } from '../claims/store.js';

export type { RuleStore } from './store.js';
export { dbRuleStore } from './store.js';
export type { RuleRunStore } from './run-store.js';
export { dbRuleRunStore } from './run-store.js';

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

function toRuleRun(row: RuleRunRow): RuleRun {
  return ruleRunSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    error: row.error,
    resultCount: row.resultCount,
    iterations: row.iterations,
    limitExceeded: row.limitExceeded,
    triggeredBy: row.triggeredBy,
    jobId: row.jobId,
    createdAt: row.createdAt.toISOString(),
  });
}

function toInferredResult(row: InferredResultRow, ruleName: string): InferredResult {
  return inferredResultSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    ruleRunId: row.ruleRunId,
    ruleId: row.ruleId,
    ruleName,
    predicate: row.predicate,
    label: 'inferred',
    arguments: row.arguments,
    trace: row.trace,
    createdAt: row.createdAt.toISOString(),
  });
}

export interface RuleRouterOptions {
  store?: RuleStore;
  runStore?: RuleRunStore;
  claimStore?: ClaimStore;
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
  const runStore = options.runStore ?? dbRuleRunStore;
  const claimStore = options.claimStore ?? dbClaimStore;
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

  // List recorded rule runs for the Knowledge Base (viewer+, read-only).
  router.get(
    '/runs',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const runs = await runStore.listRuns(req.params.kbId as string);
      res.json(ruleRunListSchema.parse(runs.map(toRuleRun)));
    }),
  );

  // Get a single rule run plus its inferred results (viewer+, read-only).
  router.get(
    '/runs/:runId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const run = await runStore.getRun(kbId, req.params.runId as string);
      if (!run) {
        res.status(404).json({ error: 'Rule run not found' });
        return;
      }
      const results = await runStore.listResults(kbId, run.id);
      res.json(
        ruleRunResultSchema.parse({
          run: toRuleRun(run),
          results: inferredResultListSchema.parse(
            results.map((r) => toInferredResult(r, run.ruleName)),
          ),
        }),
      );
    }),
  );

  // Accept an inferred result as a stored Claim (US-025). Editor + CSRF (a
  // write that creates a canonical claim); viewers are read-only (AC4). The new
  // claim records provenance preserving the source rule, rule run, source
  // claims, accepting user, and timestamp (AC2) under origin `inferred` so it
  // stays distinguishable from user-entered and AI-extracted claims (AC3).
  router.post(
    '/runs/:runId/results/:resultId/accept',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const runId = req.params.runId as string;
      const resultId = req.params.resultId as string;

      const parsedBody = acceptInferredResultSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Invalid accept request' });
        return;
      }

      const run = await runStore.getRun(kbId, runId);
      if (!run) {
        res.status(404).json({ error: 'Rule run not found' });
        return;
      }
      const resultRow = await runStore.getResult(kbId, runId, resultId);
      if (!resultRow) {
        res.status(404).json({ error: 'Inferred result not found' });
        return;
      }

      const args: InferredResultArgument[] = z
        .array(inferredResultArgumentSchema)
        .parse(resultRow.arguments);

      // Map each resolved head argument to a claim argument: a value that
      // resolves to a known entity becomes an entity ref, otherwise a literal.
      const claimArgs: ClaimArgumentInput[] = args.map((arg, i) =>
        arg.entityName !== null
          ? { role: arg.name ?? `arg${i}`, argumentKind: 'entity', entityId: arg.value }
          : { role: arg.name ?? `arg${i}`, argumentKind: 'literal', value: arg.value },
      );

      const trace = inferredResultTraceSchema.parse(resultRow.trace);
      const acceptedAt = new Date().toISOString();
      const provenance: Record<string, unknown> = {
        origin: INFERRED_CLAIM_ORIGIN,
        ruleId: run.ruleId,
        ruleName: run.ruleName,
        ruleRunId: run.id,
        inferredResultId: resultRow.id,
        sourceClaimIds: trace.claimIds,
        sourceEntityIds: trace.entityIds,
        sourceArgumentIds: trace.argumentIds,
        acceptedBy: ctx.user.id,
        acceptedAt,
      };
      if (parsedBody.data.confirmationNote) {
        provenance.confirmationNote = parsedBody.data.confirmationNote;
      }

      const created = await claimStore.createClaim({
        knowledgeBaseId: kbId,
        predicate: resultRow.predicate,
        provenance,
        arguments: claimArgs,
        actorUserId: ctx.user.id,
      });

      res.status(201).json(
        acceptInferredResultResultSchema.parse({
          claimId: created.id,
          result: toInferredResult(resultRow, run.ruleName),
        }),
      );
    }),
  );

  // Execute a rule against stored Knowledge Base data, recording the run +
  // inferred results with traces (US-024). Editor+ (a run is a write that
  // creates run/result records) + CSRF. Only enabled, valid rules can execute
  // (US-023 AC6: invalid rules cannot run).
  router.post(
    '/:ruleId/run',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const existing = await store.getRule(kbId, req.params.ruleId as string);
      if (!existing) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }
      if (existing.status !== 'enabled') {
        res.status(409).json({ error: 'Only enabled rules can be run' });
        return;
      }
      const storedCap = readAuthoredCap(existing.compiled);
      const analysis = parseRule(
        existing.ruleText,
        storedCap === null ? undefined : { recursionCap: storedCap },
      );
      if (!analysis.valid || !analysis.rule) {
        res.status(422).json({
          error: 'Cannot run an invalid rule',
          validationErrors: analysis.errors,
        });
        return;
      }
      const compiled = analysis.rule;

      const startedAt = new Date();
      // AC7: rule errors must not corrupt claims/schemas/rules. Execution is a
      // pure in-memory evaluation over loaded facts; any failure is recorded as
      // a failed run with no inferred results and never mutates canonical data.
      let status: 'completed' | 'failed' = 'completed';
      let error: string | null = null;
      let iterations = 0;
      let limitExceeded = false;
      let results: PersistableInferredResult[] = [];
      try {
        const facts = await runStore.loadFacts(kbId);
        const entityNames = new Map(facts.entities.map((e) => [e.id, e.name]));
        const execution = executeRule(compiled, facts);
        iterations = execution.iterations;
        limitExceeded = execution.limitExceeded;
        results = execution.results.map((tuple) => ({
          arguments: compiled.head.args.map((term, i) => {
            const value = tuple.values[i] as string;
            return {
              name: term.kind === 'var' ? term.name : null,
              value,
              entityName: entityNames.get(value) ?? null,
            };
          }),
          claimIds: tuple.claimIds,
          entityIds: tuple.entityIds,
          argumentIds: tuple.argumentIds,
        }));
        if (limitExceeded) {
          status = 'failed';
          error = `Recursion/iteration cap (${compiled.recursionCap}) exceeded before reaching a fixpoint`;
        }
      } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : 'Rule execution failed';
        results = [];
        limitExceeded = false;
      }

      const saved = await runStore.saveRun({
        knowledgeBaseId: kbId,
        ruleId: existing.id,
        ruleName: existing.name,
        status,
        error,
        iterations,
        limitExceeded,
        startedAt,
        finishedAt: new Date(),
        triggeredBy: ctx.user.id,
        jobId: null,
        predicate: compiled.head.predicate,
        results,
      });

      res.status(201).json(
        ruleRunResultSchema.parse({
          run: toRuleRun(saved.run),
          results: inferredResultListSchema.parse(
            saved.results.map((r) => toInferredResult(r, saved.run.ruleName)),
          ),
        }),
      );
    }),
  );

  return router;
}
