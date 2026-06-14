import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  claimArguments,
  claims,
  type ClaimArgumentRow,
  type ClaimRow,
  type NewClaimRow,
} from '../db/schema.js';
import { enqueueGraphOutbox } from '../graph/outbox.js';
import type { DbExecutor } from '../graph/outbox.js';

/** A claim together with its role-labeled arguments (US-009). */
export interface ClaimWithArguments extends ClaimRow {
  arguments: ClaimArgumentRow[];
}

/** A claim argument as supplied by callers when creating/replacing arguments. */
export interface ClaimArgumentInput {
  role: string;
  argumentKind: 'entity' | 'literal';
  entityId?: string | undefined;
  value?: unknown;
}

export interface CreateClaimInput {
  knowledgeBaseId: string;
  predicate: string;
  description?: string;
  confidence?: number;
  validStart?: string;
  validEnd?: string;
  properties?: Record<string, unknown>;
  /** Provenance metadata (e.g. accepted-proposal source/provider, US-018 AC3). */
  provenance?: Record<string, unknown>;
  schemaVersionId?: string;
  arguments: ClaimArgumentInput[];
  actorUserId: string;
}

/** Mutable claim fields an editor may change. */
export interface UpdateClaimFields {
  predicate?: string;
  description?: string | null;
  confidence?: number | null;
  validStart?: string | null;
  validEnd?: string | null;
  properties?: Record<string, unknown>;
  /** When present, REPLACES the full argument set (lets argument roles change). */
  arguments?: ClaimArgumentInput[];
}

export interface UpdateClaimInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateClaimFields;
}

export interface DeleteClaimInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
}

/**
 * Persistence boundary for claims (US-009). Defined as an interface so route
 * handlers can run against an in-memory fake in unit tests (no live DB) while
 * production uses the PostgreSQL-backed impl.
 *
 * Writes go through the canonical relational `claims` + `claim_arguments`
 * tables and, in the SAME transaction, append a `graph_outbox` projection
 * event (US-006) and an `audit_events` row — mirroring the entity store
 * pattern. Reads filter `deleted_at IS NULL` (soft-delete, US-010).
 */
export interface ClaimStore {
  listClaims(knowledgeBaseId: string): Promise<ClaimWithArguments[]>;
  getClaim(knowledgeBaseId: string, id: string): Promise<ClaimWithArguments | undefined>;
  createClaim(input: CreateClaimInput): Promise<ClaimWithArguments>;
  updateClaim(input: UpdateClaimInput): Promise<ClaimWithArguments | undefined>;
  /**
   * Soft-delete a claim and its arguments (US-010). Returns the deleted claim
   * row, or undefined when it does not exist.
   */
  deleteClaim(input: DeleteClaimInput): Promise<ClaimRow | undefined>;
}

/** Load the (non-deleted) arguments for the given claim ids, grouped by claim. */
async function loadArguments(
  tx: DbExecutor,
  claimIds: string[],
): Promise<Map<string, ClaimArgumentRow[]>> {
  const byClaim = new Map<string, ClaimArgumentRow[]>();
  if (claimIds.length === 0) return byClaim;
  const rows = await tx
    .select()
    .from(claimArguments)
    .where(and(inArray(claimArguments.claimId, claimIds), isNull(claimArguments.deletedAt)))
    .orderBy(asc(claimArguments.position));
  for (const row of rows) {
    const list = byClaim.get(row.claimId) ?? [];
    list.push(row);
    byClaim.set(row.claimId, list);
  }
  return byClaim;
}

/** Insert claim_arguments rows for a claim, assigning sequential positions. */
async function insertArguments(
  tx: DbExecutor,
  knowledgeBaseId: string,
  claimId: string,
  args: ClaimArgumentInput[],
): Promise<ClaimArgumentRow[]> {
  const values = args.map((arg, position) => ({
    knowledgeBaseId,
    claimId,
    role: arg.role,
    position,
    argumentKind: arg.argumentKind,
    entityId: arg.argumentKind === 'entity' ? (arg.entityId ?? null) : null,
    value: arg.argumentKind === 'literal' ? (arg.value ?? null) : null,
  }));
  return tx.insert(claimArguments).values(values).returning();
}

