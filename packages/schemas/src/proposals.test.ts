import { describe, expect, it } from 'vitest';
import {
  acceptProposalSchema,
  captureRequestSchema,
  editProposalSchema,
  proposalChangeSchema,
  proposalChangesSchema,
  proposalClaimArgumentSchema,
  rejectProposalSchema,
} from './proposals.js';

describe('proposal changes', () => {
  it('accepts a create_entity change', () => {
    const parsed = proposalChangeSchema.parse({
      op: 'create_entity',
      ref: 'ada',
      type: 'Person',
      name: 'Ada Lovelace',
    });
    expect(parsed.op).toBe('create_entity');
  });

  it('accepts a create_claim change with entity arguments', () => {
    const parsed = proposalChangeSchema.parse({
      op: 'create_claim',
      predicate: 'knows',
      arguments: [
        { role: 'subject', kind: 'entity', ref: 'ada' },
        { role: 'object', kind: 'entity', ref: 'charles' },
      ],
    });
    expect(parsed.op).toBe('create_claim');
  });

  it('requires a ref for an entity argument', () => {
    const result = proposalClaimArgumentSchema.safeParse({ role: 'subject', kind: 'entity' });
    expect(result.success).toBe(false);
  });

  it('requires a value for a literal argument', () => {
    const result = proposalClaimArgumentSchema.safeParse({ role: 'topic', kind: 'literal' });
    expect(result.success).toBe(false);
  });

  it('defaults the argument kind to entity', () => {
    const parsed = proposalClaimArgumentSchema.parse({ role: 'subject', ref: 'ada' });
    expect(parsed.kind).toBe('entity');
  });

  it('defaults items to an empty array', () => {
    expect(proposalChangesSchema.parse({}).items).toEqual([]);
  });

  it('rejects an unknown op', () => {
    const result = proposalChangeSchema.safeParse({ op: 'delete_everything' });
    expect(result.success).toBe(false);
  });
});

describe('captureRequestSchema', () => {
  it('defaults kind to note and requires content', () => {
    const parsed = captureRequestSchema.parse({ content: 'hello world' });
    expect(parsed.kind).toBe('note');
  });

  it('rejects empty content', () => {
    const result = captureRequestSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });
});

describe('proposal review schemas (US-018)', () => {
  it('accepts an empty accept request (batch accept)', () => {
    expect(acceptProposalSchema.parse({})).toEqual({});
  });

  it('accepts item-level indexes and a confirmation note', () => {
    const parsed = acceptProposalSchema.parse({ itemIndexes: [0, 2], note: 'ok' });
    expect(parsed.itemIndexes).toEqual([0, 2]);
    expect(parsed.note).toBe('ok');
  });

  it('rejects an empty itemIndexes array', () => {
    expect(acceptProposalSchema.safeParse({ itemIndexes: [] }).success).toBe(false);
  });

  it('rejects negative item indexes', () => {
    expect(acceptProposalSchema.safeParse({ itemIndexes: [-1] }).success).toBe(false);
  });

  it('parses a reject request with reason and dismiss', () => {
    const parsed = rejectProposalSchema.parse({ reason: 'noise', dismiss: true });
    expect(parsed.reason).toBe('noise');
    expect(parsed.dismiss).toBe(true);
  });

  it('re-validates edited changes (invalid payloads rejected, AC4)', () => {
    expect(
      editProposalSchema.safeParse({
        changes: { items: [{ op: 'create_entity', ref: 'x', type: 'Person', name: 'A' }] },
      }).success,
    ).toBe(true);
    expect(
      editProposalSchema.safeParse({ changes: { items: [{ op: 'create_entity', ref: 'x' }] } })
        .success,
    ).toBe(false);
  });
});
