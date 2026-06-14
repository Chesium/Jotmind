import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
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
import { processOutbox, rebuildProjection, dbProjectionStore } from './projector.js';
import { ageProjector } from './age-projector.js';
import { withAge } from './age.js';
import { createAgeTraversalService } from './traversal.js';

/**
 * Integration tests for the real Apache AGE projector + traversal service
 * (US-026). Skipped when DATABASE_URL is unset so default `pnpm test:api` stays
 * green. Run with `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${graphOutbox}, ${claimArguments}, ${claims}, ${entities}, ${notes}, ${sources}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

/** Count AGE nodes/edges scoped to a Knowledge Base via the traversal session. */
async function countNodes(kbId: string, label: string): Promise<number> {
  const rows = await withAge((age) =>
    age.cypher(`MATCH (n:${label}) WHERE n.kbId = $kbId RETURN count(n)`, 'c agtype', {
      kbId,
    }),
  );
  return Number(rows[0]?.c ?? 0);
}

async function countArgumentEdges(claimId: string): Promise<number> {
  const rows = await withAge((age) =>
    age.cypher(`MATCH (c:Claim {id: $cid})-[r:ARGUMENT]->(:Entity) RETURN count(r)`, 'c agtype', {
      cid: claimId,
    }),
  );
  return Number(rows[0]?.c ?? 0);
}

describe.skipIf(!hasDatabase)('AGE projector integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await truncateAll();
    await ageProjector.prepareRebuild?.();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'age-projector@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'AGE KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await ageProjector.prepareRebuild?.();
    await truncateAll();
    await closeDb();
  });

  it('passes user text safely through Cypher parameters', async () => {
    const rows = await withAge((age) =>
      age.cypher('RETURN $x', 'x agtype', { x: `O'Brien "quoted" \\ slash` }),
    );
    expect(rows[0]?.x).toBe('"O\'Brien \\"quoted\\" \\\\ slash"');
  });

  it('projects an entity node from a graph_outbox event (AC1)', async () => {
    const entity = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      createdBy: userId,
    });

    const result = await processOutbox({ store: dbProjectionStore, projector: ageProjector });
    expect(result.failed).toBe(0);

    const rows = await withAge((age) =>
      age.cypher('MATCH (e:Entity {id: $id}) RETURN e.name', 'name agtype', { id: entity.id }),
    );
    expect(rows[0]?.name).toBe('"Ada Lovelace"');
  });

  it('projects a multi-argument claim as a claim node with role-labeled edges (AC2)', async () => {
    const ada = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    const charles = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Charles',
      createdBy: userId,
    });
    const london = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Place',
      name: 'London',
      createdBy: userId,
    });
    const claim = await dbGraphWriteStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      createdBy: userId,
      arguments: [
        { role: 'subject', entityId: ada.id },
        { role: 'object', entityId: charles.id },
        { role: 'location', entityId: london.id },
      ],
    });

    const result = await processOutbox({ store: dbProjectionStore, projector: ageProjector });
    expect(result.failed).toBe(0);

    expect(await countNodes(kbId, 'Claim')).toBe(1);
    expect(await countArgumentEdges(claim.id)).toBe(3);

    const roles = await withAge((age) =>
      age.cypher(
        `MATCH (c:Claim {id: $cid})-[r:ARGUMENT]->(e:Entity)
         RETURN r.role`,
        'role agtype',
        { cid: claim.id },
      ),
    );
    expect(roles.map((r) => r.role).sort()).toEqual(['"location"', '"object"', '"subject"']);
  });

  it('is idempotent: re-projecting a claim does not duplicate edges', async () => {
    const ada = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    const claim = await dbGraphWriteStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knows',
      createdBy: userId,
      arguments: [{ role: 'subject', entityId: ada.id }],
    });

    await processOutbox({ store: dbProjectionStore, projector: ageProjector });
    // Re-project the same claim event directly.
    await ageProjector.project({
      knowledgeBaseId: kbId,
      targetType: 'claim',
      targetId: claim.id,
      eventType: 'claim.updated',
      payload: {},
    });

    expect(await countNodes(kbId, 'Claim')).toBe(1);
    expect(await countArgumentEdges(claim.id)).toBe(1);
  });

  it('rebuilds the projection from relational tables and marks synchronized (AC3/AC4)', async () => {
    const ada = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    await dbGraphWriteStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knows',
      createdBy: userId,
      arguments: [{ role: 'subject', entityId: ada.id }],
    });

    // Wipe AGE, then rebuild purely from canonical relational tables.
    await ageProjector.prepareRebuild?.();
    expect(await countNodes(kbId, 'Entity')).toBe(0);

    const result = await rebuildProjection({
      store: dbProjectionStore,
      projector: ageProjector,
    });
    expect(result.reprojected).toBe(2);
    expect(await countNodes(kbId, 'Entity')).toBe(1);
    expect(await countNodes(kbId, 'Claim')).toBe(1);

    const status = await getDb().execute(
      sql`SELECT state FROM graph_projection_status WHERE id = 'default'`,
    );
    expect((status[0] as { state: string }).state).toBe('synchronized');
  });

  it('removes a soft-deleted entity node when its delete event is projected', async () => {
    const ada = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    await processOutbox({ store: dbProjectionStore, projector: ageProjector });
    expect(await countNodes(kbId, 'Entity')).toBe(1);

    await getDb()
      .update(entities)
      .set({ deletedAt: new Date() })
      .where(sql`id = ${ada.id}`);
    await ageProjector.project({
      knowledgeBaseId: kbId,
      targetType: 'entity',
      targetId: ada.id,
      eventType: 'entity.deleted',
      payload: {},
    });

    expect(await countNodes(kbId, 'Entity')).toBe(0);
  });

  it('traversal service returns a claim/entity neighborhood (AC6)', async () => {
    const ada = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada',
      createdBy: userId,
    });
    const charles = await dbGraphWriteStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Charles',
      createdBy: userId,
    });
    await dbGraphWriteStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'met',
      createdBy: userId,
      arguments: [
        { role: 'subject', entityId: ada.id },
        { role: 'object', entityId: charles.id },
      ],
    });
    await processOutbox({ store: dbProjectionStore, projector: ageProjector });

    const traversal = createAgeTraversalService();
    const hood = await traversal.getEntityNeighborhood({
      knowledgeBaseId: kbId,
      entityId: ada.id,
    });
    const ids = hood.nodes.map((n) => n.id);
    expect(ids).toContain(ada.id);
    expect(ids).toContain(charles.id);
    expect(hood.edges.some((e) => e.role === 'subject')).toBe(true);
    expect(hood.edges.some((e) => e.role === 'object')).toBe(true);
  });

  it('traversal service is unavailable while the projection is rebuilding (AC5)', async () => {
    const statusStore = {
      get: () =>
        Promise.resolve({
          state: 'rebuilding' as const,
          activeKnowledgeBaseId: null,
          lastJobId: null,
          lastRebuildStartedAt: null,
          lastSynchronizedAt: null,
          failedAt: null,
          lastError: null,
          updatedAt: null,
        }),
      markRebuilding: () => Promise.resolve(),
      markSynchronized: () => Promise.resolve(),
      markFailed: () => Promise.resolve(),
    };
    const traversal = createAgeTraversalService({ statusStore });
    await expect(
      traversal.getEntityNeighborhood({ knowledgeBaseId: kbId, entityId: userId }),
    ).rejects.toThrow(/rebuilding/i);
  });
});
