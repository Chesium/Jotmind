import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  aiPolicies,
  auditEvents,
  knowledgeBaseMembers,
  knowledgeBases,
  sessions,
  users,
} from '../db/schema.js';
import { dbAuthStore, hashPassword } from '../auth/index.js';
import { dbAiPolicyStore } from './store.js';

/**
 * Integration tests for the PostgreSQL-backed AiPolicyStore (US-016). Skipped
 * when DATABASE_URL is unset so default `pnpm test:api` stays green. Run with a
 * live reference DB: `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

describe.skipIf(!hasDatabase)('ai policy store integration', () => {
  beforeAll(async () => {
    await runMigrations();
    await getDb().execute(
      sql`TRUNCATE TABLE ${aiPolicies}, ${auditEvents}, ${knowledgeBaseMembers}, ${knowledgeBases}, ${sessions}, ${users} CASCADE`,
    );
  });

  afterAll(async () => {
    await getDb().execute(
      sql`TRUNCATE TABLE ${aiPolicies}, ${auditEvents}, ${knowledgeBaseMembers}, ${knowledgeBases}, ${sessions}, ${users} CASCADE`,
    );
    await closeDb();
  });

  it('defaults missing layers to No AI (AC1)', async () => {
    expect(await dbAiPolicyStore.getPolicy({ scope: 'server', scopeId: null })).toEqual({
      mode: 'off',
      remoteEmbeddings: false,
    });
  });

  it('upserts a policy + records an audit event in the same tx', async () => {
    const actor = await dbAuthStore.createUser({
      email: 'policy-actor@integration.test',
      passwordHash: await hashPassword('actor-pass-123'),
      role: 'admin',
    });

    const created = await dbAiPolicyStore.updatePolicy({
      scope: 'user',
      scopeId: actor.id,
      changes: { mode: 'remote_per_request', remoteEmbeddings: true },
      actorUserId: actor.id,
    });
    expect(created).toEqual({ mode: 'remote_per_request', remoteEmbeddings: true });

    // Update an existing row (in-place, no duplicate).
    const updated = await dbAiPolicyStore.updatePolicy({
      scope: 'user',
      scopeId: actor.id,
      changes: { mode: 'local_only' },
      actorUserId: actor.id,
    });
    expect(updated).toEqual({ mode: 'local_only', remoteEmbeddings: true });

    const rows = await getDb()
      .select()
      .from(aiPolicies)
      .where(sql`scope = 'user' AND scope_id = ${actor.id}`);
    expect(rows).toHaveLength(1);

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(sql`action = 'ai_policy.updated'`);
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits[0]?.metadata).toMatchObject({ scope: 'user' });
  });

  it('enforces a single server policy row via the partial unique index', async () => {
    await dbAiPolicyStore.updatePolicy({
      scope: 'server',
      scopeId: null,
      changes: { mode: 'local_only' },
      actorUserId: null as unknown as string,
    });
    await dbAiPolicyStore.updatePolicy({
      scope: 'server',
      scopeId: null,
      changes: { mode: 'remote_always' },
      actorUserId: null as unknown as string,
    });
    const rows = await getDb()
      .select()
      .from(aiPolicies)
      .where(sql`scope = 'server'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mode).toBe('remote_always');
  });
});
