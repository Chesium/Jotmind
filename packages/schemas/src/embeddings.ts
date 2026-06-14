import { z } from 'zod';

/**
 * Embedding indexing & vector search (US-021).
 *
 * Embeddings are stored in PostgreSQL using `pgvector` and generated through
 * durable background jobs (US-007). This module defines the **shared,
 * serializable shapes** exchanged with the web client:
 *
 * - which canonical records can be indexed ({@link EMBEDDING_TARGET_TYPES}),
 * - the public embedding record shape (NEVER the raw vector),
 * - the KB-scoped embedding status (drives the vector-search availability UI,
 *   AC4/AC5), and
 * - the reindex request/response for enqueuing an indexing job.
 *
 * The concrete pgvector store, content builder, indexer, and HTTP router live in
 * `apps/api/src/embeddings/`.
 */

/**
 * Canonical record kinds that can be embedded (AC2). Aliases and tags are folded
 * into the entity's embedding content rather than being separate target types.
 */
export const EMBEDDING_TARGET_TYPES = ['entity', 'claim', 'note', 'source'] as const;
export const embeddingTargetTypeSchema = z.enum(EMBEDDING_TARGET_TYPES);
export type EmbeddingTargetType = (typeof EMBEDDING_TARGET_TYPES)[number];

/**
 * Public embedding record shape. The raw vector is intentionally NOT exposed
 * over the API — only metadata about what has been indexed.
 */
export const embeddingRecordSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  targetType: embeddingTargetTypeSchema,
  targetId: z.string().uuid(),
  model: z.string(),
  dimensions: z.number().int().positive(),
  contentHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;

/** Per-target-type embedding counts for a Knowledge Base. */
export const embeddingCountsSchema = z.object({
  entity: z.number().int().nonnegative(),
  claim: z.number().int().nonnegative(),
  note: z.number().int().nonnegative(),
  source: z.number().int().nonnegative(),
});
export type EmbeddingCounts = z.infer<typeof embeddingCountsSchema>;

/**
 * KB-scoped embedding status (AC4/AC5).
 *
 * - `vectorSearchAvailable` reflects whether **stored** embeddings exist, so
 *   existing embeddings can power vector search even when the generation
 *   provider is currently unavailable (AC4).
 * - `generationAvailable` reflects whether new embeddings can currently be
 *   generated (a provider is configured AND policy permits it). When it is
 *   false but `vectorSearchAvailable` is true, existing embeddings remain
 *   usable (AC4).
 */
export const embeddingStatusSchema = z.object({
  vectorSearchAvailable: z.boolean(),
  generationAvailable: z.boolean(),
  /** Why generation is unavailable, when applicable. */
  reason: z.string().nullable(),
  /** Total stored embeddings in the Knowledge Base. */
  total: z.number().int().nonnegative(),
  counts: embeddingCountsSchema,
  /** The model that generated the most recent embeddings, when any exist. */
  model: z.string().nullable(),
  dimensions: z.number().int().positive().nullable(),
  /** When the most recent embedding was written, ISO string or null. */
  lastIndexedAt: z.string().nullable(),
  /** Whether the configured generation provider is remote (AC3). */
  providerKind: z.string().nullable(),
});
export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>;

/**
 * Request to (re)index embeddings for a Knowledge Base. An optional
 * `targetTypes` filter restricts which kinds are indexed; omitted = all kinds.
 */
export const reindexEmbeddingsSchema = z.object({
  targetTypes: z.array(embeddingTargetTypeSchema).min(1).optional(),
});
export type ReindexEmbeddings = z.infer<typeof reindexEmbeddingsSchema>;

/** Job type for the durable embedding indexing job (US-007 registry key). */
export const EMBEDDING_INDEX_JOB_TYPE = 'embeddings.index';

/** Payload carried by an {@link EMBEDDING_INDEX_JOB_TYPE} job. */
export const embeddingIndexJobPayloadSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  targetTypes: z.array(embeddingTargetTypeSchema).min(1).optional(),
  /** The user who requested the indexing (their AI policy layer applies). */
  requestedBy: z.string().uuid().nullable().optional(),
});
export type EmbeddingIndexJobPayload = z.infer<typeof embeddingIndexJobPayloadSchema>;

/** Summary of an embedding indexing run, stored as the job result. */
export const embeddingIndexResultSchema = z.object({
  status: z.enum(['indexed', 'skipped']),
  reason: z.string().nullable(),
  indexed: z.number().int().nonnegative(),
  counts: embeddingCountsSchema,
});
export type EmbeddingIndexResult = z.infer<typeof embeddingIndexResultSchema>;
