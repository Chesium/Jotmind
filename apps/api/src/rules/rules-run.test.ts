import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type {
  InferredResultRow,
  RuleDefinitionRow,
  RuleRunRow,
  SessionRow,
  UserRow,
} from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { RuleStore } from './store.js';
import type { RuleFacts } from './engine.js';
import type { RuleRunStore, SaveRuleRunInput } from './run-store.js';

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

/** Minimal RuleStore fake that lets a test seed rules directly. */
function createMemoryRuleStore(): RuleStore & {
  seed(
    row: Partial<RuleDefinitionRow> & { knowledgeBaseId: string; ruleText: string },
  ): RuleDefinitionRow;
} {
  const byId = new Map<string, RuleDefinitionRow>();
  const unsupported = () => Promise.reject(new Error('not used in run tests'));
  return {
    seed(input) {
      const now = new Date();
      const row: RuleDefinitionRow = {
        id: input.id ?? randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        name: input.name ?? 'rule',
        description: input.description ?? null,
        ruleText: input.ruleText,
        compiled: input.compiled ?? null,
        status: input.status ?? 'enabled',
        version: input.version ?? 1,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      return row;
    },
    listRules: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((r) => r.knowledgeBaseId === kb && r.deletedAt === null),
      ),
    getRule: (kb, id) => {
      const r = byId.get(id);
      return Promise.resolve(r && r.knowledgeBaseId === kb && r.deletedAt === null ? r : undefined);
    },
    installRulePack: unsupported as never,
    setRuleStatus: unsupported as never,
    createRule: unsupported as never,
    updateRule: unsupported as never,
  };
}

/** In-memory RuleRunStore with seedable facts; records runs + results. */
function createMemoryRuleRunStore(facts: RuleFacts): RuleRunStore & {
  saved: SaveRuleRunInput[];
} {
  const runs = new Map<string, RuleRunRow>();
  const resultsByRun = new Map<string, InferredResultRow[]>();
  const saved: SaveRuleRunInput[] = [];
  return {
    saved,
    loadFacts: () => Promise.resolve(facts),
    saveRun: (input) => {
      saved.push(input);
      const now = new Date();
      const run: RuleRunRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        ruleId: input.ruleId,
        ruleName: input.ruleName,
        status: input.status,
        error: input.error,
        resultCount: input.results.length,
        iterations: input.iterations,
        limitExceeded: input.limitExceeded,
        triggeredBy: input.triggeredBy,
        jobId: input.jobId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        createdAt: now,
      };
      runs.set(run.id, run);
      const results: InferredResultRow[] = input.results.map((r) => ({
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        ruleRunId: run.id,
        ruleId: input.ruleId,
        predicate: input.predicate,
        arguments: r.arguments,
        trace: { claimIds: r.claimIds, entityIds: r.entityIds, argumentIds: r.argumentIds },
        createdAt: now,
      }));
      resultsByRun.set(run.id, results);
      return Promise.resolve({ run, results });
    },
    listRuns: (kb) => Promise.resolve([...runs.values()].filter((r) => r.knowledgeBaseId === kb)),
    getRun: (kb, id) => {
      const r = runs.get(id);
      return Promise.resolve(r && r.knowledgeBaseId === kb ? r : undefined);
    },
    listResults: (_kb, runId) => Promise.resolve(resultsByRun.get(runId) ?? []),
  };
}

const ADA = '00000000-0000-0000-0000-0000000000a1';
const BAB = '00000000-0000-0000-0000-0000000000b2';
const EV1 = '00000000-0000-0000-0000-0000000000e1';

function attendanceFacts(): RuleFacts {
  return {
    entities: [
      { id: ADA, type: 'Person', name: 'Ada' },
      { id: BAB, type: 'Person', name: 'Babbage' },
      { id: EV1, type: 'Event', name: 'Conf' },
    ],
    claims: [
      { id: '00000000-0000-0000-0000-0000000000f1', predicate: 'attended' },
      { id: '00000000-0000-0000-0000-0000000000f2', predicate: 'attended' },
    ],
    args: [
      {
        id: '11111111-0000-0000-0000-000000000001',
        claimId: '00000000-0000-0000-0000-0000000000f1',
        role: 'person',
        entityId: ADA,
      },
      {
        id: '11111111-0000-0000-0000-000000000002',
        claimId: '00000000-0000-0000-0000-0000000000f1',
        role: 'event',
        entityId: EV1,
      },
      {
        id: '11111111-0000-0000-0000-000000000003',
        claimId: '00000000-0000-0000-0000-0000000000f2',
        role: 'person',
        entityId: BAB,
      },
      {
        id: '11111111-0000-0000-0000-000000000004',
        claimId: '00000000-0000-0000-0000-0000000000f2',
        role: 'event',
        entityId: EV1,
      },
    ],
  };
}

