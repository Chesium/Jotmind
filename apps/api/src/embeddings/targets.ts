import { and, eq, isNull } from 'drizzle-orm';
import type { EmbeddingTargetType } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { claims, entities, notes, sources } from '../db/schema.js';
import {
  buildClaimContent,
  buildEntityContent,
  buildNoteContent,
  buildSourceContent,
  toIndexableTarget,
  type IndexableTarget,
} from './content.js';

/**
 * Reads canonical records and turns them into {@link IndexableTarget}s for the
 * embedding indexer (US-021 AC2). Defined as an interface so the indexer can be
 * unit-tested against an in-memory fake (no live DB). Only non-deleted records
 * are returned (`deleted_at IS NULL`).
 */
export interface EmbeddingTargetSource {
  listTargets(
    knowledgeBaseId: string,
    targetTypes: EmbeddingTargetType[],
  ): Promise<IndexableTarget[]>;
}

/** PostgreSQL-backed target source. */
export const dbEmbeddingTargetSource: EmbeddingTargetSource = {
  async listTargets(knowledgeBaseId, targetTypes) {
    const db = getDb();
    const wanted = new Set(targetTypes);
    const targets: IndexableTarget[] = [];

    if (wanted.has('entity')) {
      const rows = await db
        .select()
        .from(entities)
        .where(and(eq(entities.knowledgeBaseId, knowledgeBaseId), isNull(entities.deletedAt)));
      for (const row of rows) {
        const t = toIndexableTarget('entity', row.id, buildEntityContent(row));
        if (t) targets.push(t);
      }
    }

    if (wanted.has('claim')) {
      const rows = await db
        .select()
        .from(claims)
        .where(and(eq(claims.knowledgeBaseId, knowledgeBaseId), isNull(claims.deletedAt)));
      for (const row of rows) {
        const t = toIndexableTarget('claim', row.id, buildClaimContent(row));
        if (t) targets.push(t);
      }
    }

    if (wanted.has('note')) {
      const rows = await db
        .select()
        .from(notes)
        .where(and(eq(notes.knowledgeBaseId, knowledgeBaseId), isNull(notes.deletedAt)));
      for (const row of rows) {
        const t = toIndexableTarget('note', row.id, buildNoteContent(row));
        if (t) targets.push(t);
      }
    }

    if (wanted.has('source')) {
      const rows = await db
        .select()
        .from(sources)
        .where(and(eq(sources.knowledgeBaseId, knowledgeBaseId), isNull(sources.deletedAt)));
      for (const row of rows) {
        const t = toIndexableTarget('source', row.id, buildSourceContent(row));
        if (t) targets.push(t);
      }
    }

    return targets;
  },
};
