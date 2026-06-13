import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  auditEventSchema,
  kbMemberSchema,
  knowledgeBaseSchema,
  publicJobSchema,
  type KbRole,
} from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { AuditEventRow, JobRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { JobStore } from '../jobs/index.js';
import type {
  AssignRoleInput,
  CreateKnowledgeBaseInput,
  KbMemberRecord,
  KnowledgeBaseStore,
  KnowledgeBaseWithRole,
} from './store.js';

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

type MemoryKb = KnowledgeBaseWithRole;

/** In-memory KnowledgeBaseStore. Shares the auth store's user table. */
function createMemoryKbStore(authStore: AuthStore): KnowledgeBaseStore {
  interface KbRecord {
    id: string;
    name: string;
    description: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }
  const kbs = new Map<string, KbRecord>();
  const members = new Map<string, Map<string, { role: KbRole; createdAt: Date }>>();
  const audits: AuditEventRow[] = [];

  function record(
    knowledgeBaseId: string,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): void {
    audits.push({
      id: randomUUID(),
      knowledgeBaseId,
      actorUserId,
      action,
      targetType,
      targetId,
      metadata,
      createdAt: new Date(),
    });
  }

  function withRole(kb: KbRecord, role: KbRole): MemoryKb {
    return { ...kb, role };
  }

  return {
    createKnowledgeBase: (input: CreateKnowledgeBaseInput) => {
      const now = new Date();
      const kb: KbRecord = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      kbs.set(kb.id, kb);
      members.set(kb.id, new Map([[input.createdBy, { role: 'owner', createdAt: now }]]));
      record(kb.id, input.createdBy, 'knowledge_base.created', 'knowledge_base', kb.id, {
        name: kb.name,
      });
      record(kb.id, input.createdBy, 'knowledge_base.role_assigned', 'user', input.createdBy, {
        role: 'owner',
      });
      return Promise.resolve(withRole(kb, 'owner'));
    },
    listForUser: (userId) => {
      const out: MemoryKb[] = [];
      for (const [kbId, m] of members) {
        const entry = m.get(userId);
        const kb = kbs.get(kbId);
        if (entry && kb) out.push(withRole(kb, entry.role));
      }
      return Promise.resolve(out);
    },
    getForUser: (id, userId) => {
      const kb = kbs.get(id);
      const entry = members.get(id)?.get(userId);
      return Promise.resolve(kb && entry ? withRole(kb, entry.role) : undefined);
    },
    getRole: (knowledgeBaseId, userId) =>
      Promise.resolve(members.get(knowledgeBaseId)?.get(userId)?.role),
    listMembers: async (knowledgeBaseId) => {
      const out: KbMemberRecord[] = [];
      for (const [userId, entry] of members.get(knowledgeBaseId) ?? new Map()) {
        const user = await authStore.getUserById(userId);
        out.push({
          userId,
          email: user?.email ?? '',
          role: entry.role,
          createdAt: entry.createdAt,
        });
      }
      return out;
    },
    userExists: async (userId) => Boolean(await authStore.getUserById(userId)),
    assignRole: async (input: AssignRoleInput) => {
      const m = members.get(input.knowledgeBaseId);
      if (!m) throw new Error('kb not found');
      const existing = m.get(input.userId);
      const createdAt = existing?.createdAt ?? new Date();
      m.set(input.userId, { role: input.role, createdAt });
      record(
        input.knowledgeBaseId,
        input.actorUserId,
        'knowledge_base.role_assigned',
        'user',
        input.userId,
        {
          role: input.role,
        },
      );
      const user = await authStore.getUserById(input.userId);
      return { userId: input.userId, email: user?.email ?? '', role: input.role, createdAt };
    },
    listAuditEvents: (knowledgeBaseId) =>
      Promise.resolve(audits.filter((a) => a.knowledgeBaseId === knowledgeBaseId).reverse()),
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };

/** Setup an admin + an authenticated agent; returns the agent and CSRF token. */
async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, csrfToken: setup.body.csrfToken as string };
}

