import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  inferredResults,
  knowledgeBases,
  ruleRuns,
  users,
} from '../db/schema.js';
import { dbRuleRunStore } from './run-store.js';

/**
 * Integration tests for rule execution fact loading + run persistence (US-024).
 * Skipped when DATABASE_URL is unset so default `pnpm test:api` stays green.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${inferredResults}, ${ruleRuns}, ${claimArguments}, ${claims}, ${entities}, ${auditEvents}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('rule run fact loading + persistence integration', () => {
  let kbId: string;
  let userId: string;
  let adaId: string;
  let babId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'rulerun@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Rule Run KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
    const [ada] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada', createdBy: userId })
      .returning();
    adaId = ada!.id;
    const [bab] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Babbage', createdBy: userId })
      .returning();
    babId = bab!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('excludes soft-deleted records from loaded facts (AC3)', async () => {
    const db = getDb();
    const [live] = await db
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'knows', createdBy: userId })
      .returning();
    await db.insert(claimArguments).values({
      knowledgeBaseId: kbId,
      claimId: live!.id,
      role: 'subject',
      argumentKind: 'entity',
      entityId: adaId,
    });
    // A soft-deleted claim + its soft-deleted argument must not appear.
    const [dead] = await db
      .insert(claims)
      .values({
        knowledgeBaseId: kbId,
        predicate: 'knows',
        createdBy: userId,
        deletedAt: new Date(),
      })
      .returning();
    await db.insert(claimArguments).values({
      knowledgeBaseId: kbId,
      claimId: dead!.id,
      role: 'subject',
      argumentKind: 'entity',
      entityId: babId,
      deletedAt: new Date(),
    });
    // A soft-deleted entity must not appear.
    await db
      .insert(entities)
      .values({
        knowledgeBaseId: kbId,
        type: 'Person',
        name: 'Ghost',
        createdBy: userId,
        deletedAt: new Date(),
      })
      .returning();

    const facts = await dbRuleRunStore.loadFacts(kbId);
    expect(facts.claims.map((c) => c.id)).toEqual([live!.id]);
    expect(facts.args.map((a) => a.claimId)).toEqual([live!.id]);
    expect(facts.entities.map((e) => e.name).sort()).toEqual(['Ada', 'Babbage']);
  });

  it('applies current-time valid-time bounds to claims (AC4)', async () => {
    const db = getDb();
    const now = Date.now();
    const past = new Date(now - 1000 * 60 * 60 * 24);
    const future = new Date(now + 1000 * 60 * 60 * 24);
    // Currently valid (started yesterday, no end).
    const [current] = await db
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'now', createdBy: userId, validStart: past })
      .returning();
    // Not yet valid (starts tomorrow).
    await db
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'future', createdBy: userId, validStart: future })
      .returning();
    // No longer valid (ended yesterday).
    await db
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'expired', createdBy: userId, validEnd: past })
      .returning();

    const facts = await dbRuleRunStore.loadFacts(kbId);
    const predicates = facts.claims.map((c) => c.predicate).sort();
    expect(predicates).toEqual(['now']);
    expect(facts.claims[0]!.id).toBe(current!.id);
  });

  it('persists a rule run, its inferred results, and an audit event (AC5/AC6)', async () => {
    const result = await dbRuleRunStore.saveRun({
      knowledgeBaseId: kbId,
      ruleId: null as unknown as string,
      ruleName: 'acquainted',
      status: 'completed',
      error: null,
      iterations: 1,
      limitExceeded: false,
      startedAt: new Date(),
      finishedAt: new Date(),
      triggeredBy: userId,
      jobId: null,
      predicate: 'acquainted',
      results: [
        {
          arguments: [
            { name: 'a', value: adaId, entityName: 'Ada' },
            { name: 'b', value: babId, entityName: 'Babbage' },
          ],
          claimIds: ['11111111-1111-1111-1111-111111111111'],
          entityIds: [adaId, babId],
          argumentIds: ['22222222-2222-2222-2222-222222222222'],
        },
      ],
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.resultCount).toBe(1);
    expect(result.run.triggeredBy).toBe(userId);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.predicate).toBe('acquainted');

    const persistedResults = await dbRuleRunStore.listResults(kbId, result.run.id);
    expect(persistedResults).toHaveLength(1);
    expect(persistedResults[0]!.trace).toMatchObject({
      claimIds: ['11111111-1111-1111-1111-111111111111'],
    });

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.knowledgeBaseId, kbId), eq(auditEvents.action, 'rule.run')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.targetId).toBe(result.run.id);
  });
});
