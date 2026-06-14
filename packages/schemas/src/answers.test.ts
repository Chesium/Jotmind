import { describe, expect, it } from 'vitest';
import {
  ANSWER_FACT_KINDS,
  answerCitationSchema,
  answerRequestSchema,
  answerResponseSchema,
  answerStatementSchema,
  generatedAnswerSchema,
} from './answers.js';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('answer schemas (US-020)', () => {
  it('accepts a valid question and trims it', () => {
    const parsed = answerRequestSchema.parse({ q: '  who knows Ada?  ' });
    expect(parsed.q).toBe('who knows Ada?');
  });

  it('rejects an empty question', () => {
    expect(answerRequestSchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('exposes the four fact kinds (AC5)', () => {
    expect([...ANSWER_FACT_KINDS]).toEqual(['known', 'inferred', 'uncertain', 'missing']);
  });

  it('validates a claim citation with predicate/entities/confidence/provenance (AC3)', () => {
    const citation = answerCitationSchema.parse({
      ref: 0,
      kind: 'claim',
      id: UUID,
      knowledgeBaseId: UUID,
      title: 'knows',
      snippet: null,
      predicate: 'knows',
      entities: [
        { role: 'subject', entityId: UUID, name: 'Ada' },
        { role: 'object', entityId: null, name: 'London' },
      ],
      confidence: 0.9,
      provenance: { origin: 'manual' },
    });
    expect(citation.entities).toHaveLength(2);
    expect(citation.predicate).toBe('knows');
  });

  it('requires statement fact kind to be one of the enum values', () => {
    expect(
      answerStatementSchema.safeParse({ text: 'x', factKind: 'bogus', citations: [] }).success,
    ).toBe(false);
    expect(
      answerStatementSchema.safeParse({ text: 'x', factKind: 'known', citations: [0, 1] }).success,
    ).toBe(true);
  });

  it('rejects an empty statement text', () => {
    expect(
      answerStatementSchema.safeParse({ text: '  ', factKind: 'known', citations: [] }).success,
    ).toBe(false);
  });

  it('validates a full generated answer', () => {
    const answer = generatedAnswerSchema.parse({
      summary: 'Ada knows people.',
      statements: [{ text: 'Ada knows Charles.', factKind: 'known', citations: [0] }],
    });
    expect(answer.statements[0]?.citations).toEqual([0]);
  });

  it('validates a full answer response with a null answer (No-AI mode)', () => {
    const response = answerResponseSchema.parse({
      query: 'who?',
      ai: {
        attempted: false,
        available: false,
        reason: 'No AI provider is configured',
        repaired: false,
        provider: null,
        model: null,
        demo: false,
        verified: false,
        label: null,
      },
      answer: null,
      citations: [],
      fallback: { results: [], vectorSearch: { available: false, reason: 'none' } },
    });
    expect(response.answer).toBeNull();
  });
});
