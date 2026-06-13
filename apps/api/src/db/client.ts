import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | undefined;
let dbInstance: Database | undefined;

/**
 * Read the canonical PostgreSQL connection string. Returns undefined when the
 * database is not configured (e.g. unit-test runs without a live database).
 */
export function getDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url && url.length > 0 ? url : undefined;
}

/**
 * Lazily create (and memoize) the shared postgres-js client + Drizzle instance.
 * Throws if DATABASE_URL is not configured.
 */
export function getDb(): Database {
  if (dbInstance) return dbInstance;

  const url = getDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }

  sqlClient = postgres(url, { max: 5, onnotice: () => {} });
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

/** Get the raw postgres-js client, creating it if needed. */
export function getSqlClient(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    getDb();
  }
  // getDb() throws if unconfigured, so sqlClient is defined here.
  return sqlClient as ReturnType<typeof postgres>;
}

/** Close the shared connection pool (used in tests and on shutdown). */
export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    dbInstance = undefined;
  }
}
