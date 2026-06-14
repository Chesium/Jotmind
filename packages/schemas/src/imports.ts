import { z } from 'zod';
import { type ProposalChange } from './proposals.js';

/**
 * Reviewable data import (US-031).
 *
 * Users import existing notes/Markdown or structured CSV/table data WITHOUT
 * uncontrolled graph mutation: an import never writes canonical records directly.
 * Instead it runs as a durable job (AC4) that parses the payload into a set of
 * candidate `ProposalChange`s and stores them as a single pending **Proposal**
 * of kind `import` (AC3). The proposal is then reviewed/accepted through the
 * existing US-018 flow, which applies the changes via the canonical write path.
 *
 * This module defines the shared, serializable shapes plus the PURE parsing /
 * change-building helpers used by both the API (job handler) and tests (and a
 * web preview, if desired). The helpers never touch the DB, filesystem, or
 * network.
 */

/** Durable job type for processing an import (US-007 + US-031 AC4). */
export const IMPORT_JOB_TYPE = 'import.process';

export const IMPORT_FORMATS = ['text', 'markdown', 'csv'] as const;
export const importFormatSchema = z.enum(IMPORT_FORMATS);
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Where a text/Markdown import is stored: as a Note or a Source (AC1). */
export const IMPORT_TEXT_TARGETS = ['note', 'source'] as const;
export const importTextTargetSchema = z.enum(IMPORT_TEXT_TARGETS);
export type ImportTextTarget = (typeof IMPORT_TEXT_TARGETS)[number];

// --- Text / Markdown import (AC1) ------------------------------------------

const textImportFields = {
  target: importTextTargetSchema.default('note'),
  title: z.string().trim().max(500).optional(),
  content: z.string().trim().min(1).max(100000),
  /** Source-only metadata, ignored when target is a note. */
  sourceType: z.string().trim().max(200).optional(),
  uri: z.string().trim().max(2000).optional(),
};

export const textImportRequestSchema = z.object({
  format: z.literal('text'),
  ...textImportFields,
});

export const markdownImportRequestSchema = z.object({
  format: z.literal('markdown'),
  ...textImportFields,
});

// --- CSV / table import (AC2) ----------------------------------------------

/** Maps a CSV column to an entity property, optionally coercing its type. */
export const csvPropertyMappingSchema = z.object({
  column: z.string().min(1).max(200),
  property: z.string().min(1).max(200),
  as: z.enum(['string', 'number', 'boolean']).default('string'),
});
export type CsvPropertyMapping = z.infer<typeof csvPropertyMappingSchema>;

/** Map CSV columns onto a new entity per row (AC2). */
export const csvEntityMappingSchema = z.object({
  target: z.literal('entity'),
  /** Fixed entity type for every row, OR a column supplying it. One required. */
  type: z.string().min(1).max(200).optional(),
  typeColumn: z.string().min(1).max(200).optional(),
  nameColumn: z.string().min(1).max(200),
  properties: z.array(csvPropertyMappingSchema).max(100).optional(),
  /** Columns whose (non-empty) values become entity tags. */
  tagColumns: z.array(z.string().min(1).max(200)).max(50).optional(),
});

/** Maps a CSV column to a claim argument role (entity-by-id or literal, AC2). */
export const csvArgumentMappingSchema = z.object({
  role: z.string().min(1).max(200),
  column: z.string().min(1).max(200),
  kind: z.enum(['entity', 'literal']).default('literal'),
});
export type CsvArgumentMapping = z.infer<typeof csvArgumentMappingSchema>;

/** Map CSV columns onto a new claim per row (AC2). */
export const csvClaimMappingSchema = z.object({
  target: z.literal('claim'),
  predicate: z.string().min(1).max(200).optional(),
  predicateColumn: z.string().min(1).max(200).optional(),
  arguments: z.array(csvArgumentMappingSchema).min(1).max(50),
});

export const csvMappingSchema = z.discriminatedUnion('target', [
  csvEntityMappingSchema,
  csvClaimMappingSchema,
]);
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export const csvImportRequestSchema = z.object({
  format: z.literal('csv'),
  /** Raw CSV/table text; the first row is the header (column names). */
  content: z.string().min(1).max(2000000),
  mapping: csvMappingSchema,
});

export const importRequestSchema = z.discriminatedUnion('format', [
  textImportRequestSchema,
  markdownImportRequestSchema,
  csvImportRequestSchema,
]);
export type ImportRequest = z.infer<typeof importRequestSchema>;

// --- Job payload + result ---------------------------------------------------

export const importJobPayloadSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  requestedBy: z.string().uuid().nullable().optional(),
  request: importRequestSchema,
});
export type ImportJobPayload = z.infer<typeof importJobPayloadSchema>;

export const IMPORT_RESULT_STATUSES = ['created', 'empty', 'error'] as const;
export const importResultStatusSchema = z.enum(IMPORT_RESULT_STATUSES);
export type ImportResultStatus = (typeof IMPORT_RESULT_STATUSES)[number];

export const importJobResultSchema = z.object({
  status: importResultStatusSchema,
  proposalId: z.string().uuid().nullable().default(null),
  itemCount: z.number().int().nonnegative(),
  /** Number of input rows processed (CSV) — 1 for a single text/markdown import. */
  rowCount: z.number().int().nonnegative(),
  error: z.string().nullable().default(null),
});
export type ImportJobResult = z.infer<typeof importJobResultSchema>;

