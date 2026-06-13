import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  graphOutbox,
  knowledgeBases,
  notes,
  sources,
  users,
} from '../db/schema.js';
import { dbSearchStore } from './store.js';

/**
 * Integration tests for manual search (US-012). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${claimArguments}, ${claims}, ${notes}, ${sources}, ${graphOutbox}, ${auditEvents}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('manual search integration', () => {
  let kbId: string;
  let otherKbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'search@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Search KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
    const [other] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Other KB', createdBy: userId })
      .returning();
    otherKbId = other!.id;

    // Entity with searchable aliases/tags/description.
    await getDb()
      .insert(entities)
      .values({
        knowledgeBaseId: kbId,
        type: 'Person',
        name: 'Ada Lovelace',
        aliases: ['The Countess'],
        description: 'A mathematician and writer.',
        tags: ['pioneer'],
        createdBy: userId,
      });
    await getDb()
      .insert(entities)
      .values({
        knowledgeBaseId: kbId,
        type: 'Place',
        name: 'London',
        tags: ['city'],
        createdBy: userId,
      });
    // Entity in another KB that must never appear in kbId search.
    await getDb().insert(entities).values({
      knowledgeBaseId: otherKbId,
      type: 'Person',
      name: 'Ada Secret',
      createdBy: userId,
    });
    // Soft-deleted entity must not match.
    await getDb().insert(entities).values({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Deleted',
      deletedAt: new Date(),
      createdBy: userId,
    });

    await getDb()
      .insert(claims)
      .values({
        knowledgeBaseId: kbId,
        predicate: 'knows',
        description: 'Ada knows Charles',
        confidence: 0.8,
        provenance: { source: 'manual' },
        createdBy: userId,
      });
    await getDb().insert(notes).values({
      knowledgeBaseId: kbId,
      title: 'Research note',
      content: 'Notes about Ada and analytical engines.',
      createdBy: userId,
    });
    await getDb().insert(sources).values({
      knowledgeBaseId: kbId,
      title: 'Biography',
      sourceType: 'book',
      content: 'A detailed biography of Ada Lovelace.',
      createdBy: userId,
    });
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('token-searches across entities, claims, notes, and sources', async () => {
    const results = await dbSearchStore.search(kbId, { query: 'ada' });
    const kinds = new Set(results.map((r) => r.kind));
    expect(kinds.has('entity')).toBe(true);
    expect(kinds.has('claim')).toBe(true);
    expect(kinds.has('note')).toBe(true);
    expect(kinds.has('source')).toBe(true);
    // Must not leak the other KB's "Ada Secret" or the soft-deleted entity.
    expect(results.some((r) => r.title === 'Ada Secret')).toBe(false);
    expect(results.some((r) => r.title === 'Ada Deleted')).toBe(false);
  });

  it('matches aliases and tags', async () => {
    const byAlias = await dbSearchStore.search(kbId, { query: 'countess' });
    expect(byAlias.some((r) => r.title === 'Ada Lovelace')).toBe(true);
    const byTag = await dbSearchStore.search(kbId, { query: 'pioneer' });
    expect(byTag.some((r) => r.title === 'Ada Lovelace')).toBe(true);
  });

  it('filters by entity type and tag (entities only)', async () => {
    const byType = await dbSearchStore.search(kbId, { type: 'Place' });
    expect(byType).toHaveLength(1);
    expect(byType[0]?.title).toBe('London');
    expect(byType.every((r) => r.kind === 'entity')).toBe(true);

    const byTag = await dbSearchStore.search(kbId, { tag: 'city' });
    expect(byTag.map((r) => r.title)).toEqual(['London']);
  });

  it('filters claims by predicate, confidence, and provenance', async () => {
    const byPredicate = await dbSearchStore.search(kbId, { predicate: 'knows' });
    expect(byPredicate.every((r) => r.kind === 'claim')).toBe(true);
    expect(byPredicate).toHaveLength(1);

    const inRange = await dbSearchStore.search(kbId, { confidenceMin: 0.5, confidenceMax: 0.9 });
    expect(inRange).toHaveLength(1);
    const outOfRange = await dbSearchStore.search(kbId, { confidenceMin: 0.9 });
    expect(outOfRange).toHaveLength(0);

    const withProvenance = await dbSearchStore.search(kbId, { hasProvenance: true });
    expect(withProvenance).toHaveLength(1);
  });

  it('restricts results by requested kinds', async () => {
    const notesOnly = await dbSearchStore.search(kbId, { kinds: ['note'] });
    expect(notesOnly.every((r) => r.kind === 'note')).toBe(true);
  });

  it('reports vector search as unavailable when no embeddings exist', async () => {
    const availability = await dbSearchStore.getVectorSearchAvailability();
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/embeddings/i);
  });
});