describe('knowledge bases: creation and listing', () => {
  let authStore: AuthStore;
  let kbStore: KnowledgeBaseStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore(authStore);
    app = createApp({ authStore, kbStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get('/api/knowledge-bases');
    expect(res.status).toBe(401);
  });

  it('creates a Knowledge Base and makes the creator owner', async () => {
    const { agent, csrfToken } = await setupAdminAgent(app);
    const res = await agent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'My KB', description: 'desc' });
    expect(res.status).toBe(201);
    const kb = knowledgeBaseSchema.parse(res.body);
    expect(kb.name).toBe('My KB');
    expect(kb.role).toBe('owner');

    const list = await agent.get('/api/knowledge-bases');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects creation without a CSRF token', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.post('/api/knowledge-bases').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid (empty name) Knowledge Base', async () => {
    const { agent, csrfToken } = await setupAdminAgent(app);
    const res = await agent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', csrfToken)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('records audit events for creation and the owner role assignment', async () => {
    const { agent, csrfToken } = await setupAdminAgent(app);
    const created = await agent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Audited KB' });
    const id = created.body.id as string;

    const res = await agent.get(`/api/knowledge-bases/${id}/audit`);
    expect(res.status).toBe(200);
    const events = res.body.map((e: unknown) => auditEventSchema.parse(e));
    const actions = events.map((e: { action: string }) => e.action);
    expect(actions).toContain('knowledge_base.created');
    expect(actions).toContain('knowledge_base.role_assigned');
  });
});

describe('knowledge bases: role-based access control', () => {
  let authStore: AuthStore;
  let kbStore: KnowledgeBaseStore;
  let app: ReturnType<typeof createApp>;
  let kbId: string;
  let ownerAgent: ReturnType<typeof request.agent>;
  let ownerCsrf: string;
  let viewerId: string;

  beforeEach(async () => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore(authStore);
    app = createApp({ authStore, kbStore });

    const setup = await setupAdminAgent(app);
    ownerAgent = setup.agent;
    ownerCsrf = setup.csrfToken;

    // Create a second account (member) to be added as a viewer.
    await ownerAgent
      .post('/api/auth/users')
      .set('x-csrf-token', ownerCsrf)
      .send({ email: 'viewer@example.com', password: 'viewerpass1', role: 'member' });
    const viewer = await authStore.getUserByEmail('viewer@example.com');
    viewerId = viewer?.id ?? '';

    const created = await ownerAgent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Shared KB' });
    kbId = created.body.id as string;
  });

  it('hides non-member Knowledge Bases as 404', async () => {
    const otherAgent = request.agent(app);
    await otherAgent
      .post('/api/auth/login')
      .send({ email: 'viewer@example.com', password: 'viewerpass1' });
    const res = await otherAgent.get(`/api/knowledge-bases/${kbId}`);
    expect(res.status).toBe(404);
  });

  it('lets an admin/owner assign a viewer role and the viewer can read', async () => {
    const assign = await ownerAgent
      .post(`/api/knowledge-bases/${kbId}/members`)
      .set('x-csrf-token', ownerCsrf)
      .send({ userId: viewerId, role: 'viewer' as KbRole });
    expect(assign.status).toBe(201);
    expect(kbMemberSchema.parse(assign.body).role).toBe('viewer');

    const viewerAgent = request.agent(app);
    const login = await viewerAgent
      .post('/api/auth/login')
      .send({ email: 'viewer@example.com', password: 'viewerpass1' });
    const viewerCsrf = login.body.csrfToken as string;

    const read = await viewerAgent.get(`/api/knowledge-bases/${kbId}`);
    expect(read.status).toBe(200);
    expect(knowledgeBaseSchema.parse(read.body).role).toBe('viewer');

    // Viewer cannot list members (needs admin) or assign roles.
    const members = await viewerAgent.get(`/api/knowledge-bases/${kbId}/members`);
    expect(members.status).toBe(403);

    const escalate = await viewerAgent
      .post(`/api/knowledge-bases/${kbId}/members`)
      .set('x-csrf-token', viewerCsrf)
      .send({ userId: viewerId, role: 'owner' });
    expect(escalate.status).toBe(403);
  });

  it('returns 404 when assigning a role to an unknown user', async () => {
    const res = await ownerAgent
      .post(`/api/knowledge-bases/${kbId}/members`)
      .set('x-csrf-token', ownerCsrf)
      .send({ userId: randomUUID(), role: 'editor' });
    expect(res.status).toBe(404);
  });

  it('requires CSRF for role assignment', async () => {
    const res = await ownerAgent
      .post(`/api/knowledge-bases/${kbId}/members`)
      .send({ userId: viewerId, role: 'editor' });
    expect(res.status).toBe(403);
  });
});

