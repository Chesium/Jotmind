import { createHash } from 'node:crypto';
import type { EmbeddingTargetType } from '@jotmind/schemas';
import type { ClaimRow, EntityRow, NoteRow, SourceRow } from '../db/schema.js';

/**
 * Build the text that represents a canonical record for embedding (US-021 AC2).
 * Entity content folds in aliases and tags (so they participate in semantic
 * search without being separate embedding targets); claims fold in their
 * predicate + description; notes/sources fold in title + content. Returns an
 * empty string when there is nothing meaningful to embed (caller skips those).
 */

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join('\n');
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export function buildEntityContent(row: EntityRow): string {
  const aliases = asStringArray(row.aliases);
  const tags = asStringArray(row.tags);
  return joinParts([
    row.type,
    row.name,
    aliases.length > 0 ? `aliases: ${aliases.join(', ')}` : null,
    tags.length > 0 ? `tags: ${tags.join(', ')}` : null,
    row.description,
  ]);
}

export function buildClaimContent(row: ClaimRow): string {
  return joinParts([row.predicate, row.description]);
}

export function buildNoteContent(row: NoteRow): string {
  return joinParts([row.title, row.content]);
}

export function buildSourceContent(row: SourceRow): string {
  return joinParts([row.title, row.sourceType, row.uri, row.content]);
}

/** A record paired with the text + hash to embed. */
export interface IndexableTarget {
  targetType: EmbeddingTargetType;
  targetId: string;
  content: string;
  contentHash: string;
}

/** Stable content hash so re-indexing can skip unchanged records. */
export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Pair a record's content with a stable hash, or null when there's nothing to embed. */
export function toIndexableTarget(
  targetType: EmbeddingTargetType,
  targetId: string,
  content: string,
): IndexableTarget | null {
  if (content.length === 0) return null;
  return { targetType, targetId, content, contentHash: hashContent(content) };
}
