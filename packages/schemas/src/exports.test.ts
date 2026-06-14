import { describe, expect, it } from 'vitest';
import {
  PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS,
  portableImportResultSchema,
  portableKnowledgeBaseExportSchema,
} from './exports.js';

function validExport() {
  const kbId = '11111111-1111-1111-1111-111111111111';
  const now = new Date().toISOString();
  return {
    format: 'jotmind.kb.portable',
    formatVersion: 1,
    exportedAt: now,
    fidelity: 'portable-graph',
    labels: { json: 'a', markdown: 'b', csv: 'c' },
    secretPolicy: { excludesProviderSecrets: true, excludedSecretFields: ['apiKey'] },
    knowledgeBase: { id: kbId, name: 'KB', description: null, createdAt: now, updatedAt: now },
    data: {
      schemas: [],
      entities: [],
      claims: [],
      notes: [],
      sources: [],
      citations: [],
      rules: [],
    },
    audit: { note: 'n', events: [] },
  };
}

describe('portableKnowledgeBaseExportSchema', () => {
  it('parses a valid export', () => {
    expect(portableKnowledgeBaseExportSchema.safeParse(validExport()).success).toBe(true);
  });

  it('rejects a wrong format', () => {
    const bad = { ...validExport(), format: 'other' };
    expect(portableKnowledgeBaseExportSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a wrong format version', () => {
    const bad = { ...validExport(), formatVersion: 2 };
    expect(portableKnowledgeBaseExportSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a data bucket', () => {
    const bad = validExport() as Record<string, unknown>;
    delete bad.data;
    expect(portableKnowledgeBaseExportSchema.safeParse(bad).success).toBe(false);
  });

  it('exposes apiKey as an excluded secret field', () => {
    expect(PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS).toContain('apiKey');
  });
});

describe('portableImportResultSchema', () => {
  it('parses a result', () => {
    const result = {
      importedAt: new Date().toISOString(),
      knowledgeBaseId: '11111111-1111-1111-1111-111111111111',
      knowledgeBaseName: 'KB',
      counts: {
        schemaDefinitions: 1,
        schemaVersions: 1,
        entities: 2,
        claims: 1,
        notes: 0,
        sources: 0,
        citations: 0,
        rules: 0,
      },
      warnings: [],
    };
    expect(portableImportResultSchema.safeParse(result).success).toBe(true);
  });
});