/** Response to enqueuing an import: the durable job id + its status (AC4). */
export const importEnqueueResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
});
export type ImportEnqueueResponse = z.infer<typeof importEnqueueResponseSchema>;

// --- Pure parsing / change-building helpers --------------------------------

/**
 * Parse RFC-4180-ish CSV text into a matrix of string cells. Handles quoted
 * fields (with embedded commas, quotes via `""`, and newlines), CRLF/LF line
 * endings, and trims a trailing blank line. Pure + bounded (no eval/IO).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Swallow CR; the following LF (if any) finalizes the row.
      if (text[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field/row unless the input ended on a clean newline.
  if (field.length > 0 || row.length > 0 || inQuotes) {
    pushRow();
  }
  // Drop a trailing all-empty row produced by a terminal newline.
  while (rows.length > 0) {
    const last = rows[rows.length - 1] as string[];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    } else {
      break;
    }
  }
  return rows;
}

function coerceValue(raw: string, as: 'string' | 'number' | 'boolean'): unknown {
  if (as === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (as === 'boolean') {
    const v = raw.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(v)) return true;
    if (['false', 'no', '0', 'n'].includes(v)) return false;
    return raw;
  }
  return raw;
}

/** Thrown when an import request cannot be turned into changes (AC4 failure). */
export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/**
 * Turn a validated import request into candidate proposal changes (AC1/AC2).
 * Pure: throws {@link ImportParseError} for unrecoverable mapping problems
 * (e.g. a referenced column is missing) so the job records a clear failure.
 */
export function buildImportChanges(request: ImportRequest): {
  changes: ProposalChange[];
  rowCount: number;
} {
  if (request.format === 'text' || request.format === 'markdown') {
    if (request.target === 'source') {
      return {
        changes: [
          {
            op: 'create_source',
            title: request.title ?? 'Imported source',
            ...(request.sourceType ? { sourceType: request.sourceType } : {}),
            ...(request.uri ? { uri: request.uri } : {}),
            content: request.content,
            properties: { importFormat: request.format },
          },
        ],
        rowCount: 1,
      };
    }
    return {
      changes: [
        {
          op: 'create_note',
          ...(request.title ? { title: request.title } : {}),
          content: request.content,
          properties: { importFormat: request.format },
        },
      ],
      rowCount: 1,
    };
  }

  // CSV/table import.
  const rows = parseCsv(request.content);
  if (rows.length < 2) {
    throw new ImportParseError('CSV must have a header row and at least one data row');
  }
  const header = (rows[0] as string[]).map((h) => h.trim());
  const colIndex = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new ImportParseError(`Column "${name}" not found in CSV header`);
    return idx;
  };
  const dataRows = rows.slice(1);
  const changes: ProposalChange[] = [];
  const mapping = request.mapping;

  if (mapping.target === 'entity') {
    if (!mapping.type && !mapping.typeColumn) {
      throw new ImportParseError('Entity import requires either "type" or "typeColumn"');
    }
    const nameIdx = colIndex(mapping.nameColumn);
    const typeIdx = mapping.typeColumn ? colIndex(mapping.typeColumn) : -1;
    const propMaps = (mapping.properties ?? []).map((p) => ({ ...p, idx: colIndex(p.column) }));
    const tagIdxs = (mapping.tagColumns ?? []).map((c) => colIndex(c));
    let ref = 0;
    for (const cells of dataRows) {
      const name = (cells[nameIdx] ?? '').trim();
      if (!name) continue; // skip rows without a name
      const type =
        typeIdx >= 0 ? (cells[typeIdx] ?? '').trim() || (mapping.type ?? '') : (mapping.type ?? '');
      if (!type) throw new ImportParseError(`Row is missing an entity type for "${name}"`);
      const properties: Record<string, unknown> = {};
      for (const p of propMaps) {
        const raw = (cells[p.idx] ?? '').trim();
        if (raw !== '') properties[p.property] = coerceValue(raw, p.as);
      }
      const tags = tagIdxs.map((ti) => (cells[ti] ?? '').trim()).filter((t) => t !== '');
      changes.push({
        op: 'create_entity',
        ref: `import-${ref++}`,
        type,
        name,
        ...(tags.length ? { tags } : {}),
        ...(Object.keys(properties).length ? { properties } : {}),
      });
    }
    return { changes, rowCount: dataRows.length };
  }

  // Claim import.
  if (!mapping.predicate && !mapping.predicateColumn) {
    throw new ImportParseError('Claim import requires either "predicate" or "predicateColumn"');
  }
  const predIdx = mapping.predicateColumn ? colIndex(mapping.predicateColumn) : -1;
  const argMaps = mapping.arguments.map((a) => ({ ...a, idx: colIndex(a.column) }));
  for (const cells of dataRows) {
    const predicate =
      predIdx >= 0
        ? (cells[predIdx] ?? '').trim() || (mapping.predicate ?? '')
        : (mapping.predicate ?? '');
    if (!predicate) continue; // skip rows without a predicate
    const args = argMaps
      .map((a) => {
        const raw = (cells[a.idx] ?? '').trim();
        if (raw === '') return null;
        return a.kind === 'entity'
          ? { role: a.role, kind: 'entity' as const, ref: raw }
          : { role: a.role, kind: 'literal' as const, value: raw };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
    if (args.length === 0) continue;
    changes.push({ op: 'create_claim', predicate, arguments: args });
  }
  return { changes, rowCount: dataRows.length };
}
