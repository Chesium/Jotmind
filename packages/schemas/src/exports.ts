import { z } from 'zod';
import { AI_PROVIDER_SECRET_FIELDS } from './ai.js';
import {
  claimSchema,
  entitySchema,
  noteSchema,
  propertySchemaSchema,
  ruleStatusSchema,
  schemaDefinitionKindSchema,
  sourceExcerptViewSchema,
  sourceSchema,
} from './graph.js';
import { auditEventSchema } from './knowledge-base.js';

// ---------------------------------------------------------------------------
// Portable Knowledge Base export / import (US-032)
//
// The portable JSON export is the FULL-FIDELITY backup format for a single
// Knowledge Base: it captures the canonical graph content (entities, claims +
// arguments, notes, sources, citations), the custom schemas WITH their full
// version history, rules, claim provenance, and export-time audit metadata.
//
// It explicitly EXCLUDES operator/server secrets such as AI provider API keys
// (those live in env/ai_policies, never in graph data). Markdown/CSV exports
// are intentionally lossy and labeled as such.
// ---------------------------------------------------------------------------

export const PORTABLE_EXPORT_FORMAT = 'jotmind.kb.portable' as const;
export const PORTABLE_EXPORT_FORMAT_VERSION = 1 as const;

export const MARKDOWN_EXPORT_LABEL =
  'Human-readable Markdown export — NOT a guaranteed full-fidelity round-trip backup. Use the Portable JSON export/import for full backup.';
export const CSV_EXPORT_LABEL =
  'Structured subset export (entities only) — NOT a guaranteed full-fidelity round-trip backup.';
export const JSON_EXPORT_LABEL = 'Full-fidelity portable graph export.';

/** One concrete schema version (the validation rules for a definition). */
export const portableSchemaVersionSchema = z.object({
  id: z.string().uuid(),
  schemaDefinitionId: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  version: z.number().int().positive(),
  propertySchema: propertySchemaSchema,
  spec: z.record(z.unknown()),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PortableSchemaVersion = z.infer<typeof portableSchemaVersionSchema>;

/** A schema definition together with its FULL version history (AC2). */
export const portableSchemaDefinitionSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  kind: schemaDefinitionKindSchema,
  name: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activeVersionId: z.string().uuid().nullable(),
  versions: z.array(portableSchemaVersionSchema).min(1),
});
export type PortableSchemaDefinition = z.infer<typeof portableSchemaDefinitionSchema>;

/** A claim with its provenance preserved (AC2). */
export const portableClaimSchema = claimSchema.extend({
  provenance: z.record(z.unknown()),
});
export type PortableClaim = z.infer<typeof portableClaimSchema>;

/** A rule definition, preserving built-in provenance + recursion cap. */
export const portableRuleSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  ruleText: z.string(),
  status: ruleStatusSchema,
  version: z.number().int().positive(),
  moduleId: z.string().nullable(),
  packId: z.string().nullable(),
  recursionCap: z.number().int().positive(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PortableRule = z.infer<typeof portableRuleSchema>;

/** The Knowledge Base metadata captured in the export. */
export const portableKnowledgeBaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PortableKnowledgeBase = z.infer<typeof portableKnowledgeBaseSchema>;

/** The full portable Knowledge Base export document (AC1/AC2/AC5). */
export const portableKnowledgeBaseExportSchema = z.object({
  format: z.literal(PORTABLE_EXPORT_FORMAT),
  formatVersion: z.literal(PORTABLE_EXPORT_FORMAT_VERSION),
  exportedAt: z.string().datetime(),
  fidelity: z.literal('portable-graph'),
  labels: z.object({
    json: z.string(),
    markdown: z.string(),
    csv: z.string(),
  }),
  secretPolicy: z.object({
    excludesProviderSecrets: z.literal(true),
    excludedSecretFields: z.array(z.string()),
  }),
  knowledgeBase: portableKnowledgeBaseSchema,
  data: z.object({
    schemas: z.array(portableSchemaDefinitionSchema),
    entities: z.array(entitySchema),
    claims: z.array(portableClaimSchema),
    notes: z.array(noteSchema),
    sources: z.array(sourceSchema),
    citations: z.array(sourceExcerptViewSchema),
    rules: z.array(portableRuleSchema),
  }),
  audit: z.object({
    note: z.string(),
    events: z.array(auditEventSchema),
  }),
});
export type PortableKnowledgeBaseExport = z.infer<typeof portableKnowledgeBaseExportSchema>;

/** Per-collection counts of what an import created. */
export const portableImportCountsSchema = z.object({
  schemaDefinitions: z.number().int().nonnegative(),
  schemaVersions: z.number().int().nonnegative(),
  entities: z.number().int().nonnegative(),
  claims: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  citations: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
});
export type PortableImportCounts = z.infer<typeof portableImportCountsSchema>;

/** Result of importing a portable export into a new Knowledge Base. */
export const portableImportResultSchema = z.object({
  importedAt: z.string().datetime(),
  knowledgeBaseId: z.string().uuid(),
  knowledgeBaseName: z.string(),
  counts: portableImportCountsSchema,
  warnings: z.array(z.string()),
});
export type PortableImportResult = z.infer<typeof portableImportResultSchema>;

/** The provider secret fields excluded from portable exports (AC5). */
export const PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS = AI_PROVIDER_SECRET_FIELDS;
