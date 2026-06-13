import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  graphOutbox,
  knowledgeBases,
  users,
} from '../db/schema.js';
import { dbClaimStore } from '../claims/store.js';
import { dbEntityStore } from './store.js';

/**
 * Integration tests for entity writes (US-008). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${graphOutbox}, ${auditEvents}, ${claimArguments}, ${claims}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('entity writes integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'entities@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Entities KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('creates an entity with audit + outbox events in one transaction', async () => {
    const entity = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: ['Ada'],
      description: 'Mathematician',
      tags: ['pioneer'],
      properties: { born: 1815 },
      actorUserId: userId,
    });

    expect(entity.id).toBeTruthy();
    expect(entity.createdBy).toBe(userId);

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(eq(graphOutbox.targetId, entity.id));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe('entity.created');

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, entity.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('entity.created');
    expect(audit[0]!.actorUserId).toBe(userId);
  });

  it('updates an entity and emits an entity.updated event + audit', async () => {
    const entity = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Concept',
      name: 'Recursion',
      actorUserId: userId,
    });

    const updated = await dbEntityStore.updateEntity({
      knowledgeBaseId: kbId,
      id: entity.id,
      actorUserId: userId,
      fields: { name: 'Tail recursion', tags: ['cs'] },
    });

    expect(updated?.name).toBe('Tail recursion');
    expect(updated?.tags).toEqual(['cs']);

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(and(eq(graphOutbox.targetId, entity.id), eq(graphOutbox.eventType, 'entity.updated')));
    expect(outbox).toHaveLength(1);

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, entity.id), eq(auditEvents.action, 'entity.updated')));
    expect(audit).toHaveLength(1);
  });

  it('lists only non-deleted entities and scopes by KB', async () => {
    await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'A',
      actorUserId: userId,
    });
    await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'B',
      actorUserId: userId,
    });

    const list = await dbEntityStore.listEntities(kbId);
    expect(list).toHaveLength(2);
  });

  it('returns undefined when updating an entity in a different KB', async () => {
    const entity = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'A',
      actorUserId: userId,
    });
    const [otherKb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Other', createdBy: userId })
      .returning();

    const result = await dbEntityStore.updateEntity({
      knowledgeBaseId: otherKb!.id,
      id: entity.id,
      actorUserId: userId,
      fields: { name: 'Nope' },
    });
    expect(result).toBeUndefined();
  });

  it('soft-deletes an entity (US-010) and emits an entity.deleted event + audit', async () => {
    const entity = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Doomed',
      actorUserId: userId,
    });

    const deleted = await dbEntityStore.deleteEntity({
      knowledgeBaseId: kbId,
      id: entity.id,
      actorUserId: userId,
    });
    expect(deleted?.deletedAt).toBeTruthy();

    // Soft-deleted: hidden from reads but the row still exists.
    expect(await dbEntityStore.getEntity(kbId, entity.id)).toBeUndefined();
    const rows = await getDb().select().from(entities).where(eq(entities.id, entity.id));
    expect(rows).toHaveLength(1);

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(and(eq(graphOutbox.targetId, entity.id), eq(graphOutbox.eventType, 'entity.deleted')));
    expect(outbox).toHaveLength(1);

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, entity.id), eq(auditEvents.action, 'entity.deleted')));
    expect(audit).toHaveLength(1);

    // Deleting again is a no-op (returns undefined).
    expect(
      await dbEntityStore.deleteEntity({
        knowledgeBaseId: kbId,
        id: entity.id,
        actorUserId: userId,
      }),
    ).toBeUndefined();
  });

  it('reports claims that reference an entity as delete/merge impact (US-010)', async () => {
    const subject = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Subject',
      actorUserId: userId,
    });
    const claim = await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knows',
      arguments: [{ role: 'subject', argumentKind: 'entity', entityId: subject.id }],
      actorUserId: userId,
    });

    const impact = await dbEntityStore.getEntityImpact(kbId, subject.id);
    expect(impact?.claims).toEqual([{ id: claim.id, predicate: 'knows' }]);

    expect(await dbEntityStore.getEntityImpact(kbId, randomUUID())).toBeUndefined();
  });

  it('merges entities with archive & pointer, retargeting claims + provenance (US-010)', async () => {
    const source = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada L.',
      aliases: ['A.L.'],
      tags: ['t1'],
      properties: { born: 1815, onlyOnSource: true },
      actorUserId: userId,
    });
    const target = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      aliases: ['Ada'],
      tags: ['t2'],
      properties: { born: 1816 },
      actorUserId: userId,
    });
    const other = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Charles',
      actorUserId: userId,
    });

    // A claim referencing the source (to be retargeted) with two arguments.
    const claim = await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      arguments: [
        { role: 'subject', argumentKind: 'entity', entityId: source.id },
        { role: 'object', argumentKind: 'entity', entityId: other.id },
      ],
      actorUserId: userId,
    });

    const result = await dbEntityStore.mergeEntities({
      knowledgeBaseId: kbId,
      sourceId: source.id,
      targetId: target.id,
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retargetedClaimCount).toBe(1);

    // Survivor: aliases include source name + source aliases; tags unioned;
    // target properties win but source-only props are folded in.
    expect(result.entity.aliases).toEqual(expect.arrayContaining(['Ada', 'A.L.', 'Ada L.']));
    expect(result.entity.tags).toEqual(expect.arrayContaining(['t1', 't2']));
    expect(result.entity.properties).toMatchObject({ born: 1816, onlyOnSource: true });

    // Source is archived: soft-deleted + mergedIntoId points at survivor.
    const sourceRows = await getDb().select().from(entities).where(eq(entities.id, source.id));
    expect(sourceRows[0]!.deletedAt).toBeTruthy();
    expect(sourceRows[0]!.mergedIntoId).toBe(target.id);

    // The claim argument was retargeted from source -> target.
    const args = await getDb()
      .select()
      .from(claimArguments)
      .where(eq(claimArguments.claimId, claim.id));
    const subjectArg = args.find((a) => a.role === 'subject');
    expect(subjectArg?.entityId).toBe(target.id);

    // Provenance records the archived entity id.
    const claimRows = await getDb().select().from(claims).where(eq(claims.id, claim.id));
    const provenance = claimRows[0]!.provenance as { historical_source_entities?: string[] };
    expect(provenance.historical_source_entities).toContain(source.id);

    // Outbox: survivor updated, source deleted, claim updated.
    const outbox = await getDb().select().from(graphOutbox);
    const events = outbox.map((o) => `${o.eventType}:${o.targetId}`);
    expect(events).toContain(`entity.updated:${target.id}`);
    expect(events).toContain(`entity.deleted:${source.id}`);
    expect(events).toContain(`claim.updated:${claim.id}`);

    // Audit records the merge.
    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'entity.merged'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      sourceId: source.id,
      targetId: target.id,
      retargetedClaimCount: 1,
    });
  });

  it('rejects self-merge and missing source/target (US-010)', async () => {
    const entity = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Solo',
      actorUserId: userId,
    });

    expect(
      await dbEntityStore.mergeEntities({
        knowledgeBaseId: kbId,
        sourceId: entity.id,
        targetId: entity.id,
        actorUserId: userId,
      }),
    ).toEqual({ ok: false, reason: 'same_entity' });

    expect(
      await dbEntityStore.mergeEntities({
        knowledgeBaseId: kbId,
        sourceId: randomUUID(),
        targetId: entity.id,
        actorUserId: userId,
      }),
    ).toEqual({ ok: false, reason: 'source_not_found' });

    expect(
      await dbEntityStore.mergeEntities({
        knowledgeBaseId: kbId,
        sourceId: entity.id,
        targetId: randomUUID(),
        actorUserId: userId,
      }),
    ).toEqual({ ok: false, reason: 'target_not_found' });
  });
});
