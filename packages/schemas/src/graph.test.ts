import { describe, expect, it } from 'vitest';
import { BUILTIN_ENTITY_TYPES, type PropertySchema, validateCustomProperties } from './graph.js';

describe('graph constants', () => {
  it('exposes the built-in entity types', () => {
    expect(BUILTIN_ENTITY_TYPES).toContain('Person');
    expect(BUILTIN_ENTITY_TYPES).toContain('Character');
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
