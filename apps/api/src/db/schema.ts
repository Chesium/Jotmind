import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
