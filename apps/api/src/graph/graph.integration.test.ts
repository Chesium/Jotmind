import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  claimArguments,
  claims,
  entities,
  graphOutbox,
  knowledgeBases,
  notes,
  sources,
  users,
} from '../db/schema.js';
import { dbGraphWriteStore } from './store.js';
import {
  dbProjectionStore,
  getProjectionStatus,
  processOutbox,
  rebuildProjection,
  stubProjector,
} from './projector.js';

/**
 * Integration tests for the graph outbox + projection seam (US-006). Skipped
 * when DATABASE_URL is unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${graphOutbox}, ${claimArguments}, ${claims}, ${entities}, ${notes}, ${sources}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('graph outbox + projection integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'graph-outbox@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Outbox KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('writes a graph_outbox event in the same transaction as each canonical write', async () => {
    const entity = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    const note = await dbGraphWriteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'met Ada',
      createdBy: userId,
    });
    const source = await dbGraphWriteStore.createSource({
      knowledgeBaseId: kbId,
      title: 'Notebook',
      createdBy: userId,
    });
    const claim = await dbGraphWriteStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knows',
      confidence: 0.8,
      createdBy: userId,
      arguments: [{ role: 'subject', entityId: entity.id }],
    });

    const outbox = await getDb().select().from(graphOutbox).orderBy(graphOutbox.createdAt);
    const byTarget = new Map(outbox.map((e) => [e.targetId, e]));
    expect(byTarget.get(entity.id)?.eventType).toBe('entity.created');
    expect(byTarget.get(note.id)?.eventType).toBe('note.created');
    expect(byTarget.get(source.id)?.eventType).toBe('source.created');
    expect(byTarget.get(claim.id)?.eventType).toBe('claim.created');
    expect(outbox).toHaveLength(4);
    expect(outbox.every((e) => e.status === 'pending')).toBe(true);

    const args = await getDb()
      .select()
      .from(claimArguments)
      .where(eq(claimArguments.claimId, claim.id));
    expect(args).toHaveLength(1);
  });

  it('rolls back the outbox event when the canonical write fails', async () => {
    await expect(
      // confidence > 1 violates the claims check constraint, aborting the tx.
      dbGraphWriteStore.createClaim({
        knowledgeBaseId: kbId,
        predicate: 'invalid',
        confidence: 2,
      }),
    ).rejects.toThrow();

    const outbox = await getDb().select().from(graphOutbox);
    const claimRows = await getDb().select().from(claims);
    expect(outbox).toHaveLength(0);
    expect(claimRows).toHaveLength(0);
  });

  it('processes pending outbox events with the stub projector', async () => {
    await dbGraphWriteStore.createEntity({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada' });
    await dbGraphWriteStore.createNote({ knowledgeBaseId: kbId, content: 'note' });

    const before = await getProjectionStatus({
      store: dbProjectionStore,
      projector: stubProjector,
    });
    expect(before.projector.stubbed).toBe(true);
    expect(before.counts.pending).toBe(2);

    const result = await processOutbox({ store: dbProjectionStore, projector: stubProjector });
    expect(result).toEqual({ processed: 2, failed: 0 });

    const after = await getProjectionStatus({ store: dbProjectionStore, projector: stubProjector });
    expect(after.counts).toEqual({ pending: 0, processed: 2, failed: 0 });
  });

  it('rebuilds the projection from relational tables', async () => {
    await dbGraphWriteStore.createEntity({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada' });
    await dbGraphWriteStore.createSource({ knowledgeBaseId: kbId, title: 'Book' });
    await dbGraphWriteStore.createClaim({ knowledgeBaseId: kbId, predicate: 'p' });

    const result = await rebuildProjection({ store: dbProjectionStore, projector: stubProjector });
    expect(result.reprojected).toBe(3);
  });

  it('excludes soft-deleted records from rebuild', async () => {
    const entity = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
    });
    await getDb().update(entities).set({ deletedAt: new Date() }).where(eq(entities.id, entity.id));

    const result = await rebuildProjection({ store: dbProjectionStore, projector: stubProjector });
    expect(result.reprojected).toBe(0);
  });
});