const ACQUAINTED =
  'acquainted(?a, ?b) <- claim(?e1, "attended"), arg(?e1, "person", ?a), arg(?e1, "event", ?ev), claim(?e2, "attended"), arg(?e2, "person", ?b), arg(?e2, "event", ?ev).';

const ADMIN = { email: 'admin@example.com', password: '[REDACTED:password]' };
const KB = '11111111-1111-1111-1111-111111111111';

async function setup(facts: RuleFacts = attendanceFacts()) {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const ruleStore = createMemoryRuleStore();
  const ruleRunStore = createMemoryRuleRunStore(facts);
  const app = createApp({ authStore, kbStore, ruleStore, ruleRunStore });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/setup').send(ADMIN);
  const userId = res.body.user.id as string;
  const csrf = res.body.csrfToken as string;
  return { app, agent, kbStore, ruleStore, ruleRunStore, userId, csrf };
}

describe('rule run router (US-024)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('runs an enabled rule and returns inferred results with traces (AC1/AC6/AC8)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'acquainted',
      ruleText: ACQUAINTED,
    });

    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(201);

    expect(res.body.run.status).toBe('completed');
    expect(res.body.run.ruleName).toBe('acquainted');
    expect(res.body.run.triggeredBy).toBe(ctx.userId);
    expect(res.body.run.finishedAt).toBeTruthy();
    expect(res.body.results.length).toBeGreaterThan(0);
    const r = res.body.results[0];
    expect(r.label).toBe('inferred'); // AC8: labelled inferred, not a claim
    expect(r.predicate).toBe('acquainted');
    expect(r.arguments[0]).toHaveProperty('name', 'a');
    expect(r.arguments[0]).toHaveProperty('entityName');
    expect(r.trace.claimIds.length).toBeGreaterThan(0); // AC6: source claims
    expect(r.trace.argumentIds.length).toBeGreaterThan(0); // AC6: source arguments
  });

  it('records the triggering user and persists the run (AC5)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'acquainted',
      ruleText: ACQUAINTED,
    });
    const run = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(201);

    const list = await ctx.agent.get(`/api/knowledge-bases/${KB}/rules/runs`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(run.body.run.id);
    expect(list.body[0].triggeredBy).toBe(ctx.userId);

    const detail = await ctx.agent
      .get(`/api/knowledge-bases/${KB}/rules/runs/${run.body.run.id}`)
      .expect(200);
    expect(detail.body.run.id).toBe(run.body.run.id);
    expect(detail.body.results.length).toBe(run.body.results.length);
  });

  it('refuses to run a rule that is not enabled (409)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'draft-rule',
      ruleText: ACQUAINTED,
      status: 'draft',
    });
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(409);
    expect(ctx.ruleRunStore.saved).toHaveLength(0);
  });

  it('refuses to run an invalid rule (422)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'broken',
      // Unsafe: head var ?b never appears in a positive body atom.
      ruleText: 'bad(?a, ?b) <- claim(?c, "attended"), arg(?c, "person", ?a).',
      status: 'enabled',
    });
    const res = await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(422);
    expect(res.body.validationErrors.length).toBeGreaterThan(0);
    expect(ctx.ruleRunStore.saved).toHaveLength(0);
  });

  it('returns 404 for an unknown rule', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${randomUUID()}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(404);
  });

  it('forbids viewers from running rules (403)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'acquainted',
      ruleText: ACQUAINTED,
    });
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(403);
  });

  it('requires CSRF to run a rule (403)', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'editor');
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'acquainted',
      ruleText: ACQUAINTED,
    });
    await ctx.agent.post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`).send({}).expect(403);
  });

  it('hides existence from non-members (404)', async () => {
    const rule = ctx.ruleStore.seed({
      knowledgeBaseId: KB,
      name: 'acquainted',
      ruleText: ACQUAINTED,
    });
    await ctx.agent.get(`/api/knowledge-bases/${KB}/rules/runs`).expect(404);
    await ctx.agent
      .post(`/api/knowledge-bases/${KB}/rules/${rule.id}/run`)
      .set('x-csrf-token', ctx.csrf)
      .send({})
      .expect(404);
  });

  it('lets viewers read runs', async () => {
    ctx.kbStore.setRole(KB, ctx.userId, 'viewer');
    const res = await ctx.agent.get(`/api/knowledge-bases/${KB}/rules/runs`).expect(200);
    expect(res.body).toEqual([]);
  });
});
