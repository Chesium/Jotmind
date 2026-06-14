import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Foundational key/value metadata table created by the initial migration.
 *
 * This is intentionally minimal: US-002 only needs a clean initial schema that
 * migrations can create in a fresh test database. The canonical graph tables
 * (entities, claims, notes, sources, ...) are added by later stories (US-005).
 */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AppMetaRow = typeof appMeta.$inferSelect;
export type NewAppMetaRow = typeof appMeta.$inferInsert;

/**
 * Server/local user accounts (US-003). Passwords are hashed with Argon2id; the
 * raw password is never stored. `role` is the system account role
 * (`admin` may create other accounts); Knowledge-Base-scoped roles come later.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Server-side, PostgreSQL-backed browser sessions (US-003). The session `id` is
 * an opaque random token stored in an HTTP-only cookie. `csrfToken` implements
 * the synchronizer-token CSRF defense for cookie-authenticated mutations.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

/**
 * Knowledge Bases (US-004) are the top-level graph scope. Canonical graph
 * records added in later stories carry a `knowledge_base_id` referencing this
 * table. The creating user becomes the `owner` via `knowledge_base_members`.
 */
export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;
export type NewKnowledgeBaseRow = typeof knowledgeBases.$inferInsert;

/**
 * Per-user role within a Knowledge Base (US-004). Roles are `owner`, `admin`,
 * `editor`, `viewer` (see `@jotmind/schemas`). Composite PK so a user has at
 * most one role per Knowledge Base.
 */
export const knowledgeBaseMembers = pgTable(
  'knowledge_base_members',
  {
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.knowledgeBaseId, table.userId] }),
  }),
);

export type KnowledgeBaseMemberRow = typeof knowledgeBaseMembers.$inferSelect;
export type NewKnowledgeBaseMemberRow = typeof knowledgeBaseMembers.$inferInsert;

/**
 * Append-only audit trail (US-004). Records security-relevant changes such as
 * Knowledge Base creation and role assignments with the acting user. Later
 * stories (US-014) extend this to all graph mutations. `knowledgeBaseId` and
 * `actorUserId` are nullable for server-scoped or system-originated events.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  knowledgeBaseId: uuid('knowledge_base_id').references(() => knowledgeBases.id, {
    onDelete: 'cascade',
  }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata')
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;

/**
 * Layered AI privacy policy (US-016). One row per policy layer:
 *   - `scope = 'server'`         → `scopeId` IS NULL (at most one row).
 *   - `scope = 'knowledge_base'` → `scopeId` = a Knowledge Base id.
 *   - `scope = 'user'`           → `scopeId` = a user id.
 * Missing rows resolve to the strictest policy ("No AI"/`off`) in the app layer
 * (`DEFAULT_AI_POLICY`), so fresh installs default to No AI (AC1). The effective
 * policy for a call is the strictest across the applicable layers (AC2).
 * `remoteEmbeddings` is the separate remote-embedding consent (AC4).
 */
export const aiPolicies = pgTable(
  'ai_policies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    scope: text('scope').notNull(),
    scopeId: uuid('scope_id'),
    mode: text('mode').notNull().default('off'),
    remoteEmbeddings: boolean('remote_embeddings').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    scopeCheck: check(
      'ai_policies_scope_check',
      sql`${table.scope} IN ('server', 'knowledge_base', 'user')`,
    ),
    modeCheck: check(
      'ai_policies_mode_check',
      sql`${table.mode} IN ('off', 'local_only', 'remote_per_request', 'remote_always')`,
    ),
    scopeIdCheck: check(
      'ai_policies_scope_id_check',
      sql`(${table.scope} = 'server' AND ${table.scopeId} IS NULL)
          OR (${table.scope} IN ('knowledge_base', 'user') AND ${table.scopeId} IS NOT NULL)`,
    ),
    uniqueServer: uniqueIndex('ai_policies_server_uq')
      .on(table.scope)
      .where(sql`scope = 'server'`),
    uniqueScoped: uniqueIndex('ai_policies_scope_scope_id_uq')
      .on(table.scope, table.scopeId)
      .where(sql`scope_id IS NOT NULL`),
  }),
);

