import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { auditEvents, entities, type EntityRow, type NewEntityRow } from '../db/schema.js';
import { enqueueGraphOutbox } from '../graph/outbox.js';

export interface CreateEntityInput {
  knowledgeBaseId: string;
  type: string;
  name: string;
  aliases?: string[];
  description?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  schemaVersionId?: string;
  actorUserId: string;
}

/** Mutable entity fields an editor may change. */
export interface UpdateEntityFields {
  type?: string;
  name?: string;
  aliases?: string[];
  description?: string | null;
  tags?: string[];
  properties?: Record<string, unknown>;
}

export interface UpdateEntityInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateEntityFields;
}

/**
 * Persistence boundary for entities (US-008). Defined as an interface so route
 * handlers can run against an in-memory fake in unit tests (no live DB) while
 * production uses the PostgreSQL-backed impl.
 *
 * Writes go through the canonical relational `entities` table and, in the SAME
 * transaction, append a `graph_outbox` projection event (US-006) and an
 * `audit_events` row — mirroring the KB store pattern. Reads filter
 * `deleted_at IS NULL` (soft-delete, US-010).
 */
export interface EntityStore {
  listEntities(knowledgeBaseId: string): Promise<EntityRow[]>;
  getEntity(knowledgeBaseId: string, id: string): Promise<EntityRow | undefined>;
  createEntity(input: CreateEntityInput): Promise<EntityRow>;
  updateEntity(input: UpdateEntityInput): Promise<EntityRow | undefined>;
}

/** PostgreSQL-backed EntityStore. Resolves the Drizzle client per call. */
export const dbEntityStore: EntityStore = {
  async listEntities(knowledgeBaseId) {
    return getDb()
      .select()
      .from(entities)
      .where(and(eq(entities.knowledgeBaseId, knowledgeBaseId), isNull(entities.deletedAt)))
      .orderBy(desc(entities.createdAt));
  },

  async getEntity(knowledgeBaseId, id) {
    const rows = await getDb()
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, id),
          eq(entities.knowledgeBaseId, knowledgeBaseId),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async createEntity(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(entities)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          type: input.type,
          name: input.name,
          aliases: input.aliases ?? [],
          description: input.description ?? null,
          tags: input.tags ?? [],
          properties: input.properties ?? {},
          schemaVersionId: input.schemaVersionId ?? null,
          createdBy: input.actorUserId,
        })
        .returning();
      const entity = rows[0];
      if (!entity) throw new Error('Failed to create entity');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: entity.knowledgeBaseId,
        eventType: 'created',
        targetType: 'entity',
        targetId: entity.id,
        payload: { type: entity.type, name: entity.name },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: entity.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.created',
        targetType: 'entity',
        targetId: entity.id,
        metadata: { type: entity.type, name: entity.name },
      });

      return entity;
    });
  },

  async updateEntity(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, input.id),
            eq(entities.knowledgeBaseId, input.knowledgeBaseId),
            isNull(entities.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const set: Partial<NewEntityRow> = { updatedAt: new Date() };
      const { fields } = input;
      if (fields.type !== undefined) set.type = fields.type;
      if (fields.name !== undefined) set.name = fields.name;
      if (fields.aliases !== undefined) set.aliases = fields.aliases;
      if (fields.description !== undefined) set.description = fields.description;
      if (fields.tags !== undefined) set.tags = fields.tags;
      if (fields.properties !== undefined) set.properties = fields.properties;

      const rows = await tx
        .update(entities)
        .set(set)
        .where(and(eq(entities.id, input.id), eq(entities.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const entity = rows[0];
      if (!entity) throw new Error('Failed to update entity');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: entity.knowledgeBaseId,
        eventType: 'updated',
        targetType: 'entity',
        targetId: entity.id,
        payload: { type: entity.type, name: entity.name },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: entity.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.updated',
        targetType: 'entity',
        targetId: entity.id,
        metadata: { changed: Object.keys(fields) },
      });

      return entity;
    });
  },
};
