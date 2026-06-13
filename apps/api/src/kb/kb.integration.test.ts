import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  knowledgeBaseMembers,
  knowledgeBases,
  sessions,
  users,
} from '../db/schema.js';
import { dbAuthStore, hashPassword } from '../auth/index.js';
import { dbKnowledgeBaseStore } from './store.js';

/**
 * Integration tests for the PostgreSQL-backed KnowledgeBaseStore. Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run with a live
 * reference DB: `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

describe.skipIf(!hasDatabase)('knowledge base store integration', () => {
  beforeAll(async () => {
    await runMigrations();
    await getDb().execute(
      sql`TRUNCATE TABLE ${auditEvents}, ${knowledgeBaseMembers}, ${knowledgeBases}, ${sessions}, ${users} CASCADE`,
    );
  });

  afterAll(async () => {
    await getDb().execute(
      sql`TRUNCATE TABLE ${auditEvents}, ${knowledgeBaseMembers}, ${knowledgeBases}, ${sessions}, ${users} CASCADE`,
    );
    await closeDb();
  });

  it('creates a KB with owner membership + audit events, and assigns roles', async () => {
    const owner = await dbAuthStore.createUser({
      email: 'kb-owner@integration.test',
      passwordHash: await hashPassword('owner-pass-123'),
      role: 'admin',
    });
    const member = await dbAuthStore.createUser({
      email: 'kb-member@integration.test',
      passwordHash: await hashPassword('member-pass-123'),
      role: 'member',
    });

    const kb = await dbKnowledgeBaseStore.createKnowledgeBase({
      name: 'Integration KB',
      description: 'desc',
      createdBy: owner.id,
    });
    expect(kb.role).toBe('owner');
    expect(kb.id).toMatch(/[0-9a-f-]{36}/);

    // Creator is owner; non-member has no role.
    expect(await dbKnowledgeBaseStore.getRole(kb.id, owner.id)).toBe('owner');
    expect(await dbKnowledgeBaseStore.getRole(kb.id, member.id)).toBeUndefined();

    // Listing is scoped to membership.
    expect(await dbKnowledgeBaseStore.listForUser(owner.id)).toHaveLength(1);
    expect(await dbKnowledgeBaseStore.listForUser(member.id)).toHaveLength(0);

    // Assign and then change a role.
    await dbKnowledgeBaseStore.assignRole({
      knowledgeBaseId: kb.id,
      userId: member.id,
      role: 'viewer',
      actorUserId: owner.id,
    });
    expect(await dbKnowledgeBaseStore.getRole(kb.id, member.id)).toBe('viewer');
    await dbKnowledgeBaseStore.assignRole({
      knowledgeBaseId: kb.id,
      userId: member.id,
      role: 'editor',
      actorUserId: owner.id,
    });
    expect(await dbKnowledgeBaseStore.getRole(kb.id, member.id)).toBe('editor');

    const members = await dbKnowledgeBaseStore.listMembers(kb.id);
    expect(members.map((m) => m.email).sort()).toEqual([
      'kb-member@integration.test',
      'kb-owner@integration.test',
    ]);

    // Audit trail records creation + both role assignments (owner + member).
    const events = await dbKnowledgeBaseStore.listAuditEvents(kb.id);
    const actions = events.map((e) => e.action);
    expect(actions).toContain('knowledge_base.created');
    expect(
      actions.filter((a) => a === 'knowledge_base.role_assigned').length,
    ).toBeGreaterThanOrEqual(2);
  });
});
