import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BUILTIN_RULE_MODULES, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { RuleDefinitionRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type {
  CreateRuleInput,
  InstallRulePackInput,
  RuleStore,
  SetRuleStatusInput,
  UpdateRuleInput,
} from './store.js';

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

interface SideEffect {
  action: string;
  targetId: string;
}

function createMemoryRuleStore(): RuleStore & { audits: SideEffect[] } {
  const byId = new Map<string, RuleDefinitionRow>();
  const audits: SideEffect[] = [];
  return {
    audits,
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
          compiled: {
            builtin: {
              moduleId: input.module.id,
              packId: input.pack.id,
              ruleKey: rule.key,
              packVersion: input.pack.version,
            },
          },
          status: 'disabled',
          version: input.pack.version,
          createdBy: input.actorUserId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        byId.set(row.id, row);
        audits.push({ action: 'rule.installed', targetId: row.id });
        installed.push(row);
      }
      return Promise.resolve({ installed, skipped });
    },
    setRuleStatus: (input: SetRuleStatusInput) => {
      const row = byId.get(input.id);
      if (!row || row.knowledgeBaseId !== input.knowledgeBaseId || row.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      row.status = input.status;
      row.updatedAt = new Date();
      audits.push({
        action: input.status === 'enabled' ? 'rule.enabled' : 'rule.disabled',
        targetId: row.id,
      });
      return Promise.resolve(row);
    },
    createRule: (input: CreateRuleInput) => {
      const dup = [...byId.values()].find(
        (r) =>
          r.knowledgeBaseId === input.knowledgeBaseId &&
          r.name === input.name &&
          r.deletedAt === null,
      );
      if (dup) return Promise.resolve({ ok: false as const, reason: 'duplicate_name' as const });
      const now = new Date();
      const row: RuleDefinitionRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        name: input.name,
        description: input.description ?? null,
        ruleText: input.ruleText,
        compiled: { authored: { recursionCap: input.recursionCap ?? null } },
        status: 'draft',
        version: 1,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      audits.push({ action: 'rule.created', targetId: row.id });
      return Promise.resolve({ ok: true as const, rule: row });
    },
    updateRule: (input: UpdateRuleInput) => {
      const row = byId.get(input.id);
      if (!row || row.knowledgeBaseId !== input.knowledgeBaseId || row.deletedAt !== null) {
        return Promise.resolve({ ok: false as const, reason: 'not_found' as const });
      }
      if (input.name !== undefined && input.name !== row.name) {
        const dup = [...byId.values()].find(
          (r) =>
            r.knowledgeBaseId === input.knowledgeBaseId &&
            r.name === input.name &&
            r.deletedAt === null,
        );
        if (dup) return Promise.resolve({ ok: false as const, reason: 'duplicate_name' as const });
      }
      if (input.name !== undefined) row.name = input.name;
      if (input.description !== undefined) row.description = input.description;
      if (input.ruleText !== undefined) row.ruleText = input.ruleText;
      row.updatedAt = new Date();
      audits.push({ action: 'rule.updated', targetId: row.id });
      return Promise.resolve({ ok: true as const, rule: row });
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

async function setup() {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const ruleStore = createMemoryRuleStore();
  const app = createApp({ authStore, kbStore, ruleStore });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/setup').send(ADMIN);
  const userId = res.body.user.id as string;
  const csrf = res.body.csrfToken as string;
  return { app, agent, kbStore, ruleStore, userId, csrf };
}

const KB = '11111111-1111-1111-1111-111111111111';

describe('rules router (US-022)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('lists the built-in rule pack catalog for viewers', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    const res = await ctx.agent.get(`/api/knowledge-bases/${KB}/rules/packs`).expect(200);
    expect(res.body).toHaveLength(BUILTIN_RULE_MODULES.length);
    const ids = (res.body as { id: string }[]).map((m) => m.id);
    expect(ids).toContain('personal-relationship');
    expect(ids).toContain('reading-character-map');
    for (const mod of res.body as { packs: unknown[] }[]) {
      expect(mod.packs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('installs a rule pack as disabled rules with audit events (editor)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship', packId: 'event-participation' })
      .expect(201);
    expect(res.body.installed.length).toBe(2);
    expect(res.body.skipped).toHaveLength(0);
    for (const rule of res.body.installed as {
      status: string;
      version: number;
      moduleId: string;
      packId: string;
    }[]) {
      expect(rule.status).toBe('disabled');
      expect(rule.version).toBe(1);
      expect(rule.moduleId).toBe('personal-relationship');
      expect(rule.packId).toBe('event-participation');
    }
    expect(ctx.ruleStore.audits.filter((a) => a.action === 'rule.installed')).toHaveLength(2);

    const list = await ctx.agent.get(`/api/knowledge-bases/${KB}/rules`).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('is idempotent: re-installing skips already-installed rules', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'reading-character-map', packId: 'family-relationship' })
      .expect(201);
    const again = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'reading-character-map', packId: 'family-relationship' })
      .expect(201);
    expect(again.body.installed).toHaveLength(0);
    expect(again.body.skipped.length).toBe(2);
  });

  it('enables then disables a rule with audit events (AC4)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const install = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship', packId: 'event-participation' })
      .expect(201);
    const ruleId = install.body.installed[0].id as string;

    const enabled = await ctx.agent
      .patch(`/api/knowledge-bases/${KB}/rules/${ruleId}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ status: 'enabled' })
      .expect(200);
    expect(enabled.body.status).toBe('enabled');

    const disabled = await ctx.agent
      .patch(`/api/knowledge-bases/${KB}/rules/${ruleId}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ status: 'disabled' })
      .expect(200);
    expect(disabled.body.status).toBe('disabled');

    expect(ctx.ruleStore.audits.some((a) => a.action === 'rule.enabled')).toBe(true);
    expect(ctx.ruleStore.audits.some((a) => a.action === 'rule.disabled')).toBe(true);
  });

  it('returns 404 for an unknown rule pack', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'nope', packId: 'nope' })
      .expect(404);
  });

  it('rejects an invalid status payload with 400', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const install = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship', packId: 'event-participation' })
      .expect(201);
    const ruleId = install.body.installed[0].id as string;
    await ctx.agent
      .patch(`/api/knowledge-bases/${KB}/rules/${ruleId}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ status: 'draft' })
      .expect(400);
  });

  it('forbids viewers from installing or toggling rules (read-only)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .set('x-csrf-token', ctx.csrf)
      .send({ moduleId: 'personal-relationship', packId: 'event-participation' })
      .expect(403);
  });

  it('requires CSRF for mutations', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/install`)
      .send({ moduleId: 'personal-relationship', packId: 'event-participation' })
      .expect(403);
  });

  it('returns 404 for non-members', async () => {
    await ctx.agent.get(`/api/knowledge-bases/${KB}/rules`).expect(404);
  });
});

