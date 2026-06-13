import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { sessions, users } from '../db/schema.js';
import { dbAuthStore, hashPassword, verifyPassword } from './index.js';

/**
 * Integration tests for the PostgreSQL-backed AuthStore. Skipped automatically
 * when DATABASE_URL is unset so default `pnpm test:api` stays green. Run with a
 * live reference DB: `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

describe.skipIf(!hasDatabase)('auth store integration', () => {
  beforeAll(async () => {
    await runMigrations();
    // Start from a clean slate so assertions are deterministic.
    await getDb().execute(sql`TRUNCATE TABLE ${sessions}, ${users} CASCADE`);
  });

  afterAll(async () => {
    await getDb().execute(sql`TRUNCATE TABLE ${sessions}, ${users} CASCADE`);
    await closeDb();
  });

  it('creates users, sessions, and verifies Argon2id hashes end-to-end', async () => {
    expect(await dbAuthStore.countUsers()).toBe(0);

    const passwordHash = await hashPassword('integration-pass-123');
    const user = await dbAuthStore.createUser({
      email: 'admin@integration.test',
      passwordHash,
      role: 'admin',
    });
    expect(user.id).toMatch(/[0-9a-f-]{36}/);
    expect(await dbAuthStore.countUsers()).toBe(1);
    expect((await dbAuthStore.getUserByEmail('admin@integration.test'))?.id).toBe(user.id);
    expect(await verifyPassword(passwordHash, 'integration-pass-123')).toBe(true);

    const expiresAt = new Date(Date.now() + 60_000);
    const session = await dbAuthStore.createSession({
      id: 'sess-int-1',
      userId: user.id,
      csrfToken: 'csrf-int-1',
      expiresAt,
    });
    expect(session.csrfToken).toBe('csrf-int-1');

    const loaded = await dbAuthStore.getSession('sess-int-1');
    expect(loaded?.userId).toBe(user.id);

    await dbAuthStore.deleteSession('sess-int-1');
    expect(await dbAuthStore.getSession('sess-int-1')).toBeUndefined();
  });
});
