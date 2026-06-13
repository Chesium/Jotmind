import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDatabaseUrl, getDb, getSqlClient, closeDb } from './client.js';

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Ensure the required PostgreSQL extensions exist, then apply all pending
 * Drizzle migrations. Extension creation is idempotent and requires the
 * connecting role to have permission to CREATE EXTENSION (superuser in the
 * reference Docker image).
 */
export async function runMigrations(): Promise<void> {
  if (!getDatabaseUrl()) {
    throw new Error('DATABASE_URL is not configured; cannot run migrations');
  }

  const client = getSqlClient();
  await client`CREATE EXTENSION IF NOT EXISTS age`;
  await client`CREATE EXTENSION IF NOT EXISTS vector`;

  await migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
}

// Allow running directly: `node dist/db/migrate.js` / `tsx src/db/migrate.ts`.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  runMigrations()
    .then(() => {
      console.log('[jotmind-api] migrations applied');
    })
    .catch((err: unknown) => {
      console.error('[jotmind-api] migration failed:', err);
      process.exitCode = 1;
    })
    .finally(() => {
      void closeDb();
    });
}
