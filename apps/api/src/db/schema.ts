import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
