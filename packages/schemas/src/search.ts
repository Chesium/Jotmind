import { z } from 'zod';

/**
 * Manual search & filters (US-012). Token search and structured filters work
 * WITHOUT any AI provider so the app stays useful in `No AI` mode. Vector
 * search is optional: when embeddings do not exist it is reported as
 * unavailable without breaking token search (AC4).
 */

/** Canonical record kinds that manual search can return. */
export const SEARCH_RESULT_KINDS = ['entity', 'claim', 'note', 'source'] as const;
export const searchResultKindSchema = z.enum(SEARCH_RESULT_KINDS);
export type SearchResultKind = z.infer<typeof searchResultKindSchema>;

/**
 * A single unified search hit. `title` is the display label, `snippet` is a
 * short excerpt of the matching text, `type` is the entity type or claim
 * predicate where applicable.
 */
export const searchResultSchema = z.object({
  kind: searchResultKindSchema,
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  title: z.string(),
  snippet: z.string().nullable(),
  type: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResultListSchema = z.array(searchResultSchema);

/**
 * Availability of vector (semantic) search. When embeddings have not been
 * generated yet, `available` is false and `reason` explains why — token search
 * still works (AC4).
 */
export const vectorSearchAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
});
export type VectorSearchAvailability = z.infer<typeof vectorSearchAvailabilitySchema>;

/** Full response of `GET .../search`. */
export const searchResponseSchema = z.object({
  results: searchResultListSchema,
  vectorSearch: vectorSearchAvailabilitySchema,
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * Validated search query parameters. Filters narrow which kinds can match:
 * `type`/`tag` only apply to entities, `predicate`/`confidence`/`hasProvenance`
 * only apply to claims, and `dateFrom`/`dateTo` apply to every kind by
 * `createdAt`. Numbers and the boolean arrive as strings, so they are coerced.
 */
export const searchQuerySchema = z
  .object({
    /** Token search string; tokens are AND-matched across searchable fields. */
    q: z.string().trim().max(500).optional(),
    /** Restrict to specific kinds (comma-separated, e.g. `entity,claim`). */
    kinds: z.string().trim().max(200).optional(),
    /** Entity type filter (e.g. `Person`, `Place`). */
    type: z.string().trim().max(200).optional(),
    /** Claim predicate filter. */
    predicate: z.string().trim().max(200).optional(),
    /** Entity tag filter (exact tag match). */
    tag: z.string().trim().max(200).optional(),
    /** Minimum claim confidence (0..1). */
    confidenceMin: z.coerce.number().min(0).max(1).optional(),
    /** Maximum claim confidence (0..1). */
    confidenceMax: z.coerce.number().min(0).max(1).optional(),
    /** Created on/after this ISO datetime. */
    dateFrom: z.string().datetime().optional(),
    /** Created on/before this ISO datetime. */
    dateTo: z.string().datetime().optional(),
    /** Only claims that carry provenance metadata. */
    hasProvenance: z
      .union([z.literal('true'), z.literal('false'), z.boolean()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
    /** Max number of results to return (default 50, max 200). */
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .refine(
    (data) =>
      data.confidenceMin === undefined ||
      data.confidenceMax === undefined ||
      data.confidenceMin <= data.confidenceMax,
    { message: 'confidenceMin must be <= confidenceMax', path: ['confidenceMax'] },
  );
export type SearchQuery = z.infer<typeof searchQuerySchema>;
