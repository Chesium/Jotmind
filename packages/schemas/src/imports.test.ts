import { describe, expect, it } from 'vitest';
import {
  ImportParseError,
  buildImportChanges,
  importJobPayloadSchema,
  importRequestSchema,
  parseCsv,
  type ImportRequest,
} from './imports.js';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    expect(parseCsv('name,role\nAda,Math\nGrace,CS')).toEqual([
      ['name', 'role'],
      ['Ada', 'Math'],
      ['Grace', 'CS'],
    ]);
  });

  it('handles quoted fields with commas, quotes, and newlines', () => {
    const csv = 'name,note\n"Lovelace, Ada","said ""hi""\nthere"';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['Lovelace, Ada', 'said "hi"\nthere'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('importRequestSchema', () => {
  it('accepts a text import and defaults the target to note', () => {
    const parsed = importRequestSchema.parse({ format: 'text', content: 'hello' });
    expect(parsed.format).toBe('text');
    if (parsed.format === 'text') expect(parsed.target).toBe('note');
  });

  it('rejects empty text content', () => {
    expect(importRequestSchema.safeParse({ format: 'text', content: '   ' }).success).toBe(false);
  });

  it('accepts a csv entity import mapping', () => {
    const parsed = importRequestSchema.parse({
      format: 'csv',
      content: 'name\nAda',
      mapping: { target: 'entity', type: 'Person', nameColumn: 'name' },
    });
    expect(parsed.format).toBe('csv');
  });

  it('rejects an unknown format', () => {
    expect(importRequestSchema.safeParse({ format: 'pdf', content: 'x' }).success).toBe(false);
  });

  it('validates the job payload shape', () => {
    const payload = importJobPayloadSchema.parse({
      knowledgeBaseId: '11111111-1111-1111-1111-111111111111',
      requestedBy: '22222222-2222-2222-2222-222222222222',
      request: { format: 'markdown', target: 'source', title: 'Doc', content: '# Hi' },
    });
    expect(payload.request.format).toBe('markdown');
  });
});

describe('buildImportChanges — text/markdown (AC1)', () => {
  it('builds a create_note change for a text import targeting a note', () => {
    const req: ImportRequest = {
      format: 'text',
      target: 'note',
      title: 'My note',
      content: 'body',
    };
    const { changes, rowCount } = buildImportChanges(req);
    expect(rowCount).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ op: 'create_note', title: 'My note', content: 'body' });
  });

  it('builds a create_source change for a markdown import targeting a source', () => {
    const req: ImportRequest = {
      format: 'markdown',
      target: 'source',
      title: 'Doc',
      sourceType: 'article',
      content: '# Title',
    };
    const { changes } = buildImportChanges(req);
    expect(changes[0]).toMatchObject({
      op: 'create_source',
      title: 'Doc',
      sourceType: 'article',
      content: '# Title',
    });
  });

  it('falls back to a default source title when none is given', () => {
    const req: ImportRequest = { format: 'text', target: 'source', content: 'x' };
    const { changes } = buildImportChanges(req);
    expect(changes[0]).toMatchObject({ op: 'create_source', title: 'Imported source' });
  });
});

describe('buildImportChanges — csv entities (AC2)', () => {
  it('maps each row to a create_entity with name, type, properties, and tags', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'name,born,group\nAda Lovelace,1815,pioneers\nCharles Babbage,1791,pioneers',
      mapping: {
        target: 'entity',
        type: 'Person',
        nameColumn: 'name',
        properties: [{ column: 'born', property: 'born', as: 'number' }],
        tagColumns: ['group'],
      },
    };
    const { changes, rowCount } = buildImportChanges(req);
    expect(rowCount).toBe(2);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      op: 'create_entity',
      type: 'Person',
      name: 'Ada Lovelace',
      tags: ['pioneers'],
      properties: { born: 1815 },
    });
    // Each candidate entity has a unique local ref.
    expect(new Set(changes.map((c) => (c.op === 'create_entity' ? c.ref : '')))).toHaveLength(2);
  });

  it('reads the entity type from a column when typeColumn is given', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'name,kind\nAda,Person\nLondon,Place',
      mapping: { target: 'entity', typeColumn: 'kind', nameColumn: 'name' },
    };
    const { changes } = buildImportChanges(req);
    expect(changes.map((c) => (c.op === 'create_entity' ? c.type : ''))).toEqual([
      'Person',
      'Place',
    ]);
  });

  it('skips rows without a name', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'name\nAda\n\nGrace',
      mapping: { target: 'entity', type: 'Person', nameColumn: 'name' },
    };
    const { changes } = buildImportChanges(req);
    expect(changes).toHaveLength(2);
  });

  it('throws ImportParseError when a referenced column is missing', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'name\nAda',
      mapping: { target: 'entity', type: 'Person', nameColumn: 'missing' },
    };
    expect(() => buildImportChanges(req)).toThrow(ImportParseError);
  });

  it('throws when the CSV has no data rows', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'name',
      mapping: { target: 'entity', type: 'Person', nameColumn: 'name' },
    };
    expect(() => buildImportChanges(req)).toThrow(ImportParseError);
  });
});

describe('buildImportChanges — csv claims (AC2)', () => {
  it('maps each row to a create_claim with literal and entity-id arguments', () => {
    const req: ImportRequest = {
      format: 'csv',
      content: 'subjectId,city\n33333333-3333-3333-3333-333333333333,Shanghai',
      mapping: {
        target: 'claim',
        predicate: 'lives_in',
        arguments: [
          { role: 'subject', column: 'subjectId', kind: 'entity' },
          { role: 'city', column: 'city', kind: 'literal' },
        ],
      },
    };
    const { changes } = buildImportChanges(req);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      op: 'create_claim',
      predicate: 'lives_in',
      arguments: [
        { role: 'subject', kind: 'entity', ref: '33333333-3333-3333-3333-333333333333' },
        { role: 'city', kind: 'literal', value: 'Shanghai' },
      ],
    });
  });
});
