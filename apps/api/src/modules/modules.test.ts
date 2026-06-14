import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { findBuiltinModule, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { RuleDefinitionRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { InstallRulePackInput, RuleStore } from '../rules/store.js';
import { createMemorySchemaStore } from '../schema-defs/schema-defs.test.js';

function createMemoryAuthStore(): AuthStore {
  const usersById = new Map<string, UserRow>();
  const usersByEmail = new Map<string, UserRow>();
  const sessionsById = new Map<string, SessionRow>();
  return {
    countUsers: () => Promise.resolve(usersById.size),
    getUserById: (id) => Promise.resolve(usersById.get(id)),
    getUserByEmail: (email) => Promise.resolve(usersByEmail.get(email)),
    createUser: ({ email, passwordHash, role }) => {
      const now = new Date();
      const row: UserRow = {
        id: randomUUID(),
        email,
        passwordHash,
        role,
        createdAt: now,
        updatedAt: now,
      };
      usersById.set(row.id, row);
      usersByEmail.set(email, row);
      return Promise.resolve(row);
    },
    createSession: ({ id, userId, csrfToken, expiresAt }) => {
      const row: SessionRow = { id, userId, csrfToken, expiresAt, createdAt: new Date() };
      sessionsById.set(id, row);
      return Promise.resolve(row);
    },
    getSession: (id) => Promise.resolve(sessionsById.get(id)),
    deleteSession: (id) => {
      sessionsById.delete(id);
      return Promise.resolve();
    },
  };
}

function createMemoryKbStore(): KnowledgeBaseStore & {
  setRole(kb: string, user: string, role: KbRole): void;
} {
  const roles = new Map<string, KbRole>();
  const key = (kb: string, user: string) => `${kb}:${user}`;
  const unsupported = () => Promise.reject(new Error('not supported in this fake'));
  return {
    setRole(kb, user, role) {
      roles.set(key(kb, user), role);
    },
    getRole: (kb, user) => Promise.resolve(roles.get(key(kb, user))),
    createKnowledgeBase: unsupported as never,
    listForUser: () => Promise.resolve([]),
    getForUser: () => Promise.resolve(undefined),
    listMembers: () => Promise.resolve([]),
    userExists: () => Promise.resolve(true),
    assignRole: unsupported as never,
    listAuditEvents: () => Promise.resolve([]),
  };
}

function createMemoryRuleStore(): RuleStore & { installs: string[] } {
  const byId = new Map<string, RuleDefinitionRow>();
  const installs: string[] = [];
  return {
    installs,
    listRules: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((r) => r.knowledgeBaseId === kb && r.deletedAt === null),
      ),
    getRule: (kb, id) => {
      const r = byId.get(id);
      return Promise.resolve(r && r.knowledgeBaseId === kb && r.deletedAt === null ? r : undefined);
    },
    installRulePack: (input: InstallRulePackInput) => {
      const installed: RuleDefinitionRow[] = [];
      const skipped: { name: string; version: number; reason: string }[] = [];
      for (const rule of input.pack.rules) {
        const dup = [...byId.values()].find(
          (r) =>
            r.knowledgeBaseId === input.knowledgeBaseId &&
            r.name === rule.name &&
            r.version === input.pack.version &&
            r.deletedAt === null,
        );
        if (dup) {
          skipped.push({
            name: rule.name,
            version: input.pack.version,
            reason: 'already installed',
          });
          continue;
        }
        const now = new Date();
        const row: RuleDefinitionRow = {
          id: randomUUID(),
          knowledgeBaseId: input.knowledgeBaseId,
          name: rule.name,
          description: rule.description,
          ruleText: rule.ruleText,
          compiled: {},
          status: 'disabled',
          version: input.pack.version,
          createdBy: input.actorUserId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        byId.set(row.id, row);
        installs.push(rule.name);
        installed.push(row);
      }
      return Promise.resolve({ installed, skipped });
    },
    setRuleStatus: () => Promise.resolve(undefined),
    createRule: () => Promise.resolve({ ok: false as const, reason: 'duplicate_name' as const }),
    updateRule: () => Promise.resolve({ ok: false as const, reason: 'not_found' as const }),
  };
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };

async function setup() {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const schemaStore = createMemorySchemaStore();
  const ruleStore = createMemoryRuleStore();
  const app = createApp({ authStore, kbStore, schemaStore, ruleStore });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/setup').send(ADMIN);
  const userId = res.body.user.id as string;
  const csrf = res.body.csrfToken as string;
  return { app, agent, kbStore, schemaStore, ruleStore, userId, csrf };
}

const KB = '11111111-1111-1111-1111-111111111111';

describe('modules router (US-029)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('lists the Module catalog with installed status for viewers', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    const res = await ctx.agent.get(`/api/knowledge-bases/${KB}/modules`).expect(200);
    const ids = (res.body as { id: string }[]).map((m) => m.id);
    expect(ids).toContain('personal-relationship');
    const pr = (
      res.body as { id: string; fullyInstalled: boolean; installedEntityTypes: string[] }[]
    ).find((m) => m.id === 'personal-relationship')!;
    expect(pr.fullyInstalled).toBe(false);
    expect(pr.installedEntityTypes).toEqual([]);
  });

  it('installs a Module: schema definitions + rule packs (editor)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const mod = findBuiltinModule('personal-relationship')!;
    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship' })
      .expect(201);
    const items = res.body.items as { kind: string; name: string; status: string }[];
    const entityTypes = items.filter((i) => i.kind === 'entity_type');
    expect(entityTypes.map((i) => i.name)).toEqual(
      expect.arrayContaining(['Person', 'Event', 'Place']),
    );
    expect(entityTypes.every((i) => i.status === 'installed')).toBe(true);
    expect(items.filter((i) => i.kind === 'claim_predicate')).toHaveLength(
      mod.claimPredicates.length,
    );
    expect(items.some((i) => i.kind === 'rule_pack' && i.status === 'installed')).toBe(true);

    // The schema definitions now exist in the KB.
    const defs = await ctx.schemaStore.listDefinitions(KB);
    expect(defs.map((d) => d.name)).toEqual(expect.arrayContaining(['Person', 'Event', 'Place']));
  });

  it('is idempotent: re-installing skips existing content', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship' })
      .expect(201);
    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship' })
      .expect(201);
    const items = res.body.items as { status: string }[];
    expect(items.every((i) => i.status === 'skipped')).toBe(true);

    // Status now reports fully installed.
    const status = await ctx.agent.get(`/api/knowledge-bases/${KB}/modules`).expect(200);
    const pr = (status.body as { id: string; fullyInstalled: boolean }[]).find(
      (m) => m.id === 'personal-relationship',
    )!;
    expect(pr.fullyInstalled).toBe(true);
  });

  it('returns 404 for an unknown module', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'does-not-exist' })
      .expect(404);
  });

  it('rejects an invalid install body with 400', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(400);
  });

  it('forbids viewers from installing (read-only, 403)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship' })
      .expect(403);
  });

  it('requires CSRF for install (403)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/modules/install`)
      .send({ moduleId: 'personal-relationship' })
      .expect(403);
  });

  it('hides existence from non-members (404)', async () => {
    await ctx.agent.get(`/api/knowledge-bases/${KB}/modules`).expect(404);
  });
});
