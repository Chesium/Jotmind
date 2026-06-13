import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from './client.js';
import { runMigrations } from './migrate.js';
import {
  claimArguments,
  claims,
  entities,
  graphOutbox,
  knowledgeBases,
  notes,
  sources,
  users,
} from './schema.js';

/**
 * Integration tests for the canonical graph schema tables (US-005). Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run against the
 * reference Docker image: `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

const GRAPH_TABLES = [
  'schema_definitions',
  'schema_versions',
  'entities',
  'claims',
  'claim_arguments',
  'notes',
  'sources',
  'source_excerpts',
  'rule_definitions',
  'proposals',
  'jobs',
  'graph_outbox',
] as const;

describe.skipIf(!hasDatabase)('graph schema integration', () => {
  beforeAll(async () => {
    await runMigrations();
    await getDb().execute(
      sql`TRUNCATE TABLE ${graphOutbox}, ${claimArguments}, ${claims}, ${entities}, ${notes}, ${sources}, ${knowledgeBases}, ${users} CASCADE`,
    );
  });

  afterAll(async () => {
    await getDb().execute(
      sql`TRUNCATE TABLE ${graphOutbox}, ${claimArguments}, ${claims}, ${entities}, ${notes}, ${sources}, ${knowledgeBases}, ${users} CASCADE`,
    );
    await closeDb();
  });

  it('creates all canonical graph tables', async () => {
    const db = getDb();
    for (const table of GRAPH_TABLES) {
      const rows = await db.execute<{ exists: boolean }>(
        sql`SELECT to_regclass(${'public.' + table}) IS NOT NULL AS exists`,
      );
      expect(rows[0]?.exists, `table ${table} should exist`).toBe(true);
    }
  });

  it('stores entities, multi-argument claims, notes, sources, and outbox events with UUIDv7 ids', async () => {
    const db = getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: 'graph@integration.test', passwordHash: 'x' })
      .returning();
    const [kb] = await db
      .insert(knowledgeBases)
      .values({ name: 'Graph KB', createdBy: owner!.id })
      .returning();
    const kbId = kb!.id;

    // Notes and Sources are canonical records, not entity rows (AC5).
    const [note] = await db
      .insert(notes)
      .values({ knowledgeBaseId: kbId, content: 'met Ada at the conference', createdBy: owner!.id })
      .returning();
    expect(note!.id).toMatch(/^[0-9a-f-]{36}$/);
    const [source] = await db
      .insert(sources)
      .values({ knowledgeBaseId: kbId, title: 'Notebook', sourceType: 'book', uri: 'file:///n' })
      .returning();
    expect(source!.id).toBeDefined();

    // Two entities + a multi-argument claim referencing both (AC: not binary edges).
    const [ada] = await db
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada', aliases: ['Countess'] })
      .returning();
    const [charles] = await db
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Charles' })
      .returning();

    const [claim] = await db
      .insert(claims)
      .values({
        knowledgeBaseId: kbId,
        predicate: 'collaborated_with',
        confidence: 0.9,
        description: 'worked together on the engine',
      })
      .returning();

    await db.insert(claimArguments).values([
      {
        knowledgeBaseId: kbId,
        claimId: claim!.id,
        role: 'subject',
        position: 0,
        entityId: ada!.id,
      },
      {
        knowledgeBaseId: kbId,
        claimId: claim!.id,
        role: 'object',
        position: 1,
        entityId: charles!.id,
      },
      {
        knowledgeBaseId: kbId,
        claimId: claim!.id,
        role: 'topic',
        position: 2,
        argumentKind: 'literal',
        value: { text: 'Analytical Engine' },
      },
    ]);

    const args = await db.select().from(claimArguments);
    expect(args).toHaveLength(3);

    // graph_outbox event written alongside (US-006 wires this into write tx).
    const [event] = await db
      .insert(graphOutbox)
      .values({
        knowledgeBaseId: kbId,
        eventType: 'claim.created',
        targetType: 'claim',
        targetId: claim!.id,
        payload: { predicate: 'collaborated_with' },
      })
      .returning();
    expect(event!.status).toBe('pending');
    expect(event!.attempts).toBe(0);

    // UUIDv7 ids are time-sortable: ada was inserted before charles.
    expect(ada!.id < charles!.id).toBe(true);
  });

  it('rejects out-of-range confidence via the check constraint', async () => {
    const db = getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: 'graph2@integration.test', passwordHash: 'x' })
      .returning();
    const [kb] = await db
      .insert(knowledgeBases)
      .values({ name: 'KB2', createdBy: owner!.id })
      .returning();

    await expect(
      db.insert(claims).values({ knowledgeBaseId: kb!.id, predicate: 'p', confidence: 2 }),
    ).rejects.toThrow();
  });
});