export type AiPolicyRow = typeof aiPolicies.$inferSelect;
export type NewAiPolicyRow = typeof aiPolicies.$inferInsert;

// ---------------------------------------------------------------------------
// Canonical graph schema tables (US-005)
//
// These are the canonical, relational source of truth for the graph. Apache AGE
// remains a *derived* projection fed from `graphOutbox` (US-006), so all writes
// happen here first. Conventions for every canonical graph record:
//   - `id` is a stable UUIDv7 (PostgreSQL 18 native `uuidv7()`), time-sortable.
//   - `knowledgeBaseId` scopes the record to a Knowledge Base (US-004).
//   - `createdAt` / `updatedAt` are timestamptz.
//   - `deletedAt` (nullable) implements soft-delete (US-010); all reads must
//     filter `deleted_at IS NULL` and rule execution injects it (US-024).
//   - `createdBy` references the acting user for audit metadata.
//   - Custom/extensible properties live in JSONB (`properties`/`metadata`) and
//     are validated by application hooks (see `@jotmind/schemas`
//     `validateCustomProperties`) before write.
// KB-scoping is enforced at the application layer (requireKbRole); FKs are
// single-column to mirror the existing tables in this file.
// ---------------------------------------------------------------------------

/** SQL fragment for the PG18-native UUIDv7 primary-key default. */
const uuidv7 = sql`uuidv7()`;

/**
 * A custom schema definition: either an entity *type* (e.g. "Person") or a
 * claim *predicate* (e.g. "knows"). `name` is the stable conceptual string type
 * used for cross-version search/reasoning (US-028); concrete validation rules
 * live in `schemaVersions`.
 */
export const schemaDefinitions = pgTable(
  'schema_definitions',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    kindCheck: check(
      'schema_definitions_kind_check',
      sql`${table.kind} IN ('entity_type', 'claim_predicate')`,
    ),
    uniqueName: uniqueIndex('schema_definitions_kb_kind_name_uq')
      .on(table.knowledgeBaseId, table.kind, table.name)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type SchemaDefinitionRow = typeof schemaDefinitions.$inferSelect;
export type NewSchemaDefinitionRow = typeof schemaDefinitions.$inferInsert;

/**
 * A concrete version of a schema definition. Entities/claims reference the
 * `schemaVersions.id` they were validated against (US-005 AC4). `propertySchema`
 * is a JSON-schema-like spec for the JSONB custom properties; `spec` carries
 * predicate argument roles and compatible entity types (US-027). Breaking schema
 * changes create a new version (US-028).
 */
export const schemaVersions = pgTable(
  'schema_versions',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schemaDefinitionId: uuid('schema_definition_id')
      .notNull()
      .references(() => schemaDefinitions.id, { onDelete: 'cascade' }),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    propertySchema: jsonb('property_schema')
      .notNull()
      .default(sql`'{}'::jsonb`),
    spec: jsonb('spec')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    versionCheck: check('schema_versions_version_check', sql`${table.version} > 0`),
    uniqueVersion: uniqueIndex('schema_versions_definition_version_uq').on(
      table.schemaDefinitionId,
      table.version,
    ),
    oneActive: uniqueIndex('schema_versions_one_active_uq')
      .on(table.schemaDefinitionId)
      .where(sql`is_active = true AND deleted_at IS NULL`),
  }),
);

export type SchemaVersionRow = typeof schemaVersions.$inferSelect;
export type NewSchemaVersionRow = typeof schemaVersions.$inferInsert;

/**
 * A typed graph entity (Person, Event, Concept, Place, Character, ...). `type`
 * is the conceptual string type; `schemaVersionId` (nullable until custom
 * schemas exist, US-027) records the version it was validated against. Merge
 * (US-010) soft-deletes the archived row and points `mergedIntoId` at the
 * survivor.
 */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    schemaVersionId: uuid('schema_version_id').references(() => schemaVersions.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    aliases: jsonb('aliases')
      .notNull()
      .default(sql`'[]'::jsonb`),
    description: text('description'),
    tags: jsonb('tags')
      .notNull()
      .default(sql`'[]'::jsonb`),
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'::jsonb`),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => entities.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    notSelfMerge: check(
      'entities_not_self_merge_check',
      sql`${table.mergedIntoId} IS NULL OR ${table.mergedIntoId} <> ${table.id}`,
    ),
    byType: index('entities_kb_type_idx').on(table.knowledgeBaseId, table.type),
    byMergedInto: index('entities_merged_into_idx').on(table.mergedIntoId),
  }),
);

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;

