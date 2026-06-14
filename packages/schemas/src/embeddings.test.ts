import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_INDEX_JOB_TYPE,
  EMBEDDING_TARGET_TYPES,
  embeddingIndexJobPayloadSchema,
  embeddingIndexResultSchema,
  embeddingStatusSchema,
  reindexEmbeddingsSchema,
} from './embeddings.js';

const KB = '00000000-0000-0000-0000-0000000000ab';

describe('embedding target types', () => {
  it('covers the four canonical projectable kinds', () => {
    expect([...EMBEDDING_TARGET_TYPES]).toEqual(['entity', 'claim', 'note', 'source']);
  });
});

describe('reindexEmbeddingsSchema', () => {
  it('accepts an empty body (all kinds)', () => {
    expect(reindexEmbeddingsSchema.parse({})).toEqual({});
  });

  it('accepts a targetTypes subset', () => {
    expect(reindexEmbeddingsSchema.parse({ targetTypes: ['note'] })).toEqual({
      targetTypes: ['note'],
    });
  });

  it('rejects an empty targetTypes array', () => {
    expect(reindexEmbeddingsSchema.safeParse({ targetTypes: [] }).success).toBe(false);
  });

  it('rejects an unknown target type', () => {
    expect(reindexEmbeddingsSchema.safeParse({ targetTypes: ['rule'] }).success).toBe(false);
  });
});

describe('embeddingIndexJobPayloadSchema', () => {
  it('requires a knowledge base id', () => {
    expect(embeddingIndexJobPayloadSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a KB id with optional filters', () => {
    const parsed = embeddingIndexJobPayloadSchema.parse({
      knowledgeBaseId: KB,
      targetTypes: ['entity', 'claim'],
      requestedBy: KB,
    });
    expect(parsed.knowledgeBaseId).toBe(KB);
    expect(parsed.targetTypes).toEqual(['entity', 'claim']);
  });

  it('exposes the durable job type constant', () => {
    expect(EMBEDDING_INDEX_JOB_TYPE).toBe('embeddings.index');
  });
});

describe('embeddingIndexResultSchema', () => {
  it('validates an indexed result', () => {
    const parsed = embeddingIndexResultSchema.parse({
      status: 'indexed',
      reason: null,
      indexed: 3,
      counts: { entity: 2, claim: 1, note: 0, source: 0 },
    });
    expect(parsed.indexed).toBe(3);
  });

  it('validates a skipped result', () => {
    const parsed = embeddingIndexResultSchema.parse({
      status: 'skipped',
      reason: 'AI is disabled by policy',
      indexed: 0,
      counts: { entity: 0, claim: 0, note: 0, source: 0 },
    });
    expect(parsed.status).toBe('skipped');
  });
});

describe('embeddingStatusSchema', () => {
  it('validates a status payload', () => {
    const parsed = embeddingStatusSchema.parse({
      vectorSearchAvailable: true,
      generationAvailable: false,
      reason: 'No embedding provider is configured',
      total: 5,
      counts: { entity: 2, claim: 1, note: 1, source: 1 },
      model: 'mock',
      dimensions: 8,
      lastIndexedAt: new Date().toISOString(),
      providerKind: null,
    });
    expect(parsed.vectorSearchAvailable).toBe(true);
    expect(parsed.generationAvailable).toBe(false);
  });
});