/** In-memory JobStore exposing only `list` (the KB jobs endpoint needs nothing else). */
function createMemoryJobStore(rows: JobRow[]): JobStore {
  const notImplemented = () => Promise.reject(new Error('not implemented'));
  return {
    enqueue: notImplemented,
    claimNext: notImplemented,
    markSucceeded: notImplemented,
    markForRetry: notImplemented,
    markFailed: notImplemented,
    getById: (id) => Promise.resolve(rows.find((r) => r.id === id)),
    list: (filter = {}) =>
      Promise.resolve(
        rows.filter((r) =>
          filter.knowledgeBaseId ? r.knowledgeBaseId === filter.knowledgeBaseId : true,
        ),
      ),
    countByStatus: notImplemented,
  };
}

function makeJob(knowledgeBaseId: string | null): JobRow {
  const now = new Date();
  return {
    id: randomUUID(),
    knowledgeBaseId,
    type: 'embedding.index',
    status: 'queued',
    attempts: 0,
    maxAttempts: 5,
    runAfter: now,
    payload: {},
    result: null,
    failureReason: null,
    ownerUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('knowledge bases: job status for admins/owners', () => {
  let authStore: AuthStore;
  let kbStore: KnowledgeBaseStore;
  let app: ReturnType<typeof createApp>;
  let kbId: string;
  let ownerAgent: ReturnType<typeof request.agent>;
  let ownerCsrf: string;
  let viewerId: string;

  let jobRows: JobRow[];

  beforeEach(async () => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore(authStore);
    jobRows = [];
    // `createMemoryJobStore.list` reads `jobRows` lazily, so we can seed jobs
    // after the KB is created while reusing the same app instance/agent.
    app = createApp({ authStore, kbStore, jobStore: createMemoryJobStore(jobRows) });

    const setup = await setupAdminAgent(app);
    ownerAgent = setup.agent;
    ownerCsrf = setup.csrfToken;

    await ownerAgent
      .post('/api/auth/users')
      .set('x-csrf-token', ownerCsrf)
      .send({ email: 'viewer@example.com', password: 'viewerpass1', role: 'member' });
    viewerId = (await authStore.getUserByEmail('viewer@example.com'))?.id ?? '';

    const created = await ownerAgent
      .post('/api/knowledge-bases')
      .set('x-csrf-token', ownerCsrf)
      .send({ name: 'Jobs KB' });
    kbId = created.body.id as string;

    // Seed one job in this KB and one in another KB to prove scoping.
    jobRows.push(makeJob(kbId), makeJob(randomUUID()));
  });

  it('lets an admin/owner inspect jobs scoped to their Knowledge Base', async () => {
    const res = await ownerAgent.get(`/api/knowledge-bases/${kbId}/jobs`);
    expect(res.status).toBe(200);
    const jobs = res.body.jobs.map((j: unknown) => publicJobSchema.parse(j));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].knowledgeBaseId).toBe(kbId);
  });

  it('forbids viewers from inspecting job status', async () => {
    await ownerAgent
      .post(`/api/knowledge-bases/${kbId}/members`)
      .set('x-csrf-token', ownerCsrf)
      .send({ userId: viewerId, role: 'viewer' as KbRole });

    const viewerAgent = request.agent(app);
    await viewerAgent
      .post('/api/auth/login')
      .send({ email: 'viewer@example.com', password: 'viewerpass1' });
    const res = await viewerAgent.get(`/api/knowledge-bases/${kbId}/jobs`);
    expect(res.status).toBe(403);
  });

  it('hides job status for non-members as 404', async () => {
    const otherAgent = request.agent(app);
    await otherAgent
      .post('/api/auth/login')
      .send({ email: 'viewer@example.com', password: 'viewerpass1' });
    const res = await otherAgent.get(`/api/knowledge-bases/${kbId}/jobs`);
    expect(res.status).toBe(404);
  });
});
