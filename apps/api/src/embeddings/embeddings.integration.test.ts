import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DEFAULT_AI_POLICY, type AiPolicy } from '@jotmind/schemas';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  embeddings,
  entities,
  graphOutbox,
  knowledgeBases,
  notes,
  sources,
  users,
} from '../db/schema.js';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import { MockEmbeddingProvider } from '../ai/mock.js';
import { dbEmbeddingStore } from './store.js';
import { dbEmbeddingTargetSource } from './targets.js';
import { runEmbeddingIndex } from './indexer.js';
import type { ConfiguredEmbeddingProvider } from './provider.js';

/**
 * Integration tests for vector embeddings (US-021). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Verifies the pgvector round-trip
 * (store + nearest-neighbor search) and the indexer against real canonical rows.
 * Run with `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${embeddings}, ${claimArguments}, ${claims}, ${notes}, ${sources}, ${graphOutbox}, ${auditEvents}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

function memoryPolicyStore(policies: Partial<Record<string, AiPolicy>>): AiPolicyStore {
  const get = (key: PolicyKey): AiPolicy => policies[key.scope] ?? { ...DEFAULT_AI_POLICY };
  return {
    getPolicy: (key) => Promise.resolve(get(key)),
    getPolicies: (keys) => Promise.resolve(keys.map(get)),
    updatePolicy: () => Promise.reject(new Error('not supported')),
  };
}

const localProvider = (): ConfiguredEmbeddingProvider => ({
  provider: new MockEmbeddingProvider('Mock Embeddings', 8),
  name: 'Mock Embeddings',
  kind: 'mock',
  model: null,
  demo: true,
  remote: false,
});

const localAllowed: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };

describe.skipIf(!hasDatabase)('embeddings integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'embeddings@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Embeddings KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it('round-trips a pgvector embedding and finds it by nearest neighbor (AC1)', async () => {
    const [entity] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada Lovelace', createdBy: userId })
      .returning();

    const vector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    await dbEmbeddingStore.upsert({
      knowledgeBaseId: kbId,
      targetType: 'entity',
      targetId: entity!.id,
      model: 'mock',
      dimensions: 8,
      contentHash: 'hash1',
      embedding: vector,
    });

    expect(await dbEmbeddingStore.hasEmbeddings(kbId)).toBe(true);

    const hits = await dbEmbeddingStore.vectorSearch(kbId, vector, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetId).toBe(entity!.id);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
  });

  it('upsert replaces an existing (target, model) embedding', async () => {
    const [entity] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada', createdBy: userId })
      .returning();
    const base = {
      knowledgeBaseId: kbId,
      targetType: 'entity' as const,
      targetId: entity!.id,
      model: 'mock',
      dimensions: 8,
    };
    await dbEmbeddingStore.upsert({
      ...base,
      contentHash: 'a',
      embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    await dbEmbeddingStore.upsert({
      ...base,
      contentHash: 'b',
      embedding: [0, 1, 0, 0, 0, 0, 0, 0],
    });

    const stats = await dbEmbeddingStore.getStats(kbId);
    expect(stats.total).toBe(1);
    expect(stats.counts.entity).toBe(1);
    expect(stats.model).toBe('mock');
    expect(stats.dimensions).toBe(8);
  });

  it('indexer embeds all canonical kinds against real rows (AC2)', async () => {
    await getDb()
      .insert(entities)
      .values({
        knowledgeBaseId: kbId,
        type: 'Person',
        name: 'Ada Lovelace',
        aliases: ['Countess'],
        tags: ['pioneer'],
        createdBy: userId,
      });
    const [claim] = await getDb()
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'knows', createdBy: userId })
      .returning();
    expect(claim).toBeDefined();
    await getDb()
      .insert(notes)
      .values({ knowledgeBaseId: kbId, content: 'a note about Ada', createdBy: userId });
    await getDb()
      .insert(sources)
      .values({ knowledgeBaseId: kbId, title: 'Doc', content: 'a source', createdBy: userId });

    const result = await runEmbeddingIndex(
      {
        embeddingStore: dbEmbeddingStore,
        targetSource: dbEmbeddingTargetSource,
        aiPolicyStore: memoryPolicyStore({ server: localAllowed, knowledge_base: localAllowed }),
        resolveProvider: localProvider,
      },
      { knowledgeBaseId: kbId },
    );

    expect(result.status).toBe('indexed');
    expect(result.indexed).toBe(4);

    const stats = await dbEmbeddingStore.getStats(kbId);
    expect(stats.total).toBe(4);
    expect(stats.counts).toEqual({ entity: 1, claim: 1, note: 1, source: 1 });
  });

  it('deleteByTarget removes a record embedding', async () => {
    const [entity] = await getDb()
      .insert(entities)
      .values({ knowledgeBaseId: kbId, type: 'Person', name: 'Ada', createdBy: userId })
      .returning();
    await dbEmbeddingStore.upsert({
      knowledgeBaseId: kbId,
      targetType: 'entity',
      targetId: entity!.id,
      model: 'mock',
      dimensions: 8,
      contentHash: 'h',
      embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(await dbEmbeddingStore.hasEmbeddings(kbId)).toBe(true);
    await dbEmbeddingStore.deleteByTarget(kbId, 'entity', entity!.id);
    expect(await dbEmbeddingStore.hasEmbeddings(kbId)).toBe(false);
  });
});
