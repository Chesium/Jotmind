import { and, eq, gte, isNull, lte, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { SearchResult, SearchResultKind, VectorSearchAvailability } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { claims, entities, notes, sources } from '../db/schema.js';

/** Structured search filters resolved from the validated query (US-012). */
export interface SearchFilters {
  /** Token search string; tokens are AND-matched across searchable fields. */
  query?: string;
  /** Restrict to specific kinds. */
  kinds?: SearchResultKind[];
  /** Entity type filter (only matches entities). */
  type?: string;
  /** Claim predicate filter (only matches claims). */
  predicate?: string;
  /** Entity tag filter, exact match (only matches entities). */
  tag?: string;
  /** Minimum claim confidence (only matches claims). */
  confidenceMin?: number;
  /** Maximum claim confidence (only matches claims). */
  confidenceMax?: number;
  /** Created on/after. */
  dateFrom?: Date;
  /** Created on/before. */
  dateTo?: Date;
  /** Only claims that carry provenance metadata (only matches claims). */
  hasProvenance?: boolean;
  /** Max results to return (default 50). */
  limit?: number;
}

const ALL_KINDS: SearchResultKind[] = ['entity', 'claim', 'note', 'source'];
const DEFAULT_LIMIT = 50;

/**
 * Persistence boundary for manual search (US-012). Defined as an interface so
 * route handlers can run against an in-memory fake in unit tests; production
 * uses the PostgreSQL-backed impl. KB scoping is enforced by the router
 * (`requireKbRole`) and re-applied here via `knowledgeBaseId`.
 */
export interface SearchStore {
  /** Token + filter search scoped to one Knowledge Base. */
  search(knowledgeBaseId: string, filters: SearchFilters): Promise<SearchResult[]>;
  /**
   * Whether vector/semantic search is available. When embeddings have not been
   * generated this returns `available: false` so token search still works (AC4).
   */
  getVectorSearchAvailability(): Promise<VectorSearchAvailability>;
}

/** Escape LIKE/ILIKE wildcards so a token matches literally. */
function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Split a query string into non-empty whitespace-delimited tokens. */
function tokenize(query: string | undefined): string[] {
  if (!query) return [];
  return query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Build an AND list of per-token conditions; each token must match (ILIKE) at
 * least one of `columns` (cast to text so JSONB arrays/objects are searchable).
 */
function tokenConditions(tokens: string[], columns: SQLWrapper[]): SQL[] {
  return tokens.map((token) => {
    const pattern = `%${escapeLike(token)}%`;
    const perColumn = columns.map((col) => sql`${col}::text ILIKE ${pattern}`);
    return or(...perColumn) as SQL;
  });
}

function truncate(text: string | null, max = 200): string | null {
  if (text === null) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Resolve which kinds can possibly match given the active filters. Entity-only
 * filters (`type`/`tag`) and claim-only filters
 * (`predicate`/`confidence`/`hasProvenance`) narrow the set; an impossible
 * combination yields an empty set.
 */
function resolveKinds(filters: SearchFilters): Set<SearchResultKind> {
  let kinds = new Set<SearchResultKind>(filters.kinds ?? ALL_KINDS);
  const entityOnly = filters.type !== undefined || filters.tag !== undefined;
  const claimOnly =
    filters.predicate !== undefined ||
    filters.confidenceMin !== undefined ||
    filters.confidenceMax !== undefined ||
    filters.hasProvenance !== undefined;
  if (entityOnly) kinds = new Set([...kinds].filter((k) => k === 'entity'));
  if (claimOnly) kinds = new Set([...kinds].filter((k) => k === 'claim'));
  return kinds;
}

/** PostgreSQL-backed SearchStore. Resolves the Drizzle client per call. */
export const dbSearchStore: SearchStore = {
  async search(knowledgeBaseId, filters) {
    const db = getDb();
    const tokens = tokenize(filters.query);
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const kinds = resolveKinds(filters);
    const results: SearchResult[] = [];

    if (kinds.has('entity')) {
      const conds: SQL[] = [
        eq(entities.knowledgeBaseId, knowledgeBaseId),
        isNull(entities.deletedAt),
      ];
      if (filters.type !== undefined) conds.push(eq(entities.type, filters.type));
      if (filters.tag !== undefined) {
        conds.push(sql`${entities.tags} @> ${JSON.stringify([filters.tag])}::jsonb`);
      }
      if (filters.dateFrom) conds.push(gte(entities.createdAt, filters.dateFrom));
      if (filters.dateTo) conds.push(lte(entities.createdAt, filters.dateTo));
      conds.push(
        ...tokenConditions(tokens, [
          entities.name,
          entities.aliases,
          entities.description,
          entities.tags,
          entities.type,
          entities.properties,
        ]),
      );
      const rows = await db
        .select()
        .from(entities)
        .where(and(...conds))
        .orderBy(sql`${entities.createdAt} DESC`)
        .limit(limit);
      for (const row of rows) {
        results.push({
          kind: 'entity',
          id: row.id,
          knowledgeBaseId: row.knowledgeBaseId,
          title: row.name,
          snippet: truncate(row.description),
          type: row.type,
          tags: row.tags as string[],
          confidence: null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    if (kinds.has('claim')) {
      const conds: SQL[] = [eq(claims.knowledgeBaseId, knowledgeBaseId), isNull(claims.deletedAt)];
      if (filters.predicate !== undefined) conds.push(eq(claims.predicate, filters.predicate));
      if (filters.confidenceMin !== undefined) {
        conds.push(gte(claims.confidence, filters.confidenceMin));
      }
      if (filters.confidenceMax !== undefined) {
        conds.push(lte(claims.confidence, filters.confidenceMax));
      }
      if (filters.hasProvenance) conds.push(sql`${claims.provenance} <> '{}'::jsonb`);
      if (filters.dateFrom) conds.push(gte(claims.createdAt, filters.dateFrom));
      if (filters.dateTo) conds.push(lte(claims.createdAt, filters.dateTo));
      conds.push(
        ...tokenConditions(tokens, [
          claims.predicate,
          claims.description,
          claims.properties,
          claims.provenance,
        ]),
      );
      const rows = await db
        .select()
        .from(claims)
        .where(and(...conds))
        .orderBy(sql`${claims.createdAt} DESC`)
        .limit(limit);
      for (const row of rows) {
        results.push({
          kind: 'claim',
          id: row.id,
          knowledgeBaseId: row.knowledgeBaseId,
          title: row.predicate,
          snippet: truncate(row.description),
          type: row.predicate,
          tags: [],
          confidence: row.confidence,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    if (kinds.has('note')) {
      const conds: SQL[] = [eq(notes.knowledgeBaseId, knowledgeBaseId), isNull(notes.deletedAt)];
      if (filters.dateFrom) conds.push(gte(notes.createdAt, filters.dateFrom));
      if (filters.dateTo) conds.push(lte(notes.createdAt, filters.dateTo));
      conds.push(...tokenConditions(tokens, [notes.title, notes.content, notes.properties]));
      const rows = await db
        .select()
        .from(notes)
        .where(and(...conds))
        .orderBy(sql`${notes.createdAt} DESC`)
        .limit(limit);
      for (const row of rows) {
        results.push({
          kind: 'note',
          id: row.id,
          knowledgeBaseId: row.knowledgeBaseId,
          title: row.title ?? 'Untitled note',
          snippet: truncate(row.content),
          type: null,
          tags: [],
          confidence: null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    if (kinds.has('source')) {
      const conds: SQL[] = [
        eq(sources.knowledgeBaseId, knowledgeBaseId),
        isNull(sources.deletedAt),
      ];
      if (filters.dateFrom) conds.push(gte(sources.createdAt, filters.dateFrom));
      if (filters.dateTo) conds.push(lte(sources.createdAt, filters.dateTo));
      conds.push(
        ...tokenConditions(tokens, [
          sources.title,
          sources.sourceType,
          sources.uri,
          sources.content,
          sources.metadata,
          sources.properties,
        ]),
      );
      const rows = await db
        .select()
        .from(sources)
        .where(and(...conds))
        .orderBy(sql`${sources.createdAt} DESC`)
        .limit(limit);
      for (const row of rows) {
        results.push({
          kind: 'source',
          id: row.id,
          knowledgeBaseId: row.knowledgeBaseId,
          title: row.title ?? 'Untitled source',
          snippet: truncate(row.content ?? row.uri),
          type: row.sourceType,
          tags: [],
          confidence: null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      }
    }

    // Combine all kinds, newest first, capped at the overall limit.
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results.slice(0, limit);
  },

  async getVectorSearchAvailability() {
    // Vector search requires both the pgvector extension AND generated
    // embeddings (US-021). The `embeddings` table now always exists, so detect
    // whether any embedding ROWS have been generated. Availability reflects
    // stored embeddings independent of the generation provider's current
    // availability (US-021 AC4); token search keeps working regardless
    // (US-012 AC4).
    const db = getDb();
    const rows = await db.execute<{ has_embeddings: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM embeddings) AS has_embeddings
    `);
    const hasEmbeddings = rows[0]?.has_embeddings === true;
    if (!hasEmbeddings) {
      return {
        available: false,
        reason: 'No embeddings have been generated; semantic search is unavailable.',
      };
    }
    return { available: true, reason: null };
  },
};
