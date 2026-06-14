import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_AI_POLICY, type AiPolicy, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/index.js';
import type { KnowledgeBaseWithRole } from '../kb/store.js';
import type { AiPolicyStore, PolicyKey, UpdatePolicyInput } from './store.js';

/** Minimal in-memory AuthStore (mirrors auth/auth.test.ts) for setup/login. */
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

/** Minimal in-memory KnowledgeBaseStore — only the bits the AI-policy router needs. */
function createMemoryKbStore(): KnowledgeBaseStore {
  const kbs = new Map<string, KnowledgeBaseWithRole>();
  const members = new Map<string, Map<string, KbRole>>();
  return {
    createKnowledgeBase: (input) => {
      const now = new Date();
      const kb: KnowledgeBaseWithRole = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? null,
        createdBy: input.createdBy,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
      };
      kbs.set(kb.id, kb);
      members.set(kb.id, new Map([[input.createdBy, 'owner']]));
      return Promise.resolve(kb);
    },
    listForUser: () => Promise.resolve([]),
    getForUser: (id, userId) => {
      const kb = kbs.get(id);
      const role = members.get(id)?.get(userId);
      return Promise.resolve(kb && role ? { ...kb, role } : undefined);
    },
    getRole: (kbId, userId) => Promise.resolve(members.get(kbId)?.get(userId)),
    listMembers: () => Promise.resolve([]),
    userExists: () => Promise.resolve(true),
    assignRole: (input) => {
      members.get(input.knowledgeBaseId)?.set(input.userId, input.role);
      return Promise.resolve({
        userId: input.userId,
        email: '',
        role: input.role,
        createdAt: new Date(),
      });
    },
    listAuditEvents: () => Promise.resolve([]),
    // Test helper escape hatch (not part of the interface).
    setRole: (kbId: string, userId: string, role: KbRole) => {
      members.get(kbId)?.set(userId, role);
    },
  } as KnowledgeBaseStore & { setRole(kbId: string, userId: string, role: KbRole): void };
}

/** In-memory AiPolicyStore. */
function createMemoryAiPolicyStore(): AiPolicyStore & { updates: UpdatePolicyInput[] } {
  const rows = new Map<string, AiPolicy>();
  const updates: UpdatePolicyInput[] = [];
  const keyOf = (k: PolicyKey) => `${k.scope}:${k.scopeId ?? ''}`;
  return {
    updates,
    getPolicy: (key) => Promise.resolve(rows.get(keyOf(key)) ?? { ...DEFAULT_AI_POLICY }),
    getPolicies: (keys) =>
      Promise.resolve(keys.map((k) => rows.get(keyOf(k)) ?? { ...DEFAULT_AI_POLICY })),
    updatePolicy: (input) => {
      updates.push(input);
      const prev = rows.get(keyOf(input)) ?? { ...DEFAULT_AI_POLICY };
      const next: AiPolicy = {
        mode: input.changes.mode ?? prev.mode,
        remoteEmbeddings: input.changes.remoteEmbeddings ?? prev.remoteEmbeddings,
      };
      rows.set(keyOf(input), next);
      return Promise.resolve(next);
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const MEMBER = { email: 'member@example.com', password: 'an0thersecret!' };

interface Harness {
  authStore: AuthStore;
  kbStore: KnowledgeBaseStore & { setRole(kbId: string, userId: string, role: KbRole): void };
  aiPolicyStore: AiPolicyStore & { updates: UpdatePolicyInput[] };
  app: ReturnType<typeof createApp>;
}

function makeHarness(): Harness {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore() as Harness['kbStore'];
  const aiPolicyStore = createMemoryAiPolicyStore();
  const app = createApp({ authStore, kbStore, aiPolicyStore });
  return { authStore, kbStore, aiPolicyStore, app };
}

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, csrfToken: setup.body.csrfToken as string };
}

describe('AI policy: server + user (US-016)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('requires authentication', async () => {
    expect((await request(h.app).get('/api/ai/policy/server')).status).toBe(401);
    expect((await request(h.app).get('/api/ai/policy/me')).status).toBe(401);
  });

  it('fresh install defaults to No AI (AC1)', async () => {
    const { agent } = await setupAdminAgent(h.app);
    const server = await agent.get('/api/ai/policy/server');
    expect(server.body).toEqual(DEFAULT_AI_POLICY);
    const me = await agent.get('/api/ai/policy/me');
    expect(me.body).toEqual(DEFAULT_AI_POLICY);
    const effective = await agent.get('/api/ai/policy');
    expect(effective.body.effective.mode).toBe('off');
    expect(effective.body.effective.remoteAllowed).toBe(false);
  });

  it('only system admins can set the server policy', async () => {
    const { agent, csrfToken } = await setupAdminAgent(h.app);
    // Create a non-admin member account.
    await agent
      .post('/api/auth/users')
      .set('x-csrf-token', csrfToken)
      .send({ ...MEMBER, role: 'member' });
    const memberAgent = request.agent(h.app);
    const login = await memberAgent.post('/api/auth/login').send(MEMBER);
    const memberCsrf = login.body.csrfToken as string;

    const forbidden = await memberAgent
      .put('/api/ai/policy/server')
      .set('x-csrf-token', memberCsrf)
      .send({ mode: 'remote_always' });
    expect(forbidden.status).toBe(403);

    const ok = await agent
      .put('/api/ai/policy/server')
      .set('x-csrf-token', csrfToken)
      .send({ mode: 'local_only' });
    expect(ok.status).toBe(200);
    expect(ok.body.mode).toBe('local_only');
  });

  it('requires CSRF for server policy mutation', async () => {
    const { agent } = await setupAdminAgent(h.app);
    const res = await agent.put('/api/ai/policy/server').send({ mode: 'local_only' });
    expect(res.status).toBe(403);
  });

  it('a user can set their own policy and it is recorded as a change', async () => {
    const { agent, csrfToken } = await setupAdminAgent(h.app);
    const res = await agent
      .put('/api/ai/policy/me')
      .set('x-csrf-token', csrfToken)
      .send({ mode: 'remote_per_request', remoteEmbeddings: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'remote_per_request', remoteEmbeddings: true });
    expect(h.aiPolicyStore.updates.some((u) => u.scope === 'user')).toBe(true);
  });

  it('rejects an empty policy update', async () => {
    const { agent, csrfToken } = await setupAdminAgent(h.app);
    const res = await agent.put('/api/ai/policy/me').set('x-csrf-token', csrfToken).send({});
    expect(res.status).toBe(400);
  });

  it('effective non-KB policy is the strictest of server and user (AC2)', async () => {
    const { agent, csrfToken } = await setupAdminAgent(h.app);
    await agent
      .put('/api/ai/policy/server')
      .set('x-csrf-token', csrfToken)
      .send({ mode: 'remote_always', remoteEmbeddings: true });
    await agent
      .put('/api/ai/policy/me')
      .set('x-csrf-token', csrfToken)
      .send({ mode: 'remote_per_request', remoteEmbeddings: true });
    const res = await agent.get('/api/ai/policy');
    expect(res.body.effective.mode).toBe('remote_per_request');
    expect(res.body.effective.requiresPerRequestConfirmation).toBe(true);
  });
});

