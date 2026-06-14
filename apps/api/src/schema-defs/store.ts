import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  classifySchemaChange,
  predicateSpecSchema,
  type PredicateSpec,
  type PropertySchema,
  type SchemaChangeClassification,
  type SchemaDefinitionKind,
} from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import type { DbExecutor } from '../graph/outbox.js';
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

/** A schema definition together with its FULL version history (US-032 export). */
export interface SchemaDefinitionWithVersions extends SchemaDefinitionRow {
  activeVersion: SchemaVersionRow | null;
  /** All non-deleted versions, ascending by version number. */
  versions: SchemaVersionRow[];
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

/** Fields that can be changed by an update (US-028). */
export interface UpdateSchemaDefinitionInput {
  knowledgeBaseId: string;
  id: string;
  displayName?: string;
  /** `null` clears the description; `undefined` leaves it unchanged. */
  description?: string | null;
  /** New entity-type property schema (entity_type definitions). */
  propertySchema?: PropertySchema;
  /** New claim-predicate spec (claim_predicate definitions). */
  spec?: PredicateSpec;
  actorUserId: string;
}

export type UpdateSchemaDefinitionResult =
  | {
      ok: true;
      definition: SchemaDefinitionWithVersion;
      classification: SchemaChangeClassification;
    }
  | { ok: false; reason: 'not_found' };

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
  /**
   * List schema definitions WITH their full version history (US-032 portable
   * export). Versions are ascending by version number.
   */
  listDefinitionsWithVersions(knowledgeBaseId: string): Promise<SchemaDefinitionWithVersions[]>;
  getDefinition(
    knowledgeBaseId: string,
    id: string,
  ): Promise<SchemaDefinitionWithVersion | undefined>;
  createDefinition(input: CreateSchemaDefinitionInput): Promise<CreateSchemaDefinitionResult>;
  /**
   * Update a schema definition (US-028). Metadata-only changes and *compatible*
   * (loosening) validation changes update the active version in place; *breaking*
   * (tightening) validation changes create and activate a NEW version so existing
   * data can remain valid under its old referenced version (AC1/AC2/AC3).
   */
  updateDefinition(input: UpdateSchemaDefinitionInput): Promise<UpdateSchemaDefinitionResult>;
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
  db: DbExecutor,
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

  async listDefinitionsWithVersions(knowledgeBaseId) {
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
      defs.map(async (def) => {
        const versions = await db
          .select()
          .from(schemaVersions)
          .where(
            and(eq(schemaVersions.schemaDefinitionId, def.id), isNull(schemaVersions.deletedAt)),
          )
          .orderBy(schemaVersions.version);
        const activeVersion = versions.find((v) => v.isActive) ?? null;
        return { ...def, activeVersion, versions };
      }),
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

  async updateDefinition(input) {
    return getDb().transaction(async (tx) => {
      const defRows = await tx
        .select()
        .from(schemaDefinitions)
        .where(
          and(
            eq(schemaDefinitions.id, input.id),
            eq(schemaDefinitions.knowledgeBaseId, input.knowledgeBaseId),
            isNull(schemaDefinitions.deletedAt),
          ),
        )
        .limit(1);
      const def = defRows[0];
      if (!def) return { ok: false as const, reason: 'not_found' as const };

      const active = await loadActiveVersion(tx, def.id);
      const currentPropertySchema = (active?.propertySchema as PropertySchema) ?? {};
      const currentSpec = predicateSpecSchema.parse(
        (active?.spec as Record<string, unknown>) ?? {},
      );
      const nextPropertySchema = input.propertySchema ?? currentPropertySchema;
      const nextSpec = input.spec ?? currentSpec;

      const validationChanged = input.propertySchema !== undefined || input.spec !== undefined;
      const classification = validationChanged
        ? classifySchemaChange(
            def.kind as SchemaDefinitionKind,
            { propertySchema: currentPropertySchema, spec: currentSpec },
            { propertySchema: nextPropertySchema, spec: nextSpec },
          )
        : { changeType: 'compatible' as const, reasons: [] };

      // Update definition metadata (display name / description) in place.
      const metaUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (input.displayName !== undefined) metaUpdate.displayName = input.displayName;
      if (input.description !== undefined) metaUpdate.description = input.description;
      await tx.update(schemaDefinitions).set(metaUpdate).where(eq(schemaDefinitions.id, def.id));

      let activeVersion: SchemaVersionRow | null = active;

      if (validationChanged && active) {
        if (classification.changeType === 'breaking') {
          // Tighten: deactivate the current version and activate a NEW version so
          // existing data can remain valid under its old referenced version (AC3).
          await tx
            .update(schemaVersions)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(schemaVersions.id, active.id));
          const maxRows = await tx
            .select({ max: sql<number>`max(${schemaVersions.version})` })
            .from(schemaVersions)
            .where(eq(schemaVersions.schemaDefinitionId, def.id));
          const nextVersionNumber = (maxRows[0]?.max ?? active.version) + 1;
          const inserted = await tx
            .insert(schemaVersions)
            .values({
              schemaDefinitionId: def.id,
              knowledgeBaseId: input.knowledgeBaseId,
              version: nextVersionNumber,
              propertySchema: nextPropertySchema,
              spec: nextSpec,
              isActive: true,
            })
            .returning();
          activeVersion = inserted[0] ?? activeVersion;
        } else {
          // Compatible: loosen in place — no new version, existing data untouched.
          const updated = await tx
            .update(schemaVersions)
            .set({ propertySchema: nextPropertySchema, spec: nextSpec, updatedAt: new Date() })
            .where(eq(schemaVersions.id, active.id))
            .returning();
          activeVersion = updated[0] ?? activeVersion;
        }
      }

      const reloaded = await tx
        .select()
        .from(schemaDefinitions)
        .where(eq(schemaDefinitions.id, def.id))
        .limit(1);
      const finalDef = reloaded[0] ?? def;

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action:
          classification.changeType === 'breaking' ? 'schema.version_created' : 'schema.updated',
        targetType: 'schema_definition',
        targetId: def.id,
        metadata: {
          kind: def.kind,
          name: def.name,
          changeType: classification.changeType,
          reasons: classification.reasons,
          version: activeVersion?.version ?? null,
        },
      });

      return {
        ok: true as const,
        definition: { ...finalDef, activeVersion },
        classification,
      };
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
