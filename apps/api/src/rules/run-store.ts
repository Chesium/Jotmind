import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  inferredResults,
  ruleRuns,
  type InferredResultRow,
  type RuleRunRow,
} from '../db/schema.js';
import type { RuleFacts } from './engine.js';

/** A fully-resolved inferred result ready to persist (built by the router). */
export interface PersistableInferredResult {
  arguments: Array<{ name: string | null; value: string; entityName: string | null }>;
  claimIds: string[];
  entityIds: string[];
  argumentIds: string[];
}

/** Outcome of an execution to persist (built by the router from the engine). */
export interface SaveRuleRunInput {
  knowledgeBaseId: string;
  ruleId: string;
  ruleName: string;
  status: 'completed' | 'failed';
  error: string | null;
  iterations: number;
  limitExceeded: boolean;
  startedAt: Date;
  finishedAt: Date;
  triggeredBy: string | null;
  jobId: string | null;
  results: PersistableInferredResult[];
  /** Resolved predicate for the inferred results (the rule head predicate). */
  predicate: string;
}

export interface SaveRuleRunResult {
  run: RuleRunRow;
  results: InferredResultRow[];
}

/**
 * Persistence boundary for rule execution (US-024). Defined as an interface so
 * the route handler runs against an in-memory fake in unit tests (no live DB)
 * while production uses the PostgreSQL impl.
 *
 * `loadFacts` is where the hidden safety predicates are injected: every clause
 * filters `deleted_at IS NULL` (AC3) and claims are bounded to the current valid
 * time `valid_start <= NOW() AND (valid_end IS NULL OR valid_end >= NOW())`
 * (AC4). The pure engine never sees soft-deleted or not-yet/no-longer-valid rows.
 */
export interface RuleRunStore {
  loadFacts(knowledgeBaseId: string): Promise<RuleFacts>;
  saveRun(input: SaveRuleRunInput): Promise<SaveRuleRunResult>;
  listRuns(knowledgeBaseId: string, opts?: { limit?: number }): Promise<RuleRunRow[]>;
  getRun(knowledgeBaseId: string, runId: string): Promise<RuleRunRow | undefined>;
  listResults(knowledgeBaseId: string, runId: string): Promise<InferredResultRow[]>;
  /** Fetch a single inferred result by id within a run (US-025 accept flow). */
  getResult(
    knowledgeBaseId: string,
    runId: string,
    resultId: string,
  ): Promise<InferredResultRow | undefined>;
}

/** PostgreSQL-backed RuleRunStore. Resolves the Drizzle client per call. */
export const dbRuleRunStore: RuleRunStore = {
  async loadFacts(knowledgeBaseId) {
    const db = getDb();
    // AC3: hidden `deleted_at IS NULL` on every clause. AC4: current valid-time
    // bounds on claims (the dialect has no valid-time predicate, so always).
    const [entityRows, claimRows, argRows] = await Promise.all([
      db
        .select({ id: entities.id, type: entities.type, name: entities.name })
        .from(entities)
        .where(and(eq(entities.knowledgeBaseId, knowledgeBaseId), isNull(entities.deletedAt))),
      db
        .select({ id: claims.id, predicate: claims.predicate })
        .from(claims)
        .where(
          and(
            eq(claims.knowledgeBaseId, knowledgeBaseId),
            isNull(claims.deletedAt),
            sql`(${claims.validStart} IS NULL OR ${claims.validStart} <= now())`,
            sql`(${claims.validEnd} IS NULL OR ${claims.validEnd} >= now())`,
          ),
        ),
      db
        .select({
          id: claimArguments.id,
          claimId: claimArguments.claimId,
          role: claimArguments.role,
          entityId: claimArguments.entityId,
        })
        .from(claimArguments)
        .where(
          and(
            eq(claimArguments.knowledgeBaseId, knowledgeBaseId),
            isNull(claimArguments.deletedAt),
            eq(claimArguments.argumentKind, 'entity'),
            isNotNull(claimArguments.entityId),
          ),
        ),
    ]);

    return {
      entities: entityRows,
      claims: claimRows,
      args: argRows.map((a) => ({
        id: a.id,
        claimId: a.claimId,
        role: a.role,
        entityId: a.entityId as string,
      })),
    };
  },

  async saveRun(input) {
    return getDb().transaction(async (tx) => {
      const runRows = await tx
        .insert(ruleRuns)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          ruleId: input.ruleId,
          ruleName: input.ruleName,
          status: input.status,
          error: input.error,
          resultCount: input.results.length,
          iterations: input.iterations,
          limitExceeded: input.limitExceeded,
          triggeredBy: input.triggeredBy,
          jobId: input.jobId,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
        })
        .returning();
      const run = runRows[0];
      if (!run) throw new Error('Failed to record rule run');

      let results: InferredResultRow[] = [];
      if (input.results.length > 0) {
        results = await tx
          .insert(inferredResults)
          .values(
            input.results.map((result) => ({
              knowledgeBaseId: input.knowledgeBaseId,
              ruleRunId: run.id,
              ruleId: input.ruleId,
              predicate: input.predicate,
              arguments: result.arguments,
              trace: {
                claimIds: result.claimIds,
                entityIds: result.entityIds,
                argumentIds: result.argumentIds,
              },
            })),
          )
          .returning();
      }

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.triggeredBy,
        action: 'rule.run',
        targetType: 'rule_run',
        targetId: run.id,
        metadata: {
          ruleId: input.ruleId,
          ruleName: input.ruleName,
          status: input.status,
          resultCount: input.results.length,
          limitExceeded: input.limitExceeded,
        },
      });

      return { run, results };
    });
  },

  async listRuns(knowledgeBaseId, opts) {
    return getDb()
      .select()
      .from(ruleRuns)
      .where(eq(ruleRuns.knowledgeBaseId, knowledgeBaseId))
      .orderBy(desc(ruleRuns.createdAt))
      .limit(opts?.limit ?? 50);
  },

  async getRun(knowledgeBaseId, runId) {
    const rows = await getDb()
      .select()
      .from(ruleRuns)
      .where(and(eq(ruleRuns.id, runId), eq(ruleRuns.knowledgeBaseId, knowledgeBaseId)))
      .limit(1);
    return rows[0];
  },

  async listResults(knowledgeBaseId, runId) {
    return getDb()
      .select()
      .from(inferredResults)
      .where(
        and(
          eq(inferredResults.knowledgeBaseId, knowledgeBaseId),
          eq(inferredResults.ruleRunId, runId),
        ),
      )
      .orderBy(desc(inferredResults.createdAt));
  },

  async getResult(knowledgeBaseId, runId, resultId) {
    const rows = await getDb()
      .select()
      .from(inferredResults)
      .where(
        and(
          eq(inferredResults.id, resultId),
          eq(inferredResults.ruleRunId, runId),
          eq(inferredResults.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .limit(1);
    return rows[0];
  },
};
