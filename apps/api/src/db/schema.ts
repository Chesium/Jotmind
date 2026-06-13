import { sql } from 'drizzle-orm';
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
