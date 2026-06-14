import { describe, expect, it } from 'vitest';
import type { ClaimRow, EntityRow, NoteRow, SourceRow } from '../db/schema.js';
import {
  buildClaimContent,
  buildEntityContent,
  buildNoteContent,
  buildSourceContent,
  hashContent,
  toIndexableTarget,
} from './content.js';

function entity(overrides: Partial<EntityRow> = {}): EntityRow {
  const now = new Date();
  return {
    id: 'e1',
    knowledgeBaseId: 'kb',
    type: 'Person',
    schemaVersionId: null,
    name: 'Ada Lovelace',
    aliases: ['Ada', 'Countess'],
    description: 'Mathematician',
    tags: ['pioneer'],
    properties: {},
    mergedIntoId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as EntityRow;
}

describe('content builders', () => {
  it('folds entity aliases + tags + description into content (AC2)', () => {
    const content = buildEntityContent(entity());
    expect(content).toContain('Ada Lovelace');
    expect(content).toContain('aliases: Ada, Countess');
    expect(content).toContain('tags: pioneer');
    expect(content).toContain('Mathematician');
  });

  it('omits empty alias/tag lines', () => {
    const content = buildEntityContent(entity({ aliases: [], tags: [], description: null }));
    expect(content).not.toContain('aliases:');
    expect(content).not.toContain('tags:');
    expect(content).toContain('Ada Lovelace');
  });

  it('builds claim content from predicate + description', () => {
    const claim = { predicate: 'knows', description: 'they met in London' } as ClaimRow;
    expect(buildClaimContent(claim)).toBe('knows\nthey met in London');
  });

  it('builds note content from title + content', () => {
    const note = { title: 'My note', content: 'body text' } as NoteRow;
    expect(buildNoteContent(note)).toBe('My note\nbody text');
  });

  it('builds source content from title, type, uri and content', () => {
    const source = {
      title: 'Doc',
      sourceType: 'web',
      uri: 'https://x',
      content: 'text',
    } as SourceRow;
    expect(buildSourceContent(source)).toBe('Doc\nweb\nhttps://x\ntext');
  });
});

describe('hashContent / toIndexableTarget', () => {
  it('is stable for the same content', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).not.toBe(hashContent('world'));
  });

  it('returns null for empty content', () => {
    expect(toIndexableTarget('note', 'n1', '')).toBeNull();
  });

  it('pairs content with a hash', () => {
    const t = toIndexableTarget('note', 'n1', 'hi');
    expect(t).toEqual({
      targetType: 'note',
      targetId: 'n1',
      content: 'hi',
      contentHash: hashContent('hi'),
    });
  });
});
