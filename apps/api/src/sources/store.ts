import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { auditEvents, sources, type NewSourceRow, type SourceRow } from '../db/schema.js';
import { enqueueGraphOutbox } from '../graph/outbox.js';

export interface CreateSourceInput {
  knowledgeBaseId: string;
  title: string;
  sourceType?: string;
  uri?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  actorUserId: string;
}

/** Mutable source fields an editor may change. */
export interface UpdateSourceFields {
  title?: string;
  sourceType?: string | null;
  uri?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface UpdateSourceInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateSourceFields;
}

export interface DeleteSourceInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
}

/**
 * Persistence boundary for sources (US-011). Defined as an interface so route
 * handlers can run against an in-memory fake in unit tests (no live DB) while
 * production uses the PostgreSQL-backed impl.
 *
 * Sources are canonical graph records: writes append a `graph_outbox`
 * projection event (US-006) AND an `audit_events` row in the SAME transaction —
 * mirroring the entity/claim stores. Reads filter `deleted_at IS NULL`.
 */
export interface SourceStore {
  listSources(knowledgeBaseId: string): Promise<SourceRow[]>;
  getSource(knowledgeBaseId: string, id: string): Promise<SourceRow | undefined>;
  createSource(input: CreateSourceInput): Promise<SourceRow>;
  updateSource(input: UpdateSourceInput): Promise<SourceRow | undefined>;
  /** Soft-delete a source (US-011). Returns undefined if it does not exist. */
  deleteSource(input: DeleteSourceInput): Promise<SourceRow | undefined>;
}

/** PostgreSQL-backed SourceStore. Resolves the Drizzle client per call. */
export const dbSourceStore: SourceStore = {
  async listSources(knowledgeBaseId) {
    return getDb()
      .select()
      .from(sources)
      .where(and(eq(sources.knowledgeBaseId, knowledgeBaseId), isNull(sources.deletedAt)))
      .orderBy(desc(sources.createdAt));
  },

  async getSource(knowledgeBaseId, id) {
    const rows = await getDb()
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.id, id),
          eq(sources.knowledgeBaseId, knowledgeBaseId),
          isNull(sources.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async createSource(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(sources)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          title: input.title,
          sourceType: input.sourceType ?? null,
          uri: input.uri ?? null,
          content: input.content ?? null,
          metadata: input.metadata ?? {},
          properties: input.properties ?? {},
          createdBy: input.actorUserId,
        })
        .returning();
      const source = rows[0];
      if (!source) throw new Error('Failed to create source');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: source.knowledgeBaseId,
        eventType: 'created',
        targetType: 'source',
        targetId: source.id,
        payload: { title: source.title, sourceType: source.sourceType },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: source.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source.created',
        targetType: 'source',
        targetId: source.id,
        metadata: { title: source.title, sourceType: source.sourceType },
      });

      return source;
    });
  },

  async updateSource(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.id, input.id),
            eq(sources.knowledgeBaseId, input.knowledgeBaseId),
            isNull(sources.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const set: Partial<NewSourceRow> = { updatedAt: new Date() };
      const { fields } = input;
      if (fields.title !== undefined) set.title = fields.title;
      if (fields.sourceType !== undefined) set.sourceType = fields.sourceType;
      if (fields.uri !== undefined) set.uri = fields.uri;
      if (fields.content !== undefined) set.content = fields.content;
      if (fields.metadata !== undefined) set.metadata = fields.metadata;
      if (fields.properties !== undefined) set.properties = fields.properties;

      const rows = await tx
        .update(sources)
        .set(set)
        .where(and(eq(sources.id, input.id), eq(sources.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const source = rows[0];
      if (!source) throw new Error('Failed to update source');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: source.knowledgeBaseId,
        eventType: 'updated',
        targetType: 'source',
        targetId: source.id,
        payload: { title: source.title },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: source.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source.updated',
        targetType: 'source',
        targetId: source.id,
        metadata: { changed: Object.keys(fields) },
      });

      return source;
    });
  },

  async deleteSource(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.id, input.id),
            eq(sources.knowledgeBaseId, input.knowledgeBaseId),
            isNull(sources.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(sources)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(sources.id, input.id), eq(sources.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const source = rows[0];
      if (!source) throw new Error('Failed to delete source');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: source.knowledgeBaseId,
        eventType: 'deleted',
        targetType: 'source',
        targetId: source.id,
        payload: { title: source.title },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: source.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'source.deleted',
        targetType: 'source',
        targetId: source.id,
        metadata: { title: source.title },
      });

      return source;
    });
  },
};
