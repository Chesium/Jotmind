import { describe, expect, it } from 'vitest';
import { searchQuerySchema, searchResponseSchema } from './search.js';

describe('searchQuerySchema', () => {
  it('coerces numeric and boolean string params', () => {
    const parsed = searchQuerySchema.parse({
      q: 'ada',
      confidenceMin: '0.2',
      confidenceMax: '0.9',
      hasProvenance: 'true',
      limit: '25',
    });
    expect(parsed.confidenceMin).toBe(0.2);
    expect(parsed.confidenceMax).toBe(0.9);
    expect(parsed.hasProvenance).toBe(true);
    expect(parsed.limit).toBe(25);
  });

  it('treats hasProvenance=false as false', () => {
    expect(searchQuerySchema.parse({ hasProvenance: 'false' }).hasProvenance).toBe(false);
  });

  it('rejects confidenceMin greater than confidenceMax', () => {
    const result = searchQuerySchema.safeParse({ confidenceMin: '0.9', confidenceMax: '0.1' });
    expect(result.success).toBe(false);
  });

  it('accepts an empty query (filters-only / browse all)', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects out-of-range confidence', () => {
    expect(searchQuerySchema.safeParse({ confidenceMin: '2' }).success).toBe(false);
  });
});

describe('searchResponseSchema', () => {
  it('validates a response with results and vector availability', () => {
    const now = new Date().toISOString();
    const parsed = searchResponseSchema.parse({
      results: [
        {
          kind: 'entity',
          id: '11111111-1111-1111-1111-111111111111',
          knowledgeBaseId: '22222222-2222-2222-2222-222222222222',
          title: 'Ada',
          snippet: null,
          type: 'Person',
          tags: ['pioneer'],
          confidence: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      vectorSearch: { available: false, reason: 'No embeddings have been generated.' },
    });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.vectorSearch.available).toBe(false);
  });
});
