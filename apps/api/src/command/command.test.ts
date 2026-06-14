import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  commandResponseSchema,
  type AiPolicy,
  type CommandInterpretation,
  type KbRole,
  type SearchResult,
} from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { PolicyKey, AiPolicyStore } from '../ai-policy/store.js';
import type { SearchFilters, SearchStore } from '../search/store.js';
import type { CommandInterpreter } from './interpreter.js';

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

function createMemoryAiPolicyStore(): AiPolicyStore & {
  set(key: PolicyKey, policy: AiPolicy): void;
} {
  const byKey = new Map<string, AiPolicy>();
  const k = (key: PolicyKey) => `${key.scope}:${key.scopeId ?? ''}`;
  const store: AiPolicyStore & { set(key: PolicyKey, policy: AiPolicy): void } = {
    set(key, policy) {
      byKey.set(k(key), policy);
    },
    getPolicy: (key) =>
      Promise.resolve(byKey.get(k(key)) ?? { mode: 'off', remoteEmbeddings: false }),
    getPolicies: (keys) => Promise.all(keys.map((key) => store.getPolicy(key))),
    updatePolicy: () => Promise.reject(new Error('not supported in this fake')),
  };
  return store;
}

function createMemorySearchStore(): SearchStore & {
  calls: SearchFilters[];
  results: SearchResult[];
} {
  const state = {
    calls: [] as SearchFilters[],
    results: [] as SearchResult[],
    search(_kb: string, filters: SearchFilters) {
      state.calls.push(filters);
      return Promise.resolve(state.results);
    },
    getVectorSearchAvailability() {
      return Promise.resolve({ available: false, reason: 'No embeddings have been generated.' });
    },
  };
  return state;
}

/** Interpreter fake returning a fixed result; records each query. */
function fakeInterpreter(
  result: { interpretation: CommandInterpretation | null; repaired: boolean },
  overrides: Partial<CommandInterpreter> = {},
): CommandInterpreter & { queries: string[] } {
  const queries: string[] = [];
  return {
    name: 'Fake',
    providerKind: 'mock',
    model: 'fake',
    demo: false,
    verified: true,
    queries,
    interpret: (query: string) => {
      queries.push(query);
      return Promise.resolve(result);
    },
    ...overrides,
  } as CommandInterpreter & { queries: string[] };
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
const KB_ID = '11111111-1111-1111-1111-111111111111';
const LOCAL: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string };
}

function sampleResult(title = 'Ada Lovelace'): SearchResult {
  const now = new Date().toISOString();
  return {
    kind: 'entity',
    id: randomUUID(),
    knowledgeBaseId: KB_ID,
    title,
    snippet: null,
    type: 'Person',
    tags: [],
    confidence: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('command API (US-019)', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let searchStore: ReturnType<typeof createMemorySearchStore>;
  let aiPolicyStore: ReturnType<typeof createMemoryAiPolicyStore>;

  function buildApp(interpreter: CommandInterpreter | null) {
    return createApp({
      authStore,
      kbStore,
      searchStore,
      aiPolicyStore,
      commandInterpreter: interpreter,
    });
  }

  function allowLocalAi(userId: string) {
    aiPolicyStore.set({ scope: 'server', scopeId: null }, LOCAL);
    aiPolicyStore.set({ scope: 'user', scopeId: userId }, LOCAL);
    aiPolicyStore.set({ scope: 'knowledge_base', scopeId: KB_ID }, LOCAL);
  }

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    searchStore = createMemorySearchStore();
    aiPolicyStore = createMemoryAiPolicyStore();
  });

  it('requires authentication', async () => {
    const res = await request(buildApp(null))
      .post(`/api/knowledge-bases/${KB_ID}/command`)
      .send({ q: 'ada' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const app = buildApp(null);
    const { agent } = await setupAdminAgent(app);
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty query', async () => {
    const app = buildApp(null);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: '   ' });
    expect(res.status).toBe(400);
  });

  it('runs manual search with no AI configured (AC1)', async () => {
    const app = buildApp(null);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    expect(res.status).toBe(200);
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(false);
    expect(body.ai.attempted).toBe(false);
    expect(body.interpretation).toBeNull();
    expect(body.fallback.results).toHaveLength(1);
    expect(searchStore.calls[0]?.query).toBe('ada');
  });

  it('does not attempt AI when policy is off even if an interpreter exists', async () => {
    const interp = fakeInterpreter({
      interpretation: { intent: 'search', confidence: 0.9, filters: { q: 'ada' } },
      repaired: false,
    });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    // policy left at default (off)

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    expect(res.status).toBe(200);
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(false);
    expect(body.ai.reason).toMatch(/disabled/i);
    expect(interp.queries).toHaveLength(0);
  });

  it('returns a structured interpretation separate from fallback results (AC2/AC6)', async () => {
    const interp = fakeInterpreter({
      interpretation: { intent: 'search', confidence: 0.9, filters: { type: 'Person', q: 'ada' } },
      repaired: false,
    });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'find ada' });
    expect(res.status).toBe(200);
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(true);
    expect(body.ai.attempted).toBe(true);
    expect(body.interpretation?.intent).toBe('search');
    expect(body.interpretedResults).toHaveLength(1);
    expect(body.fallback.results).toHaveLength(1);
    // Two searches: interpreted filters + fallback token search.
    expect(searchStore.calls).toHaveLength(2);
    expect(searchStore.calls.some((c) => c.type === 'Person')).toBe(true);
  });

  it('reports a repair retry (AC4)', async () => {
    const interp = fakeInterpreter({
      interpretation: { intent: 'search', confidence: 0.9, filters: { q: 'ada' } },
      repaired: true,
    });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.repaired).toBe(true);
  });

  it('discards invalid AI output and falls back to search (AC3/AC5)', async () => {
    const interp = fakeInterpreter({ interpretation: null, repaired: false });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.attempted).toBe(true);
    expect(body.interpretation).toBeNull();
    expect(body.interpretedResults).toBeNull();
    expect(body.fallback.results).toHaveLength(1);
  });

  it('discards a low-confidence interpretation and falls back (AC5)', async () => {
    const interp = fakeInterpreter({
      interpretation: { intent: 'search', confidence: 0.1, filters: { q: 'ada' } },
      repaired: false,
    });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.lowConfidence).toBe(true);
    expect(body.interpretation).toBeNull();
  });

  it('continues with fallback when the interpreter throws', async () => {
    const interp = fakeInterpreter(
      { interpretation: null, repaired: false },
      { interpret: () => Promise.reject(new Error('model exploded')) },
    );
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'ada' });
    expect(res.status).toBe(200);
    const body = commandResponseSchema.parse(res.body);
    expect(body.ai.reason).toMatch(/exploded/);
    expect(body.fallback.results).toHaveLength(1);
  });

  it('returns a create interpretation without executing a second search', async () => {
    const interp = fakeInterpreter({
      interpretation: {
        intent: 'create',
        confidence: 0.9,
        changes: { items: [{ op: 'create_entity', ref: 'ada', type: 'Person', name: 'Ada' }] },
      },
      repaired: false,
    });
    const app = buildApp(interp);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/command`).send({ q: 'add Ada' });
    const body = commandResponseSchema.parse(res.body);
    expect(body.interpretation?.intent).toBe('create');
    expect(body.interpretedResults).toBeNull();
    // Only the fallback search ran.
    expect(searchStore.calls).toHaveLength(1);
  });
});
