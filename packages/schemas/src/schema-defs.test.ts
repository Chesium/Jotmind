import { describe, expect, it } from 'vitest';
import {
  createSchemaDefinitionSchema,
  predicateSpecSchema,
  schemaDefinitionSchema,
  validateEntityProperties,
  validatePredicateArguments,
} from './schema-defs.js';

describe('createSchemaDefinitionSchema', () => {
  it('accepts an entity type with a property schema', () => {
    const parsed = createSchemaDefinitionSchema.parse({
      kind: 'entity_type',
      name: 'Person',
      displayName: 'Person',
      propertySchema: { age: { type: 'number', required: true } },
    });
    expect(parsed.kind).toBe('entity_type');
    expect(parsed.propertySchema?.age?.type).toBe('number');
  });

  it('accepts a claim predicate with argument roles + compatible entity types', () => {
    const parsed = createSchemaDefinitionSchema.parse({
      kind: 'claim_predicate',
      name: 'knows',
      displayName: 'knows',
      spec: {
        argumentRoles: [
          { name: 'subject', required: true, entityTypes: ['Person'] },
          { name: 'object', required: true, entityTypes: ['Person'] },
        ],
      },
    });
    expect(parsed.spec?.argumentRoles).toHaveLength(2);
  });

  it('rejects an unknown kind', () => {
    expect(
      createSchemaDefinitionSchema.safeParse({ kind: 'nope', name: 'x', displayName: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(
      createSchemaDefinitionSchema.safeParse({
        kind: 'entity_type',
        name: '',
        displayName: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('schemaDefinitionSchema', () => {
  it('parses a definition with no active version', () => {
    const parsed = schemaDefinitionSchema.parse({
      id: 'd1',
      knowledgeBaseId: 'kb1',
      kind: 'entity_type',
      name: 'Person',
      displayName: 'Person',
      description: null,
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeVersion: null,
    });
    expect(parsed.activeVersion).toBeNull();
  });
});

describe('validateEntityProperties', () => {
  it('flags missing required and wrong-typed fields', () => {
    const result = validateEntityProperties(
      { age: { type: 'number', required: true }, name: { type: 'string' } },
      { name: 123 },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.field).sort()).toEqual(['age', 'name']);
  });

  it('accepts a valid payload', () => {
    const result = validateEntityProperties({ age: { type: 'number' } }, { age: 30 });
    expect(result.valid).toBe(true);
  });
});

describe('validatePredicateArguments', () => {
  const spec = predicateSpecSchema.parse({
    argumentRoles: [
      { name: 'subject', required: true, entityTypes: ['Person'] },
      { name: 'object', required: true, entityTypes: ['Person'] },
      { name: 'note', allowLiteral: true },
    ],
  });

  it('accepts arguments matching the spec', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'entity', entityType: 'Person' },
      { role: 'object', argumentKind: 'entity', entityType: 'Person' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('flags a missing required role', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'entity', entityType: 'Person' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('object');
  });

  it('flags an incompatible entity type', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'entity', entityType: 'Place' },
      { role: 'object', argumentKind: 'entity', entityType: 'Person' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('subject');
  });

  it('rejects an undeclared role', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'entity', entityType: 'Person' },
      { role: 'object', argumentKind: 'entity', entityType: 'Person' },
      { role: 'bogus', argumentKind: 'entity', entityType: 'Person' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('bogus');
  });

  it('rejects a literal for a role that does not allow it', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'literal' },
      { role: 'object', argumentKind: 'entity', entityType: 'Person' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.field).toBe('subject');
  });

  it('allows a literal for a role that permits it', () => {
    const result = validatePredicateArguments(spec, [
      { role: 'subject', argumentKind: 'entity', entityType: 'Person' },
      { role: 'object', argumentKind: 'entity', entityType: 'Person' },
      { role: 'note', argumentKind: 'literal' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('accepts any arguments when the spec declares no roles', () => {
    const result = validatePredicateArguments({ argumentRoles: [] }, [
      { role: 'whatever', argumentKind: 'entity', entityType: 'Thing' },
    ]);
    expect(result.valid).toBe(true);
  });
});