describe('AI policy: Knowledge-Base scope (US-016)', () => {
  let h: Harness;
  let kbId: string;
  let adminAgent: ReturnType<typeof request.agent>;
  let adminCsrf: string;

  beforeEach(async () => {
    h = makeHarness();
    const setup = await setupAdminAgent(h.app);
    adminAgent = setup.agent;
    adminCsrf = setup.csrfToken;
    const kb = await adminAgent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'KB' });
    kbId = kb.body.id as string;
  });

  it('non-members get 404 (hide existence)', async () => {
    await adminAgent
      .post('/api/auth/users')
      .set('x-csrf-token', adminCsrf)
      .send({ ...MEMBER, role: 'member' });
    const memberAgent = request.agent(h.app);
    await memberAgent.post('/api/auth/login').send(MEMBER);
    const res = await memberAgent.get(`/api/knowledge-bases/${kbId}/ai/policy`);
    expect(res.status).toBe(404);
  });

  it('a viewer can read but not write the KB policy (AC2/AC3)', async () => {
    // Register a member and add as viewer.
    const created = await adminAgent
      .post('/api/auth/users')
      .set('x-csrf-token', adminCsrf)
      .send({ ...MEMBER, role: 'member' });
    h.kbStore.setRole(kbId, created.body.id as string, 'viewer');
    const memberAgent = request.agent(h.app);
    const login = await memberAgent.post('/api/auth/login').send(MEMBER);
    const memberCsrf = login.body.csrfToken as string;

    const read = await memberAgent.get(`/api/knowledge-bases/${kbId}/ai/policy`);
    expect(read.status).toBe(200);
    expect(read.body.policy).toEqual(DEFAULT_AI_POLICY);

    const write = await memberAgent
      .put(`/api/knowledge-bases/${kbId}/ai/policy`)
      .set('x-csrf-token', memberCsrf)
      .send({ mode: 'local_only' });
    expect(write.status).toBe(403);
  });

  it('an admin/owner can set the KB policy and effective folds in all layers', async () => {
    // Owner sets KB to remote_always but server stays off -> effective off.
    const res = await adminAgent
      .put(`/api/knowledge-bases/${kbId}/ai/policy`)
      .set('x-csrf-token', adminCsrf)
      .send({ mode: 'remote_always', remoteEmbeddings: true });
    expect(res.status).toBe(200);
    expect(res.body.policy.mode).toBe('remote_always');
    // Server + user still default to off -> strictest wins.
    expect(res.body.effective.mode).toBe('off');

    // Loosen server + user to remote_always too.
    await adminAgent
      .put('/api/ai/policy/server')
      .set('x-csrf-token', adminCsrf)
      .send({ mode: 'remote_always', remoteEmbeddings: true });
    await adminAgent
      .put('/api/ai/policy/me')
      .set('x-csrf-token', adminCsrf)
      .send({ mode: 'remote_always', remoteEmbeddings: true });
    const after = await adminAgent.get(`/api/knowledge-bases/${kbId}/ai/policy`);
    expect(after.body.effective.mode).toBe('remote_always');
    expect(after.body.effective.remoteEmbeddingsAllowed).toBe(true);
  });

  it('requires CSRF for KB policy mutation', async () => {
    const res = await adminAgent
      .put(`/api/knowledge-bases/${kbId}/ai/policy`)
      .send({ mode: 'local_only' });
    expect(res.status).toBe(403);
  });
});