const VALID_RULE =
  'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).';
const INVALID_RULE = 'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a).';

describe('custom rule authoring (US-023)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('validates rule text without saving (viewer+, read-only)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    const ok = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/validate`)
      .send({ ruleText: VALID_RULE })
      .expect(200);
    expect(ok.body.valid).toBe(true);
    expect(ok.body.errors).toEqual([]);

    const bad = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/validate`)
      .send({ ruleText: INVALID_RULE })
      .expect(200);
    expect(bad.body.valid).toBe(false);
    expect(bad.body.errors.length).toBeGreaterThan(0);
  });

  it('creates an authored rule as a draft with audit (editor, AC5/AC6)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.valid).toBe(true);
    expect(res.body.moduleId).toBeNull();
    expect(ctx.ruleStore.audits.some((a) => a.action === 'rule.created')).toBe(true);
  });

  it('saves an invalid rule as a draft (AC6) but refuses to enable it (AC5)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const created = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'broken', ruleText: INVALID_RULE })
      .expect(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.valid).toBe(false);
    expect(created.body.validationErrors.length).toBeGreaterThan(0);

    await ctx.agent
      .patch(`/api/knowledge-bases/${KB}/rules/${created.body.id}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ status: 'enabled' })
      .expect(422);
  });

  it('enables a valid authored rule (AC5)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const created = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(201);
    const enabled = await ctx.agent
      .patch(`/api/knowledge-bases/${KB}/rules/${created.body.id}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ status: 'enabled' })
      .expect(200);
    expect(enabled.body.status).toBe('enabled');
  });

  it('rejects a duplicate rule name with 409', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(201);
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(409);
  });

  it('edits an authored rule via PUT (editor, AC5)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const created = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: INVALID_RULE })
      .expect(201);
    expect(created.body.valid).toBe(false);
    const edited = await ctx.agent
      .put(`/api/knowledge-bases/${KB}/rules/${created.body.id}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ ruleText: VALID_RULE })
      .expect(200);
    expect(edited.body.valid).toBe(true);
    expect(ctx.ruleStore.audits.some((a) => a.action === 'rule.updated')).toBe(true);
  });

  it('returns 404 when editing a missing rule', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .put(`/api/knowledge-bases/${KB}/rules/${randomUUID()}`)
      .set('x-csrf-token', ctx.csrf)
      .send({ ruleText: VALID_RULE })
      .expect(404);
  });

  it('forbids viewers from creating rules (read-only)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(403);
  });

  it('requires CSRF to create a rule', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .send({ name: 'knows', ruleText: VALID_RULE })
      .expect(403);
  });

  it('rejects an empty rule text with 400', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules`)
      .set('x-csrf-token', ctx.csrf)
      .send({ name: 'knows', ruleText: '' })
      .expect(400);
  });
});
