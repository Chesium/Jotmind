import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  claims,
  notes,
  sourceExcerpts,
  sources,
  type NewSourceExcerptRow,
  type SourceExcerptRow,
} from '../db/schema.js';
import type { DbExecutor } from '../graph/outbox.js';

/** A source excerpt enriched with a summary of the claim it cites (if any). */
export interface SourceExcerptWithClaim extends SourceExcerptRow {
  claim: { id: string; predicate: string } | null;
}

export interface CreateSourceExcerptInput {
  knowledgeBaseId: string;
  sourceId?: string;
  noteId?: string;
  claimId?: string;
  excerpt?: string;
  spanStart?: number;
  spanEnd?: number;
  metadata?: Record<string, unknown>;
  actorUserId: string;
}

/** Mutable source-excerpt fields an editor may change (origin is immutable). */
export interface UpdateSourceExcerptFields {
  claimId?: string | null;
  excerpt?: string | null;
  spanStart?: number | null;
  spanEnd?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateSourceExcerptInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateSourceExcerptFields;
}

export interface DeleteSourceExcerptInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
}

export interface ListSourceExcerptsFilter {
  noteId?: string;
  sourceId?: string;
  claimId?: string;
}

/** Outcome of creating/updating a source excerpt (US-011). */
export type SourceExcerptResult =
  | { ok: true; excerpt: SourceExcerptWithClaim }
  | { ok: false; reason: 'note_not_found' | 'source_not_found' | 'claim_not_found' | 'not_found' };

/**
 * Persistence boundary for source excerpts / citations (US-011). Defined as an
 * interface so route handlers can run against an in-memory fake in unit tests
 * (no live DB) while production uses the PostgreSQL-backed impl.
 *
 * Source excerpts are NOT a graph projection target (only entity/claim/note/
 * source are), so writes emit an `audit_events` row but NO `graph_outbox`
 * event. Origin and linked-claim references are validated against the same KB.
 * Reads filter `deleted_at IS NULL` (soft-delete).
 */
export interface SourceExcerptStore {
  listSourceExcerpts(
    knowledgeBaseId: string,
    filter?: ListSourceExcerptsFilter,
  ): Promise<SourceExcerptWithClaim[]>;
  getSourceExcerpt(
    knowledgeBaseId: string,
    id: string,
  ): Promise<SourceExcerptWithClaim | undefined>;
  createSourceExcerpt(input: CreateSourceExcerptInput): Promise<SourceExcerptResult>;
  updateSourceExcerpt(input: UpdateSourceExcerptInput): Promise<SourceExcerptResult>;
  /** Soft-delete a source excerpt. Returns undefined if it does not exist. */
  deleteSourceExcerpt(input: DeleteSourceExcerptInput): Promise<SourceExcerptRow | undefined>;
}

/** Load predicate summaries for the given claim ids in a KB. */
async function loadClaimPredicates(
  tx: DbExecutor,
  knowledgeBaseId: string,
  claimIds: string[],
): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  const ids = [...new Set(claimIds)];
  for (const id of ids) {
    const rows = await tx
      .select({ id: claims.id, predicate: claims.predicate })
      .from(claims)
      .where(
        and(
          eq(claims.id, id),
          eq(claims.knowledgeBaseId, knowledgeBaseId),
          isNull(claims.deletedAt),
        ),
      )
      .limit(1);
    if (rows[0]) byId.set(rows[0].id, rows[0].predicate);
  }
  return byId;
}

function withClaim(row: SourceExcerptRow, predicates: Map<string, string>): SourceExcerptWithClaim {
  const predicate = row.claimId ? predicates.get(row.claimId) : undefined;
  return {
    ...row,
    claim: row.claimId && predicate ? { id: row.claimId, predicate } : null,
  };
}

