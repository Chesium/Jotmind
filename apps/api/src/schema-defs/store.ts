import { and, desc, eq, isNull } from 'drizzle-orm';
import type { PredicateSpec, PropertySchema, SchemaDefinitionKind } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  schemaDefinitions,
  schemaVersions,
  type SchemaDefinitionRow,
  type SchemaVersionRow,
} from '../db/schema.js';

/** A schema definition together with its currently active version (US-027). */
export interface SchemaDefinitionWithVersion extends SchemaDefinitionRow {
  activeVersion: SchemaVersionRow | null;
}

export interface CreateSchemaDefinitionInput {
  knowledgeBaseId: string;
  kind: SchemaDefinitionKind;
  name: string;
  displayName: string;
  description?: string;
  /** Entity-type property schema (validated against JSONB custom properties). */
  propertySchema?: PropertySchema;
  /** Claim-predicate spec (allowed argument roles + compatible entity types). */
  spec?: PredicateSpec;
  actorUserId: string;
}

export type CreateSchemaDefinitionResult =
  | { ok: true; definition: SchemaDefinitionWithVersion }
  | { ok: false; reason: 'duplicate_name' };

/**
 * Persistence boundary for custom schema definitions (US-027). Definitions are
 * Knowledge Base scoped; concrete validation rules live in versioned
 * `schema_versions`. Schemas are NOT graph projection targets, so writes record
 * an `audit_events` row only (no `graph_outbox`), mirroring the rules store.
 * Defined as an interface so route handlers can run against an in-memory fake in
 * unit tests while production uses the PostgreSQL-backed impl.
 */
export interface SchemaStore {
  listDefinitions(knowledgeBaseId: string): Promise<SchemaDefinitionWithVersion[]>;
  getDefinition(
    knowledgeBaseId: string,
    id: string,
  ): Promise<SchemaDefinitionWithVersion | undefined>;
  createDefinition(input: CreateSchemaDefinitionInput): Promise<CreateSchemaDefinitionResult>;
  /**
   * Resolve the active schema version for a conceptual type/predicate name, used
   * by entity/claim writes to validate + stamp `schemaVersionId` (US-027 AC3/AC5).
   * Returns undefined when no custom schema constrains the name.
   */
  getActiveVersionByName(
    knowledgeBaseId: string,
    kind: SchemaDefinitionKind,
    name: string,
  ): Promise<SchemaVersionRow | undefined>;
}

async function loadActiveVersion(
  db: ReturnType<typeof getDb>,
  schemaDefinitionId: string,
): Promise<SchemaVersionRow | null> {
  const rows = await db
    .select()
    .from(schemaVersions)
    .where(
      and(
        eq(schemaVersions.schemaDefinitionId, schemaDefinitionId),
        eq(schemaVersions.isActive, true),
        isNull(schemaVersions.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** PostgreSQL-backed SchemaStore. Resolves the Drizzle client per call. */
export const dbSchemaStore: SchemaStore = {
  async listDefinitions(knowledgeBaseId) {
    const db = getDb();
    const defs = await db
      .select()
      .from(schemaDefinitions)
      .where(
        and(
          eq(schemaDefinitions.knowledgeBaseId, knowledgeBaseId),
          isNull(schemaDefinitions.deletedAt),
        ),
      )
      .orderBy(desc(schemaDefinitions.createdAt));
    return Promise.all(
      defs.map(async (def) => ({ ...def, activeVersion: await loadActiveVersion(db, def.id) })),
    );
  },

  async getDefinition(knowledgeBaseId, id) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schemaDefinitions)
      .where(
        and(
          eq(schemaDefinitions.id, id),
          eq(schemaDefinitions.knowledgeBaseId, knowledgeBaseId),
          isNull(schemaDefinitions.deletedAt),
        ),
      )
      .limit(1);
    const def = rows[0];
    if (!def) return undefined;
    return { ...def, activeVersion: await loadActiveVersion(db, def.id) };
  },

  async createDefinition(input) {
    return getDb().transaction(async (tx) => {
      // Enforce the (kb, kind, name) uniqueness explicitly so we can return a
      // friendly result instead of surfacing the unique-index violation.
      const existing = await tx
        .select({ id: schemaDefinitions.id })
        .from(schemaDefinitions)
        .where(
          and(
            eq(schemaDefinitions.knowledgeBaseId, input.knowledgeBaseId),
            eq(schemaDefinitions.kind, input.kind),
            eq(schemaDefinitions.name, input.name),
            isNull(schemaDefinitions.deletedAt),
          ),
        )
        .limit(1);
      if (existing[0]) return { ok: false as const, reason: 'duplicate_name' as const };

      const defRows = await tx
        .insert(schemaDefinitions)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          kind: input.kind,
          name: input.name,
          displayName: input.displayName,
          description: input.description ?? null,
          createdBy: input.actorUserId,
        })
        .returning();
      const def = defRows[0];
      if (!def) throw new Error('Failed to create schema definition');

      const versionRows = await tx
        .insert(schemaVersions)
        .values({
          schemaDefinitionId: def.id,
          knowledgeBaseId: input.knowledgeBaseId,
          version: 1,
          propertySchema: input.propertySchema ?? {},
          spec: input.spec ?? {},
          isActive: true,
        })
        .returning();
      const version = versionRows[0];
      if (!version) throw new Error('Failed to create schema version');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'schema.created',
        targetType: 'schema_definition',
        targetId: def.id,
        metadata: { kind: def.kind, name: def.name, version: version.version },
      });

      return { ok: true as const, definition: { ...def, activeVersion: version } };
    });
  },

  async getActiveVersionByName(knowledgeBaseId, kind, name) {
    const db = getDb();
    const rows = await db
      .select({ version: schemaVersions })
      .from(schemaVersions)
      .innerJoin(schemaDefinitions, eq(schemaVersions.schemaDefinitionId, schemaDefinitions.id))
      .where(
        and(
          eq(schemaDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(schemaDefinitions.kind, kind),
          eq(schemaDefinitions.name, name),
          isNull(schemaDefinitions.deletedAt),
          eq(schemaVersions.isActive, true),
          isNull(schemaVersions.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.version;
  },
};
