import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  type EntityRow,
  type NewEntityRow,
} from '../db/schema.js';
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
  /** Active schema version the record was validated against (US-027 AC5). */
  schemaVersionId?: string | null;
}

export interface UpdateEntityInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateEntityFields;
}

export interface DeleteEntityInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
}

export interface MergeEntitiesInput {
  knowledgeBaseId: string;
  /** The entity to archive (soft-delete + point at the survivor). */
  sourceId: string;
  /** The surviving entity that absorbs the source. */
  targetId: string;
  actorUserId: string;
}

/** A claim that references an entity, used to explain delete/merge impact. */
export interface EntityImpactClaim {
  id: string;
  predicate: string;
}

/** The (non-deleted) claims that reference an entity (US-010 AC2). */
export interface EntityImpact {
  claims: EntityImpactClaim[];
}

/** Outcome of an entity merge (US-010). */
export type MergeEntitiesResult =
  | { ok: true; entity: EntityRow; retargetedClaimCount: number }
  | { ok: false; reason: 'source_not_found' | 'target_not_found' | 'same_entity' };

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
  /** Soft-delete an entity (US-010). Returns undefined if it does not exist. */
  deleteEntity(input: DeleteEntityInput): Promise<EntityRow | undefined>;
  /**
   * Archive & Pointer merge (US-010): soft-delete `sourceId`, point its
   * `mergedIntoId` at `targetId`, fold aliases/tags/properties into the
   * survivor, and retarget claim arguments referencing the source.
   */
  mergeEntities(input: MergeEntitiesInput): Promise<MergeEntitiesResult>;
  /** Claims that reference an entity, to explain delete/merge impact (US-010). */
  getEntityImpact(knowledgeBaseId: string, id: string): Promise<EntityImpact | undefined>;
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
      if (fields.schemaVersionId !== undefined) set.schemaVersionId = fields.schemaVersionId;

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

  async deleteEntity(input) {
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

      const now = new Date();
      const rows = await tx
        .update(entities)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(entities.id, input.id), eq(entities.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const entity = rows[0];
      if (!entity) throw new Error('Failed to delete entity');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: entity.knowledgeBaseId,
        eventType: 'deleted',
        targetType: 'entity',
        targetId: entity.id,
        payload: { type: entity.type, name: entity.name },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: entity.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.deleted',
        targetType: 'entity',
        targetId: entity.id,
        metadata: { type: entity.type, name: entity.name },
      });

      return entity;
    });
  },

  async getEntityImpact(knowledgeBaseId, id) {
    const db = getDb();
    const entity = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.id, id),
          eq(entities.knowledgeBaseId, knowledgeBaseId),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!entity[0]) return undefined;

    const rows = await db
      .selectDistinct({ id: claims.id, predicate: claims.predicate })
      .from(claimArguments)
      .innerJoin(claims, eq(claimArguments.claimId, claims.id))
      .where(
        and(
          eq(claimArguments.entityId, id),
          isNull(claimArguments.deletedAt),
          isNull(claims.deletedAt),
          eq(claims.knowledgeBaseId, knowledgeBaseId),
        ),
      );
    return { claims: rows };
  },

  async mergeEntities(input) {
    return getDb().transaction(async (tx) => {
      if (input.sourceId === input.targetId) {
        return { ok: false as const, reason: 'same_entity' as const };
      }

      const loadEntity = async (entityId: string) => {
        const rows = await tx
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.id, entityId),
              eq(entities.knowledgeBaseId, input.knowledgeBaseId),
              isNull(entities.deletedAt),
            ),
          )
          .limit(1);
        return rows[0];
      };

      const source = await loadEntity(input.sourceId);
      if (!source) return { ok: false as const, reason: 'source_not_found' as const };
      const target = await loadEntity(input.targetId);
      if (!target) return { ok: false as const, reason: 'target_not_found' as const };

      const now = new Date();

      // Fold the source's aliases/tags/properties into the survivor. The
      // source's display name is preserved as an alias so it stays searchable.
      const aliasSet = new Set<string>([
        ...(target.aliases as string[]),
        ...(source.aliases as string[]),
      ]);
      if (source.name !== target.name) aliasSet.add(source.name);
      const tagSet = new Set<string>([...(target.tags as string[]), ...(source.tags as string[])]);
      // Target properties win on conflict; the source fills in any gaps.
      const mergedProperties = {
        ...(source.properties as Record<string, unknown>),
        ...(target.properties as Record<string, unknown>),
      };

      const survivorRows = await tx
        .update(entities)
        .set({
          aliases: [...aliasSet],
          tags: [...tagSet],
          properties: mergedProperties,
          description: target.description ?? source.description,
          updatedAt: now,
        })
        .where(and(eq(entities.id, target.id), eq(entities.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const survivor = survivorRows[0];
      if (!survivor) throw new Error('Failed to update survivor entity');

      // Archive the source: soft-delete + pointer to the survivor.
      await tx
        .update(entities)
        .set({ deletedAt: now, mergedIntoId: target.id, updatedAt: now })
        .where(
          and(eq(entities.id, source.id), eq(entities.knowledgeBaseId, input.knowledgeBaseId)),
        );

      // Retarget claim arguments that referenced the source to the survivor.
      const affectedArgs = await tx
        .select({ claimId: claimArguments.claimId })
        .from(claimArguments)
        .where(and(eq(claimArguments.entityId, source.id), isNull(claimArguments.deletedAt)));
      const affectedClaimIds = [...new Set(affectedArgs.map((a) => a.claimId))];

      if (affectedClaimIds.length > 0) {
        await tx
          .update(claimArguments)
          .set({ entityId: target.id, updatedAt: now })
          .where(and(eq(claimArguments.entityId, source.id), isNull(claimArguments.deletedAt)));
      }

      // Append the archived entity id to each affected claim's provenance and
      // emit a claim.updated projection event.
      for (const claimId of affectedClaimIds) {
        const claimRows = await tx.select().from(claims).where(eq(claims.id, claimId)).limit(1);
        const claim = claimRows[0];
        if (!claim) continue;
        const provenance = { ...((claim.provenance as Record<string, unknown>) ?? {}) };
        const historical = Array.isArray(provenance.historical_source_entities)
          ? [...(provenance.historical_source_entities as string[])]
          : [];
        if (!historical.includes(source.id)) historical.push(source.id);
        provenance.historical_source_entities = historical;
        await tx.update(claims).set({ provenance, updatedAt: now }).where(eq(claims.id, claimId));
        await enqueueGraphOutbox(tx, {
          knowledgeBaseId: input.knowledgeBaseId,
          eventType: 'updated',
          targetType: 'claim',
          targetId: claimId,
          payload: { retargetedFrom: source.id, retargetedTo: target.id },
        });
      }

      await enqueueGraphOutbox(tx, [
        {
          knowledgeBaseId: input.knowledgeBaseId,
          eventType: 'updated',
          targetType: 'entity',
          targetId: target.id,
          payload: { mergedFrom: source.id },
        },
        {
          knowledgeBaseId: input.knowledgeBaseId,
          eventType: 'deleted',
          targetType: 'entity',
          targetId: source.id,
          payload: { mergedInto: target.id },
        },
      ]);

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.merged',
        targetType: 'entity',
        targetId: target.id,
        metadata: {
          sourceId: source.id,
          targetId: target.id,
          retargetedClaimCount: affectedClaimIds.length,
        },
      });

      return { ok: true as const, entity: survivor, retargetedClaimCount: affectedClaimIds.length };
    });
  },
};