/** PostgreSQL-backed ClaimStore. Resolves the Drizzle client per call. */
export const dbClaimStore: ClaimStore = {
  async listClaims(knowledgeBaseId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(claims)
      .where(and(eq(claims.knowledgeBaseId, knowledgeBaseId), isNull(claims.deletedAt)))
      .orderBy(desc(claims.createdAt));
    const byClaim = await loadArguments(
      db,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, arguments: byClaim.get(r.id) ?? [] }));
  },

  async getClaim(knowledgeBaseId, id) {
    const db = getDb();
    const rows = await db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.id, id),
          eq(claims.knowledgeBaseId, knowledgeBaseId),
          isNull(claims.deletedAt),
        ),
      )
      .limit(1);
    const claim = rows[0];
    if (!claim) return undefined;
    const byClaim = await loadArguments(db, [claim.id]);
    return { ...claim, arguments: byClaim.get(claim.id) ?? [] };
  },

  async createClaim(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(claims)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          predicate: input.predicate,
          description: input.description ?? null,
          confidence: input.confidence ?? null,
          validStart: input.validStart ? new Date(input.validStart) : null,
          validEnd: input.validEnd ? new Date(input.validEnd) : null,
          properties: input.properties ?? {},
          provenance: input.provenance ?? {},
          schemaVersionId: input.schemaVersionId ?? null,
          createdBy: input.actorUserId,
        })
        .returning();
      const claim = rows[0];
      if (!claim) throw new Error('Failed to create claim');

      const args = await insertArguments(tx, claim.knowledgeBaseId, claim.id, input.arguments);

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: claim.knowledgeBaseId,
        eventType: 'created',
        targetType: 'claim',
        targetId: claim.id,
        payload: { predicate: claim.predicate, argumentCount: args.length },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: claim.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'claim.created',
        targetType: 'claim',
        targetId: claim.id,
        metadata: { predicate: claim.predicate, argumentCount: args.length },
      });

      return { ...claim, arguments: args };
    });
  },

  async updateClaim(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(claims)
        .where(
          and(
            eq(claims.id, input.id),
            eq(claims.knowledgeBaseId, input.knowledgeBaseId),
            isNull(claims.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const set: Partial<NewClaimRow> = { updatedAt: new Date() };
      const { fields } = input;
      if (fields.predicate !== undefined) set.predicate = fields.predicate;
      if (fields.description !== undefined) set.description = fields.description;
      if (fields.confidence !== undefined) set.confidence = fields.confidence;
      if (fields.validStart !== undefined) {
        set.validStart = fields.validStart ? new Date(fields.validStart) : null;
      }
      if (fields.validEnd !== undefined) {
        set.validEnd = fields.validEnd ? new Date(fields.validEnd) : null;
      }
      if (fields.properties !== undefined) set.properties = fields.properties;

      const rows = await tx
        .update(claims)
        .set(set)
        .where(and(eq(claims.id, input.id), eq(claims.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const claim = rows[0];
      if (!claim) throw new Error('Failed to update claim');

      // Replacing arguments: hard-delete the old set and insert the new one so
      // argument roles/order can be edited (US-009 AC3).
      if (fields.arguments !== undefined) {
        await tx.delete(claimArguments).where(eq(claimArguments.claimId, claim.id));
        await insertArguments(tx, claim.knowledgeBaseId, claim.id, fields.arguments);
      }

      const byClaim = await loadArguments(tx, [claim.id]);

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: claim.knowledgeBaseId,
        eventType: 'updated',
        targetType: 'claim',
        targetId: claim.id,
        payload: { predicate: claim.predicate },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: claim.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'claim.updated',
        targetType: 'claim',
        targetId: claim.id,
        metadata: { changed: Object.keys(fields) },
      });

      return { ...claim, arguments: byClaim.get(claim.id) ?? [] };
    });
  },

  async deleteClaim(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(claims)
        .where(
          and(
            eq(claims.id, input.id),
            eq(claims.knowledgeBaseId, input.knowledgeBaseId),
            isNull(claims.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(claims)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(claims.id, input.id), eq(claims.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const claim = rows[0];
      if (!claim) throw new Error('Failed to delete claim');

      // Soft-delete the claim's arguments alongside it so reads stay consistent.
      await tx
        .update(claimArguments)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(claimArguments.claimId, claim.id), isNull(claimArguments.deletedAt)));

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: claim.knowledgeBaseId,
        eventType: 'deleted',
        targetType: 'claim',
        targetId: claim.id,
        payload: { predicate: claim.predicate },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: claim.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'claim.deleted',
        targetType: 'claim',
        targetId: claim.id,
        metadata: { predicate: claim.predicate },
      });

      return claim;
    });
  },
};
