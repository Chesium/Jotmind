import { describe, expect, it } from 'vitest';
import {
  classifyPredicateSpecChange,
  classifyPropertySchemaChange,
  classifySchemaChange,
  createSchemaDefinitionSchema,
  predicateSpecSchema,
  schemaDefinitionSchema,
  updateSchemaDefinitionSchema,
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

describe('classifyPropertySchemaChange (US-028)', () => {
  it('treats adding an optional field as compatible', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number', required: true } },
      { born: { type: 'number', required: true }, city: { type: 'string' } },
    );
    expect(result.changeType).toBe('compatible');
  });

  it('treats adding a required field as breaking', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number' } },
      { born: { type: 'number' }, city: { type: 'string', required: true } },
    );
    expect(result.changeType).toBe('breaking');
    expect(result.reasons.join(' ')).toContain('city');
  });

  it('treats making a field required as breaking', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number' } },
      { born: { type: 'number', required: true } },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats making a required field optional as compatible (loosen)', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number', required: true } },
      { born: { type: 'number' } },
    );
    expect(result.changeType).toBe('compatible');
  });

  it('treats changing a field type as breaking', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number' } },
      { born: { type: 'string' } },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats removing a field as breaking', () => {
    const result = classifyPropertySchemaChange(
      { born: { type: 'number' }, city: { type: 'string' } },
      { born: { type: 'number' } },
    );
    expect(result.changeType).toBe('breaking');
  });
});

describe('classifyPredicateSpecChange (US-028)', () => {
  it('treats adding an optional role as compatible', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject', required: true }] },
      { argumentRoles: [{ name: 'subject', required: true }, { name: 'note' }] },
    );
    expect(result.changeType).toBe('compatible');
  });

  it('treats adding a required role as breaking', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject', required: true }] },
      {
        argumentRoles: [
          { name: 'subject', required: true },
          { name: 'object', required: true },
        ],
      },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats removing a role as breaking', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject' }, { name: 'object' }] },
      { argumentRoles: [{ name: 'subject' }] },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats widening allowed entity types as compatible', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject', entityTypes: ['Person'] }] },
      { argumentRoles: [{ name: 'subject', entityTypes: ['Person', 'Org'] }] },
    );
    expect(result.changeType).toBe('compatible');
  });

  it('treats narrowing allowed entity types as breaking', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject', entityTypes: ['Person', 'Org'] }] },
      { argumentRoles: [{ name: 'subject', entityTypes: ['Person'] }] },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats restricting a previously unrestricted role as breaking', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'subject' }] },
      { argumentRoles: [{ name: 'subject', entityTypes: ['Person'] }] },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('treats disallowing a previously allowed literal as breaking', () => {
    const result = classifyPredicateSpecChange(
      { argumentRoles: [{ name: 'note', allowLiteral: true }] },
      { argumentRoles: [{ name: 'note', allowLiteral: false }] },
    );
    expect(result.changeType).toBe('breaking');
  });
});

describe('classifySchemaChange (US-028)', () => {
  it('dispatches on kind to the property-schema classifier', () => {
    const result = classifySchemaChange(
      'entity_type',
      { propertySchema: { born: { type: 'number' } }, spec: { argumentRoles: [] } },
      { propertySchema: { born: { type: 'string' } }, spec: { argumentRoles: [] } },
    );
    expect(result.changeType).toBe('breaking');
  });

  it('dispatches on kind to the predicate-spec classifier', () => {
    const result = classifySchemaChange(
      'claim_predicate',
      { propertySchema: {}, spec: { argumentRoles: [{ name: 'a' }] } },
      { propertySchema: {}, spec: { argumentRoles: [{ name: 'a' }, { name: 'b' }] } },
    );
    expect(result.changeType).toBe('compatible');
  });
});

describe('updateSchemaDefinitionSchema (US-028)', () => {
  it('rejects an empty update', () => {
    expect(updateSchemaDefinitionSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a metadata-only update', () => {
    expect(updateSchemaDefinitionSchema.safeParse({ displayName: 'People' }).success).toBe(true);
  });

  it('accepts a null description (clear)', () => {
    expect(updateSchemaDefinitionSchema.safeParse({ description: null }).success).toBe(true);
  });
});