/** PostgreSQL-backed SourceExcerptStore. Resolves the Drizzle client per call. */
export const dbSourceExcerptStore: SourceExcerptStore = {
  async listSourceExcerpts(knowledgeBaseId, filter = {}) {
    const db = getDb();
    const conditions = [
      eq(sourceExcerpts.knowledgeBaseId, knowledgeBaseId),
      isNull(sourceExcerpts.deletedAt),
    ];
    if (filter.noteId) conditions.push(eq(sourceExcerpts.noteId, filter.noteId));
    if (filter.sourceId) conditions.push(eq(sourceExcerpts.sourceId, filter.sourceId));
    if (filter.claimId) conditions.push(eq(sourceExcerpts.claimId, filter.claimId));

    const rows = await db
      .select()
      .from(sourceExcerpts)
      .where(and(...conditions))
      .orderBy(desc(sourceExcerpts.createdAt));
    const predicates = await loadClaimPredicates(
      db,
      knowledgeBaseId,
      rows.flatMap((r) => (r.claimId ? [r.claimId] : [])),
    );
    return rows.map((r) => withClaim(r, predicates));
  },

  async getSourceExcerpt(knowledgeBaseId, id) {
    const db = getDb();
    const rows = await db
      .select()
      .from(sourceExcerpts)
      .where(
        and(
          eq(sourceExcerpts.id, id),
          eq(sourceExcerpts.knowledgeBaseId, knowledgeBaseId),
          isNull(sourceExcerpts.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    const predicates = await loadClaimPredicates(
      db,
      knowledgeBaseId,
      row.claimId ? [row.claimId] : [],
    );
    return withClaim(row, predicates);
  },

  async createSourceExcerpt(input) {
    return getDb().transaction(async (tx) => {
      // Validate the origin (exactly one of note/source) exists in this KB.
      if (input.noteId) {
        const note = await tx
          .select({ id: notes.id })
          .from(notes)
          .where(
            and(
              eq(notes.id, input.noteId),
              eq(notes.knowledgeBaseId, input.knowledgeBaseId),
              isNull(notes.deletedAt),
            ),
          )
          .limit(1);
        if (!note[0]) return { ok: false as const, reason: 'note_not_found' as const };
      } else if (input.sourceId) {
        const source = await tx
          .select({ id: sources.id })
          .from(sources)
          .where(
            and(
              eq(sources.id, input.sourceId),
              eq(sources.knowledgeBaseId, input.knowledgeBaseId),
              isNull(sources.deletedAt),
            ),
          )
          .limit(1);
        if (!source[0]) return { ok: false as const, reason: 'source_not_found' as const };
      }

      if (input.claimId) {
        const claim = await tx
          .select({ id: claims.id })
          .from(claims)
          .where(
            and(
              eq(claims.id, input.claimId),
              eq(claims.knowledgeBaseId, input.knowledgeBaseId),
              isNull(claims.deletedAt),
            ),
          )
          .limit(1);
        if (!claim[0]) return { ok: false as const, reason: 'claim_not_found' as const };
      }

      const rows = await tx
        .insert(sourceExcerpts)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          sourceId: input.sourceId ?? null,
          noteId: input.noteId ?? null,
          claimId: input.claimId ?? null,
          excerpt: input.excerpt ?? null,
          spanStart: input.spanStart ?? null,
          spanEnd: input.spanEnd ?? null,
          metadata: input.metadata ?? {},
          createdBy: input.actorUserId,
        })
        .returning();
      const excerpt = rows[0];
      if (!excerpt) throw new Error('Failed to create source excerpt');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: excerpt.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source_excerpt.created',
        targetType: 'source_excerpt',
        targetId: excerpt.id,
        metadata: { noteId: excerpt.noteId, sourceId: excerpt.sourceId, claimId: excerpt.claimId },
      });

      const predicates = await loadClaimPredicates(
        tx,
        input.knowledgeBaseId,
        excerpt.claimId ? [excerpt.claimId] : [],
      );
      return { ok: true as const, excerpt: withClaim(excerpt, predicates) };
    });
  },

  async updateSourceExcerpt(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(sourceExcerpts)
        .where(
          and(
            eq(sourceExcerpts.id, input.id),
            eq(sourceExcerpts.knowledgeBaseId, input.knowledgeBaseId),
            isNull(sourceExcerpts.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return { ok: false as const, reason: 'not_found' as const };

      const { fields } = input;
      // Validate a newly-linked claim belongs to the KB.
      if (fields.claimId !== undefined && fields.claimId !== null) {
        const claim = await tx
          .select({ id: claims.id })
          .from(claims)
          .where(
            and(
              eq(claims.id, fields.claimId),
              eq(claims.knowledgeBaseId, input.knowledgeBaseId),
              isNull(claims.deletedAt),
            ),
          )
          .limit(1);
        if (!claim[0]) return { ok: false as const, reason: 'claim_not_found' as const };
      }

      const set: Partial<NewSourceExcerptRow> = { updatedAt: new Date() };
      if (fields.claimId !== undefined) set.claimId = fields.claimId;
      if (fields.excerpt !== undefined) set.excerpt = fields.excerpt;
      if (fields.spanStart !== undefined) set.spanStart = fields.spanStart;
      if (fields.spanEnd !== undefined) set.spanEnd = fields.spanEnd;
      if (fields.metadata !== undefined) set.metadata = fields.metadata;

      const rows = await tx
        .update(sourceExcerpts)
        .set(set)
        .where(
          and(
            eq(sourceExcerpts.id, input.id),
            eq(sourceExcerpts.knowledgeBaseId, input.knowledgeBaseId),
          ),
        )
        .returning();
      const excerpt = rows[0];
      if (!excerpt) throw new Error('Failed to update source excerpt');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: excerpt.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source_excerpt.updated',
        targetType: 'source_excerpt',
        targetId: excerpt.id,
        metadata: { changed: Object.keys(fields) },
      });

      const predicates = await loadClaimPredicates(
        tx,
        input.knowledgeBaseId,
        excerpt.claimId ? [excerpt.claimId] : [],
      );
      return { ok: true as const, excerpt: withClaim(excerpt, predicates) };
    });
  },

  async deleteSourceExcerpt(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(sourceExcerpts)
        .where(
          and(
            eq(sourceExcerpts.id, input.id),
            eq(sourceExcerpts.knowledgeBaseId, input.knowledgeBaseId),
            isNull(sourceExcerpts.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(sourceExcerpts)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(sourceExcerpts.id, input.id),
            eq(sourceExcerpts.knowledgeBaseId, input.knowledgeBaseId),
          ),
        )
        .returning();
      const excerpt = rows[0];
      if (!excerpt) throw new Error('Failed to delete source excerpt');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: excerpt.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source_excerpt.deleted',
        targetType: 'source_excerpt',
        targetId: excerpt.id,
        metadata: { noteId: excerpt.noteId, sourceId: excerpt.sourceId },
      });

      return excerpt;
    });
  },
};
