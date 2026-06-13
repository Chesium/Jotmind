import { afterAll, describe, expect, it } from 'vitest';
import { checkDatabaseHealth } from './health.js';
import { closeDb, getDatabaseUrl, getSqlClient } from './client.js';
import { runMigrations } from './migrate.js';

/**
 * Integration tests that require a live PostgreSQL with Apache AGE + pgvector.
 * They are skipped automatically when DATABASE_URL is not set, so the default
 * `pnpm test:api` run stays green without infrastructure. CI/operators run them
 * against the reference Docker image (see docker-compose.yml).
 */
const hasDatabase = Boolean(getDatabaseUrl());

describe.skipIf(!hasDatabase)('database integration', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('applies migrations to create the initial schema', async () => {
    await runMigrations();

    const client = getSqlClient();
    const rows = await client<{ exists: boolean }[]>`
      SELECT to_regclass('public.app_meta') IS NOT NULL AS exists
    `;
    expect(rows[0]?.exists).toBe(true);
  });

  it('reports connectivity and required extension availability', async () => {
    const health = await checkDatabaseHealth();
    expect(health.configured).toBe(true);
    expect(health.connected).toBe(true);
    expect(health.extensions.age).toBe(true);
    expect(health.extensions.vector).toBe(true);
  });
});
