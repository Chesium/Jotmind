import { describe, expect, it } from 'vitest';
import {
  COMMAND_CONFIDENCE_THRESHOLD,
  commandInterpretationSchema,
  commandRequestSchema,
  commandResponseSchema,
} from './command.js';

describe('command schemas (US-019)', () => {
  it('requires a non-empty trimmed query', () => {
    expect(commandRequestSchema.safeParse({ q: '  ada  ' }).success).toBe(true);
    expect(commandRequestSchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(commandRequestSchema.safeParse({ q: '' }).success).toBe(false);
    expect(commandRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid search interpretation', () => {
    const parsed = commandInterpretationSchema.safeParse({
      intent: 'search',
      confidence: 0.8,
      explanation: 'looking for people',
      filters: { q: 'ada', type: 'Person', kinds: ['entity'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a valid create interpretation', () => {
    const parsed = commandInterpretationSchema.safeParse({
      intent: 'create',
      confidence: 0.7,
      changes: {
        items: [{ op: 'create_entity', ref: 'ada', type: 'Person', name: 'Ada Lovelace' }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown intent (constrained output, AC2/AC3)', () => {
    expect(
      commandInterpretationSchema.safeParse({ intent: 'delete_everything', confidence: 1 }).success,
    ).toBe(false);
  });

  it('rejects out-of-range confidence', () => {
    expect(
      commandInterpretationSchema.safeParse({ intent: 'search', confidence: 2, filters: {} })
        .success,
    ).toBe(false);
  });

  it('rejects invalid filter kinds', () => {
    expect(
      commandInterpretationSchema.safeParse({
        intent: 'search',
        confidence: 0.9,
        filters: { kinds: ['bogus'] },
      }).success,
    ).toBe(false);
  });

  it('validates a full command response with a null interpretation (fallback only)', () => {
    const parsed = commandResponseSchema.safeParse({
      query: 'ada',
      ai: {
        attempted: false,
        available: false,
        reason: 'AI is disabled by policy',
        repaired: false,
        lowConfidence: false,
        provider: null,
        model: null,
        demo: false,
        label: null,
      },
      interpretation: null,
      interpretedResults: null,
      fallback: { results: [], vectorSearch: { available: false, reason: 'no embeddings' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('exposes a confidence threshold below 1', () => {
    expect(COMMAND_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(COMMAND_CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
});
