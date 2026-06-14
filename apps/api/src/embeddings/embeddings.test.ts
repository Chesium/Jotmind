import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  DEFAULT_AI_POLICY,
  embeddingStatusSchema,
  type AiPolicy,
  type KbRole,
} from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { JobRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import type { JobStore } from '../jobs/store.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { EmbeddingKbStats, EmbeddingStore } from './store.js';

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

function memoryPolicyStore(policies: Partial<Record<string, AiPolicy>> = {}): AiPolicyStore {
  const get = (key: PolicyKey): AiPolicy => policies[key.scope] ?? { ...DEFAULT_AI_POLICY };
  return {
    getPolicy: (key) => Promise.resolve(get(key)),
    getPolicies: (keys) => Promise.resolve(keys.map(get)),
    updatePolicy: () => Promise.reject(new Error('not supported')),
  };
}

function memoryEmbeddingStore(stats: EmbeddingKbStats): EmbeddingStore {
  return {
    upsert: () => Promise.reject(new Error('not supported')),
    deleteByTarget: () => Promise.resolve(),
    getStats: () => Promise.resolve(stats),
    hasEmbeddings: () => Promise.resolve(stats.total > 0),
    vectorSearch: () => Promise.resolve([]),
  };
}

function memoryJobStore(): JobStore & { enqueued: Array<{ type: string; payload: unknown }> } {
  const enqueued: Array<{ type: string; payload: unknown }> = [];
  return {
    enqueued,
    enqueue: (input) => {
      enqueued.push({ type: input.type, payload: input.payload ?? {} });
      const now = new Date();
      const row: JobRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId ?? null,
        type: input.type,
        status: 'queued',
        payload: input.payload ?? {},
        result: {},
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAfter: input.runAfter ?? now,
        failureReason: null,
        ownerUserId: input.ownerUserId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      return Promise.resolve(row);
    },
    claimNext: () => Promise.resolve(undefined),
    markSucceeded: () => Promise.resolve(undefined),
    markForRetry: () => Promise.resolve(undefined),
    markFailed: () => Promise.resolve(undefined),
    getById: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    countByStatus: () =>
      Promise.resolve({ queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }),
  };
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
const KB_ID = '11111111-1111-1111-1111-111111111111';

const EMPTY_STATS: EmbeddingKbStats = {
  total: 0,
  counts: { entity: 0, claim: 0, note: 0, source: 0 },
  model: null,
  dimensions: null,
  lastIndexedAt: null,
};

const POPULATED_STATS: EmbeddingKbStats = {
  total: 3,
  counts: { entity: 2, claim: 1, note: 0, source: 0 },
  model: 'mock',
  dimensions: 8,
  lastIndexedAt: new Date(),
};

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string, csrf: setup.body.csrfToken as string };
}

function buildApp(opts: {
  stats?: EmbeddingKbStats;
  policies?: Partial<Record<string, AiPolicy>>;
}) {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const jobStore = memoryJobStore();
  const embeddingStore = memoryEmbeddingStore(opts.stats ?? EMPTY_STATS);
  const aiPolicyStore = memoryPolicyStore(opts.policies);
  // The embeddings router resolves its generation provider from the
  // AI_PROVIDER_CONFIG env var (the same seam as extraction/command/answers),
  // so provider-dependent status tests set/unset that env var. The store +
  // policy + job stores are injected here.
  const app = createApp({ authStore, kbStore, jobStore, embeddingStore, aiPolicyStore });
  return { app, kbStore, jobStore };
}

describe('embeddings API', () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    delete process.env.AI_PROVIDER_CONFIG;
    ctx = buildApp({ stats: EMPTY_STATS });
  });

  it('requires authentication for status', async () => {
    const res = await request(ctx.app).get(`/api/knowledge-bases/${KB_ID}/embeddings`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(ctx.app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/embeddings`);
    expect(res.status).toBe(404);
  });

  it('reports vector search unavailable + generation unavailable with no embeddings and no provider', async () => {
    const { agent, userId } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/embeddings`);
    expect(res.status).toBe(200);
    const status = embeddingStatusSchema.parse(res.body);
    expect(status.vectorSearchAvailable).toBe(false);
    expect(status.generationAvailable).toBe(false);
    expect(status.reason).toMatch(/no embedding provider/i);
    expect(status.total).toBe(0);
  });

  it('reports vector search available when embeddings exist even with no provider (AC4)', async () => {
    const populated = buildApp({ stats: POPULATED_STATS });
    const { agent, userId } = await setupAdminAgent(populated.app);
    populated.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/embeddings`);
    expect(res.status).toBe(200);
    const status = embeddingStatusSchema.parse(res.body);
    expect(status.vectorSearchAvailable).toBe(true);
    expect(status.generationAvailable).toBe(false);
    expect(status.total).toBe(3);
    expect(status.counts.entity).toBe(2);
    expect(status.model).toBe('mock');
  });

  it('reports generation available when a local provider is configured and policy permits', async () => {
    process.env.AI_PROVIDER_CONFIG = JSON.stringify({ kind: 'mock', name: 'Mock', dimensions: 8 });
    const app2 = buildApp({
      stats: EMPTY_STATS,
      policies: {
        server: { mode: 'local_only', remoteEmbeddings: false },
        knowledge_base: { mode: 'local_only', remoteEmbeddings: false },
        user: { mode: 'local_only', remoteEmbeddings: false },
      },
    });
    const { agent, userId } = await setupAdminAgent(app2.app);
    app2.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/embeddings`);
    expect(res.status).toBe(200);
    const status = embeddingStatusSchema.parse(res.body);
    expect(status.generationAvailable).toBe(true);
    expect(status.providerKind).toBe('mock');
    delete process.env.AI_PROVIDER_CONFIG;
  });

  it('rejects reindex without a CSRF token', async () => {
    const { agent, userId } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/embeddings/reindex`).send({});
    expect(res.status).toBe(403);
  });

  it('rejects reindex from a viewer (read-only)', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/embeddings/reindex`)
      .set('x-csrf-token', csrf)
      .send({});
    expect(res.status).toBe(403);
  });

  it('enqueues a reindex job for an editor with CSRF', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/embeddings/reindex`)
      .set('x-csrf-token', csrf)
      .send({ targetTypes: ['note'] });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('queued');
    expect(ctx.jobStore.enqueued[0]?.type).toBe('embeddings.index');
  });

  it('requires confirmation before enqueueing remote embedding reindex under per-request policy', async () => {
    process.env.AI_PROVIDER_CONFIG = JSON.stringify({
      kind: 'openai',
      name: 'Remote OpenAI',
      apiKey: 'test-key',
      llmModel: 'gpt-test',
      embeddingModel: 'embed-test',
    });
    const app2 = buildApp({
      stats: EMPTY_STATS,
      policies: {
        server: { mode: 'remote_per_request', remoteEmbeddings: true },
        knowledge_base: { mode: 'remote_per_request', remoteEmbeddings: true },
        user: { mode: 'remote_per_request', remoteEmbeddings: true },
      },
    });
    const { agent, userId, csrf } = await setupAdminAgent(app2.app);
    app2.kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/embeddings/reindex`)
      .set('x-csrf-token', csrf)
      .send({ targetTypes: ['note'] });

    expect(res.status).toBe(409);
    expect(res.body.confirmation).toEqual({
      provider: 'Remote OpenAI',
      model: 'embed-test',
      feature: 'Embedding reindex',
      contentCategories: ['note_text'],
    });
    expect(app2.jobStore.enqueued).toHaveLength(0);
    delete process.env.AI_PROVIDER_CONFIG;
  });
});
