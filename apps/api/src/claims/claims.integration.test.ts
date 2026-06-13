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
import { dbClaimStore } from './store.js';

/**
 * Integration tests for claim writes (US-009). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${claimArguments}, ${claims}, ${graphOutbox}, ${auditEvents}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('claim writes integration', () => {
  let kbId: string;
  let userId: string;
  let entityA: string;
  let entityB: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'claims@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Claims KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
    const [a] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada', createdBy: userId })
      .returning();
    entityA = a!.id;
    const [b] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Charles', createdBy: userId })
      .returning();
    entityB = b!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('creates a multi-argument claim with audit + outbox events in one transaction', async () => {
    const claim = await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      description: 'They met',
      confidence: 0.8,
      validStart: '2020-01-01T00:00:00.000Z',
      validEnd: '2020-01-02T00:00:00.000Z',
      arguments: [
        { role: 'subject', argumentKind: 'entity', entityId: entityA },
        { role: 'object', argumentKind: 'entity', entityId: entityB },
        { role: 'location', argumentKind: 'literal', value: 'Berlin' },
      ],
      actorUserId: userId,
    });

    expect(claim.id).toBeTruthy();
    expect(claim.arguments).toHaveLength(3);
    expect(claim.confidence).toBe(0.8);

    const args = await getDb()
      .select()
      .from(claimArguments)
      .where(eq(claimArguments.claimId, claim.id));
    expect(args).toHaveLength(3);
    const literal = args.find((a) => a.argumentKind === 'literal');
    expect(literal?.value).toBe('Berlin');
    expect(literal?.entityId).toBeNull();

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(eq(graphOutbox.targetId, claim.id));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe('claim.created');

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, claim.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('claim.created');
    expect(audit[0]!.actorUserId).toBe(userId);
  });

  it('updates claim metadata and replaces arguments, emitting claim.updated', async () => {
    const claim = await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      arguments: [{ role: 'subject', argumentKind: 'entity', entityId: entityA }],
      actorUserId: userId,
    });

    const updated = await dbClaimStore.updateClaim({
      knowledgeBaseId: kbId,
      id: claim.id,
      actorUserId: userId,
      fields: {
        confidence: 0.5,
        arguments: [
          { role: 'attendee', argumentKind: 'entity', entityId: entityA },
          { role: 'attendee', argumentKind: 'entity', entityId: entityB },
        ],
      },
    });

    expect(updated?.confidence).toBe(0.5);
    expect(updated?.arguments).toHaveLength(2);
    expect(updated?.arguments.map((a) => a.role)).toEqual(['attendee', 'attendee']);

    const args = await getDb()
      .select()
      .from(claimArguments)
      .where(eq(claimArguments.claimId, claim.id));
    expect(args).toHaveLength(2);

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(and(eq(graphOutbox.targetId, claim.id), eq(graphOutbox.eventType, 'claim.updated')));
    expect(outbox).toHaveLength(1);

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, claim.id), eq(auditEvents.action, 'claim.updated')));
    expect(audit).toHaveLength(1);
  });

  it('rejects an out-of-range confidence via the DB check constraint', async () => {
    await expect(
      dbClaimStore.createClaim({
        knowledgeBaseId: kbId,
        predicate: 'met',
        confidence: 2,
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: entityA }],
        actorUserId: userId,
      }),
    ).rejects.toThrow();
  });

  it('lists only non-deleted claims with their arguments, scoped by KB', async () => {
    await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      arguments: [{ role: 'subject', argumentKind: 'entity', entityId: entityA }],
      actorUserId: userId,
    });
    await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knew',
      arguments: [{ role: 'subject', argumentKind: 'entity', entityId: entityB }],
      actorUserId: userId,
    });

    const list = await dbClaimStore.listClaims(kbId);
    expect(list).toHaveLength(2);
    expect(list.every((c) => c.arguments.length === 1)).toBe(true);
  });
});