/**
 * A provenance-aware claim (US-009). Claims are first-class records with a
 * `predicate`, optional `confidence` (0..1), optional valid-time range, and one
 * or more role-labeled `claimArguments` — multi-argument relations are NOT
 * reduced to binary edges. `provenance` JSONB carries merge history
 * (`historical_source_entities`, US-010) and AI/source metadata.
 */
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    predicate: text('predicate').notNull(),
    schemaVersionId: uuid('schema_version_id').references(() => schemaVersions.id, {
      onDelete: 'set null',
    }),
    description: text('description'),
    confidence: real('confidence'),
    validStart: timestamp('valid_start', { withTimezone: true }),
    validEnd: timestamp('valid_end', { withTimezone: true }),
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'::jsonb`),
    provenance: jsonb('provenance')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    confidenceCheck: check(
      'claims_confidence_check',
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
    validTimeCheck: check(
      'claims_valid_time_check',
      sql`${table.validStart} IS NULL OR ${table.validEnd} IS NULL OR ${table.validStart} <= ${table.validEnd}`,
    ),
    byPredicate: index('claims_kb_predicate_idx').on(table.knowledgeBaseId, table.predicate),
  }),
);

export type ClaimRow = typeof claims.$inferSelect;
export type NewClaimRow = typeof claims.$inferInsert;

/**
 * A role-labeled argument of a claim (US-009). Supports multi-argument
 * relations. An argument is either an entity reference (`argumentKind = 'entity'`,
 * `entityId` set) or a literal value (`argumentKind = 'literal'`, `value` set).
 */
export const claimArguments = pgTable(
  'claim_arguments',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    position: integer('position').notNull().default(0),
    argumentKind: text('argument_kind').notNull().default('entity'),
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'set null' }),
    value: jsonb('value'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    kindCheck: check(
      'claim_arguments_kind_check',
      sql`(${table.argumentKind} = 'entity' AND ${table.value} IS NULL)
          OR (${table.argumentKind} = 'literal' AND ${table.entityId} IS NULL AND ${table.value} IS NOT NULL)`,
    ),
    byClaim: index('claim_arguments_claim_idx').on(table.claimId),
    byEntity: index('claim_arguments_entity_idx').on(table.entityId),
  }),
);

export type ClaimArgumentRow = typeof claimArguments.$inferSelect;
export type NewClaimArgumentRow = typeof claimArguments.$inferInsert;

/**
 * Notes are canonical records for freeform captured text (US-011), NOT entity
 * rows. They hold original material before/after extraction and can be cited by
 * `sourceExcerpts`.
 */
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    title: text('title'),
    content: text('content').notNull(),
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    byKb: index('notes_kb_idx').on(table.knowledgeBaseId),
  }),
);

export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;

/**
 * Sources are canonical records for imported/captured material or structured
 * material metadata (US-011), NOT entity rows. `uri` is a basic locator
 * (URL/file path/import id); richer details live in `metadata`.
 */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    title: text('title'),
    sourceType: text('source_type'),
    uri: text('uri'),
    content: text('content'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    properties: jsonb('properties')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    byKb: index('sources_kb_idx').on(table.knowledgeBaseId),
  }),
);

export type SourceRow = typeof sources.$inferSelect;
export type NewSourceRow = typeof sources.$inferInsert;

/**
 * A Source Excerpt / Citation (US-011): references a span/excerpt in exactly one
 * origin (a Note or a Source) and optionally cites a `claim` it supports.
 */
export const sourceExcerpts = pgTable(
  'source_excerpts',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id').references(() => notes.id, { onDelete: 'cascade' }),
    claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
    excerpt: text('excerpt'),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    originCheck: check(
      'source_excerpts_origin_check',
      sql`(${table.sourceId} IS NOT NULL AND ${table.noteId} IS NULL)
          OR (${table.sourceId} IS NULL AND ${table.noteId} IS NOT NULL)`,
    ),
    spanCheck: check(
      'source_excerpts_span_check',
      sql`${table.spanStart} IS NULL OR ${table.spanEnd} IS NULL OR ${table.spanStart} <= ${table.spanEnd}`,
    ),
    byClaim: index('source_excerpts_claim_idx').on(table.claimId),
  }),
);

