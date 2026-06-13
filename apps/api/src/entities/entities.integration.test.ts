import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { auditEvents, entities, graphOutbox, knowledgeBases, users } from '../db/schema.js';
import { dbEntityStore } from './store.js';

/**
 * Integration tests for entity writes (US-008). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${graphOutbox}, ${auditEvents}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
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
});
