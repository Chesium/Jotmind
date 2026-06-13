import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ENTITY_TYPES,
  createClaimSchema,
  createEntitySchema,
  updateClaimSchema,
  updateEntitySchema,
  type PropertySchema,
  validateCustomProperties,
} from './graph.js';

describe('graph constants', () => {
  it('exposes the built-in entity types', () => {
    expect(BUILTIN_ENTITY_TYPES).toContain('Person');
    expect(BUILTIN_ENTITY_TYPES).toContain('Character');
  });
});

describe('createEntitySchema', () => {
  it('requires type and name', () => {
    expect(createEntitySchema.safeParse({ type: 'Person' }).success).toBe(false);
    expect(createEntitySchema.safeParse({ name: 'Ada' }).success).toBe(false);
    expect(createEntitySchema.safeParse({ type: '', name: 'Ada' }).success).toBe(false);
  });

  it('accepts a full payload and trims strings', () => {
    const parsed = createEntitySchema.parse({
      type: 'Person',
      name: '  Ada  ',
      aliases: ['Ada Lovelace'],
      tags: ['pioneer'],
      properties: { born: 1815 },
    });
    expect(parsed.name).toBe('Ada');
    expect(parsed.aliases).toEqual(['Ada Lovelace']);
  });
});

describe('updateEntitySchema', () => {
  it('rejects an empty payload', () => {
    expect(updateEntitySchema.safeParse({}).success).toBe(false);
  });

  it('allows partial updates including null description', () => {
    expect(updateEntitySchema.safeParse({ name: 'Tail recursion' }).success).toBe(true);
    expect(updateEntitySchema.safeParse({ description: null }).success).toBe(true);
  });
});

const ENTITY_A = '22222222-2222-2222-2222-222222222222';
const ENTITY_B = '33333333-3333-3333-3333-333333333333';

describe('createClaimSchema', () => {
  it('requires a predicate and at least one argument', () => {
    expect(createClaimSchema.safeParse({ predicate: 'met', arguments: [] }).success).toBe(false);
    expect(
      createClaimSchema.safeParse({
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      }).success,
    ).toBe(false);
  });

  it('accepts a multi-argument claim with entity and literal arguments', () => {
    const parsed = createClaimSchema.parse({
      predicate: 'met',
      confidence: 0.7,
      arguments: [
        { role: 'subject', argumentKind: 'entity', entityId: ENTITY_A },
        { role: 'object', argumentKind: 'entity', entityId: ENTITY_B },
        { role: 'location', argumentKind: 'literal', value: 'Berlin' },
      ],
    });
    expect(parsed.arguments).toHaveLength(3);
    expect(parsed.arguments[2]?.value).toBe('Berlin');
  });

  it('defaults argumentKind to entity', () => {
    const parsed = createClaimSchema.parse({
      predicate: 'met',
      arguments: [{ role: 'subject', entityId: ENTITY_A }],
    });
    expect(parsed.arguments[0]?.argumentKind).toBe('entity');
  });

  it('rejects an entity argument without entityId', () => {
    expect(
      createClaimSchema.safeParse({
        predicate: 'met',
        arguments: [{ role: 'subject', argumentKind: 'entity' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a literal argument without a value', () => {
    expect(
      createClaimSchema.safeParse({
        predicate: 'met',
        arguments: [{ role: 'location', argumentKind: 'literal' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a valid-time range where start is after end', () => {
    expect(
      createClaimSchema.safeParse({
        predicate: 'met',
        validStart: '2021-01-01T00:00:00.000Z',
        validEnd: '2020-01-01T00:00:00.000Z',
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      }).success,
    ).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(
      createClaimSchema.safeParse({
        predicate: 'met',
        confidence: 1.5,
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      }).success,
    ).toBe(false);
  });
});

describe('updateClaimSchema', () => {
  it('rejects an empty payload', () => {
    expect(updateClaimSchema.safeParse({}).success).toBe(false);
  });

  it('allows partial metadata updates including null description', () => {
    expect(updateClaimSchema.safeParse({ predicate: 'knew' }).success).toBe(true);
    expect(updateClaimSchema.safeParse({ description: null }).success).toBe(true);
  });

  it('allows replacing the argument set but rejects an empty one', () => {
    expect(
      updateClaimSchema.safeParse({
        arguments: [{ role: 'attendee', argumentKind: 'entity', entityId: ENTITY_A }],
      }).success,
    ).toBe(true);
    expect(updateClaimSchema.safeParse({ arguments: [] }).success).toBe(false);
  });
});

describe('validateCustomProperties', () => {
  it('accepts any payload when the schema is empty', () => {
    expect(validateCustomProperties({}, { anything: 1, foo: 'bar' })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('passes when required fields are present and well-typed', () => {
    const schema: PropertySchema = {
      age: { type: 'number', required: true },
      nickname: { type: 'string', required: false },
      birthday: { type: 'date', required: false },
    };
    const result = validateCustomProperties(schema, {
      age: 42,
      nickname: 'Ada',
      birthday: '1815-12-10',
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags missing required fields', () => {
    const schema: PropertySchema = { age: { type: 'number', required: true } };
    const result = validateCustomProperties(schema, {});
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([{ field: 'age', message: '"age" is required' }]);
  });

  it('flags type mismatches', () => {
    const schema: PropertySchema = { age: { type: 'number', required: true } };
    const result = validateCustomProperties(schema, { age: 'not-a-number' });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('age');
  });

  it('flags unknown fields not allowed by the schema', () => {
    const schema: PropertySchema = { age: { type: 'number' } };
    const result = validateCustomProperties(schema, { age: 1, extra: true });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { field: 'extra', message: '"extra" is not allowed by the schema' },
    ]);
  });

  it('treats absent optional fields as valid', () => {
    const schema: PropertySchema = { nickname: { type: 'string' } };
    expect(validateCustomProperties(schema, {}).valid).toBe(true);
  });

  it('rejects invalid date strings', () => {
    const schema: PropertySchema = { when: { type: 'date' } };
    expect(validateCustomProperties(schema, { when: 'not-a-date' }).valid).toBe(false);
  });
});