export type SourceExcerptRow = typeof sourceExcerpts.$inferSelect;
export type NewSourceExcerptRow = typeof sourceExcerpts.$inferInsert;

/**
 * A restricted Datalog-like inference rule (US-023). Each row is a version of a
 * conceptually-named rule. `ruleText` is the canonical Prolog-like text;
 * `compiled` caches the validated/compiled form. Drafts may be saved but only
 * `enabled` rules execute (US-024).
 */
export const ruleDefinitions = pgTable(
  'rule_definitions',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ruleText: text('rule_text').notNull(),
    compiled: jsonb('compiled'),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check(
      'rule_definitions_status_check',
      sql`${table.status} IN ('draft', 'enabled', 'disabled')`,
    ),
    versionCheck: check('rule_definitions_version_check', sql`${table.version} > 0`),
    uniqueVersion: uniqueIndex('rule_definitions_kb_name_version_uq')
      .on(table.knowledgeBaseId, table.name, table.version)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RuleDefinitionRow = typeof ruleDefinitions.$inferSelect;
export type NewRuleDefinitionRow = typeof ruleDefinitions.$inferInsert;

/**
 * An AI/import-generated proposal awaiting review (US-017/US-018/US-031).
 * `changes` is the structured create/update/delete/merge payload; nothing
 * mutates canonical records until a proposal is accepted. Links back to the
 * originating note/source/excerpt for provenance; rejected proposals stay
 * linked.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    changes: jsonb('changes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceNoteId: uuid('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    sourceSourceId: uuid('source_source_id').references(() => sources.id, { onDelete: 'set null' }),
    sourceExcerptId: uuid('source_excerpt_id').references(() => sourceExcerpts.id, {
      onDelete: 'set null',
    }),
    provider: text('provider'),
    model: text('model'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    reviewReason: text('review_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check(
      'proposals_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'rejected', 'dismissed')`,
    ),
    byStatus: index('proposals_kb_status_idx').on(table.knowledgeBaseId, table.status),
  }),
);

export type ProposalRow = typeof proposals.$inferSelect;
export type NewProposalRow = typeof proposals.$inferInsert;

/**
 * Durable, PostgreSQL-backed jobs (US-007 adds the worker/retry logic; this is
 * the table). Supports status, attempts, retry-after (`runAfter`), failure
 * reason, owner user, and optional `knowledgeBaseId`. Jobs are operational
 * records, not canonical knowledge, so there is no soft-delete.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id').references(() => knowledgeBases.id, {
      onDelete: 'cascade',
    }),
    type: text('type').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result'),
    failureReason: text('failure_reason'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    statusCheck: check(
      'jobs_status_check',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    attemptsCheck: check('jobs_attempts_check', sql`${table.attempts} >= 0`),
    maxAttemptsCheck: check('jobs_max_attempts_check', sql`${table.maxAttempts} > 0`),
    byClaimable: index('jobs_claimable_idx').on(table.status, table.runAfter, table.createdAt),
  }),
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;

/**
 * Transactional outbox for the AGE graph projection (US-006). Entity/claim/note/
 * source writes append an event here in the SAME transaction as the canonical
 * write; the projector consumes events ordered by (`createdAt`, `id`), marks
 * them processed, and is idempotent. UUIDv7 gives approximate time ordering (not
 * a strict sequence). Carries retry/error fields for projector backoff.
 */
export const graphOutbox = pgTable(
  'graph_outbox',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    statusCheck: check(
      'graph_outbox_status_check',
      sql`${table.status} IN ('pending', 'processed', 'failed')`,
    ),
    byClaimable: index('graph_outbox_claimable_idx').on(
      table.status,
      table.runAfter,
      table.createdAt,
    ),
    byTarget: index('graph_outbox_target_idx').on(table.targetType, table.targetId),
  }),
);

export type GraphOutboxRow = typeof graphOutbox.$inferSelect;
export type NewGraphOutboxRow = typeof graphOutbox.$inferInsert;
