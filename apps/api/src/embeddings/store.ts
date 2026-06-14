import { and, desc, eq, sql } from 'drizzle-orm';
import type { EmbeddingCounts, EmbeddingTargetType } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { embeddings, type EmbeddingRow } from '../db/schema.js';

export interface UpsertEmbeddingInput {
  knowledgeBaseId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  model: string;
  dimensions: number;
  contentHash: string;
  embedding: number[];
}

export interface VectorSearchHit {
  targetType: EmbeddingTargetType;
  targetId: string;
  /** Cosine similarity in [0, 1] (1 = identical). */
  score: number;
}

/** Aggregate embedding stats for a Knowledge Base. */
export interface EmbeddingKbStats {
  total: number;
  counts: EmbeddingCounts;
  model: string | null;
  dimensions: number | null;
  lastIndexedAt: Date | null;
}

const ZERO_COUNTS: EmbeddingCounts = { entity: 0, claim: 0, note: 0, source: 0 };

/**
 * Persistence boundary for vector embeddings (US-021). Defined as an interface
 * so the indexer/router can run against an in-memory fake in unit tests (no live
 * DB) while production uses the PostgreSQL + pgvector impl. Embeddings are a
 * derived index, not a soft-deleted canonical record — when a source record is
 * deleted its embedding row is removed.
 */
export interface EmbeddingStore {
  /** Insert or replace the embedding for a (target, model). */
  upsert(input: UpsertEmbeddingInput): Promise<EmbeddingRow>;
  /** Remove all embeddings for a canonical record (any model). */
  deleteByTarget(
    knowledgeBaseId: string,
    targetType: EmbeddingTargetType,
    targetId: string,
  ): Promise<void>;
  /** Aggregate stats used by the KB status endpoint (AC4/AC5). */
  getStats(knowledgeBaseId: string): Promise<EmbeddingKbStats>;
  /** Whether any embeddings exist for the KB (drives vector-search availability, AC4). */
  hasEmbeddings(knowledgeBaseId: string): Promise<boolean>;
  /** Nearest-neighbor search over stored embeddings (cosine), KB-scoped (AC4). */
  vectorSearch(
    knowledgeBaseId: string,
    queryVector: number[],
    limit: number,
  ): Promise<VectorSearchHit[]>;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/** PostgreSQL + pgvector EmbeddingStore. Resolves the Drizzle client per call. */
export const dbEmbeddingStore: EmbeddingStore = {
  async upsert(input) {
    const rows = await getDb()
      .insert(embeddings)
      .values({
        knowledgeBaseId: input.knowledgeBaseId,
        targetType: input.targetType,
        targetId: input.targetId,
        model: input.model,
        dimensions: input.dimensions,
        contentHash: input.contentHash,
        embedding: input.embedding,
      })
      .onConflictDoUpdate({
        target: [embeddings.targetType, embeddings.targetId, embeddings.model],
        set: {
          dimensions: input.dimensions,
          contentHash: input.contentHash,
          embedding: input.embedding,
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to upsert embedding');
    return row;
  },

  async deleteByTarget(knowledgeBaseId, targetType, targetId) {
    await getDb()
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.knowledgeBaseId, knowledgeBaseId),
          eq(embeddings.targetType, targetType),
          eq(embeddings.targetId, targetId),
        ),
      );
  },

  async getStats(knowledgeBaseId) {
    const db = getDb();
    const countRows = await db
      .select({ targetType: embeddings.targetType, count: sql<number>`count(*)::int` })
      .from(embeddings)
      .where(eq(embeddings.knowledgeBaseId, knowledgeBaseId))
      .groupBy(embeddings.targetType);

    const counts: EmbeddingCounts = { ...ZERO_COUNTS };
    let total = 0;
    for (const row of countRows) {
      const kind = row.targetType as EmbeddingTargetType;
      if (kind in counts) counts[kind] = row.count;
      total += row.count;
    }

    const latest = await db
      .select({
        model: embeddings.model,
        dimensions: embeddings.dimensions,
        updatedAt: embeddings.updatedAt,
      })
      .from(embeddings)
      .where(eq(embeddings.knowledgeBaseId, knowledgeBaseId))
      .orderBy(desc(embeddings.updatedAt))
      .limit(1);
    const latestRow = latest[0];

    return {
      total,
      counts,
      model: latestRow?.model ?? null,
      dimensions: latestRow?.dimensions ?? null,
      lastIndexedAt: latestRow?.updatedAt ?? null,
    };
  },

  async hasEmbeddings(knowledgeBaseId) {
    const rows = await getDb()
      .select({ one: sql<number>`1` })
      .from(embeddings)
      .where(eq(embeddings.knowledgeBaseId, knowledgeBaseId))
      .limit(1);
    return rows.length > 0;
  },

  async vectorSearch(knowledgeBaseId, queryVector, limit) {
    const literal = toVectorLiteral(queryVector);
    const rows = await getDb().execute<{
      target_type: EmbeddingTargetType;
      target_id: string;
      score: number;
    }>(sql`
      SELECT target_type, target_id, 1 - (embedding <=> ${literal}::vector) AS score
      FROM embeddings
      WHERE knowledge_base_id = ${knowledgeBaseId}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      targetType: row.target_type,
      targetId: row.target_id,
      score: Number(row.score),
    }));
  },
};
