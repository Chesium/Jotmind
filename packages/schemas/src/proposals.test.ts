import { describe, expect, it } from 'vitest';
import {
  captureRequestSchema,
  proposalChangeSchema,
  proposalChangesSchema,
  proposalClaimArgumentSchema,
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
