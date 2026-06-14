import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  answerResponseSchema,
  type AiPolicy,
  type AnswerCitation,
  type KbRole,
  type SearchResult,
} from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { PolicyKey, AiPolicyStore } from '../ai-policy/store.js';
import type { SearchFilters, SearchStore } from '../search/store.js';
import type { AnswerEvidenceStore } from './evidence.js';
import type { AnswerGenerationResult, AnswerGenerator } from './answerer.js';

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

function createMemoryEvidenceStore(): AnswerEvidenceStore & { citations: AnswerCitation[] } {
  const state = {
    citations: [] as AnswerCitation[],
    gatherEvidence: () => Promise.resolve(state.citations),
  };
  return state;
}

/** Generator fake returning a fixed result; records each query. */
function fakeGenerator(
  result: AnswerGenerationResult,
  overrides: Partial<AnswerGenerator> = {},
): AnswerGenerator & { queries: string[] } {
  const queries: string[] = [];
  return {
    name: 'Fake',
    providerKind: 'mock',
    model: 'fake',
    demo: false,
    verified: true,
    queries,
    generate: (query: string) => {
      queries.push(query);
      return Promise.resolve(result);
    },
    ...overrides,
  } as AnswerGenerator & { queries: string[] };
}

const ADMIN = { email: 'admin@example.com', password: '[REDACTED:password] horse battery staple' };
const KB_ID = '22222222-2222-2222-2222-222222222222';
const LOCAL: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };
const REMOTE_PER_REQUEST: AiPolicy = { mode: 'remote_per_request', remoteEmbeddings: false };

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string };
}

function claimCitation(ref: number, overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    ref,
    kind: 'claim',
    id: randomUUID(),
    knowledgeBaseId: KB_ID,
    title: 'knows',
    snippet: null,
    predicate: 'knows',
    entities: [{ role: 'subject', entityId: randomUUID(), name: 'Ada' }],
    confidence: 0.9,
    provenance: { origin: 'manual' },
    ...overrides,
  };
}

function sampleResult(): SearchResult {
  const now = new Date().toISOString();
  return {
    kind: 'note',
    id: randomUUID(),
    knowledgeBaseId: KB_ID,
    title: 'A note',
    snippet: 'about ada',
    type: null,
    tags: [],
    confidence: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('answers API (US-020)', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let searchStore: ReturnType<typeof createMemorySearchStore>;
  let aiPolicyStore: ReturnType<typeof createMemoryAiPolicyStore>;
  let evidenceStore: ReturnType<typeof createMemoryEvidenceStore>;

  function buildApp(generator: AnswerGenerator | null) {
    return createApp({
      authStore,
      kbStore,
      searchStore,
      aiPolicyStore,
      answerEvidenceStore: evidenceStore,
      answerGenerator: generator,
    });
  }

  function allowLocalAi(userId: string) {
    aiPolicyStore.set({ scope: 'server', scopeId: null }, LOCAL);
    aiPolicyStore.set({ scope: 'user', scopeId: userId }, LOCAL);
    aiPolicyStore.set({ scope: 'knowledge_base', scopeId: KB_ID }, LOCAL);
  }

  function allowRemotePerRequest(userId: string) {
    aiPolicyStore.set({ scope: 'server', scopeId: null }, REMOTE_PER_REQUEST);
    aiPolicyStore.set({ scope: 'user', scopeId: userId }, REMOTE_PER_REQUEST);
    aiPolicyStore.set({ scope: 'knowledge_base', scopeId: KB_ID }, REMOTE_PER_REQUEST);
  }

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    searchStore = createMemorySearchStore();
    aiPolicyStore = createMemoryAiPolicyStore();
    evidenceStore = createMemoryEvidenceStore();
  });

  it('requires authentication', async () => {
    const res = await request(buildApp(null))
      .post(`/api/knowledge-bases/${KB_ID}/answers`)
      .send({ q: 'who?' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const app = buildApp(null);
    const { agent } = await setupAdminAgent(app);
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty question', async () => {
    const app = buildApp(null);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: '   ' });
    expect(res.status).toBe(400);
  });

  it('shows unavailable + manual search results with no AI configured (AC2)', async () => {
    const app = buildApp(null);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'ada' });
    expect(res.status).toBe(200);
    const body = answerResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(false);
    expect(body.ai.attempted).toBe(false);
    expect(body.answer).toBeNull();
    expect(body.citations).toHaveLength(0);
    expect(body.fallback.results).toHaveLength(1);
  });

  it('does not attempt AI when policy is off even with a generator', async () => {
    const gen = fakeGenerator({ answer: { summary: 's', statements: [] }, repaired: false });
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'ada' });
    const body = answerResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(false);
    expect(body.ai.attempted).toBe(false);
    expect(gen.queries).toHaveLength(0);
  });

  it('requires confirmation before a remote answer generation call', async () => {
    const gen = fakeGenerator(
      { answer: { summary: 's', statements: [] }, repaired: false },
      { providerKind: 'openai', model: 'gpt-test', verified: false },
    );
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowRemotePerRequest(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });

    expect(res.status).toBe(409);
    expect(res.body.confirmation).toEqual({
      provider: 'Fake',
      model: 'gpt-test',
      feature: 'AI answer generation',
      contentCategories: [
        'search_query',
        'graph_context',
        'entity_data',
        'claim_data',
        'note_text',
        'source_text',
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('who?');
    expect(gen.queries).toHaveLength(0);
  });

  it('generates a cited answer when AI is available (AC1/AC3)', async () => {
    evidenceStore.citations = [claimCitation(0)];
    const gen = fakeGenerator(
      {
        answer: {
          summary: 'Ada knows people.',
          statements: [{ text: 'Ada knows Charles.', factKind: 'known', citations: [0] }],
        },
        repaired: false,
      },
      { demo: true },
    );
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    const body = answerResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(true);
    expect(body.ai.attempted).toBe(true);
    expect(body.answer?.statements[0]?.factKind).toBe('known');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]?.predicate).toBe('knows');
    expect(body.citations[0]?.entities[0]?.name).toBe('Ada');
    expect(gen.queries).toEqual(['who?']);
  });

  it('drops statement citations that do not reference real evidence (AC1/AC3)', async () => {
    evidenceStore.citations = [claimCitation(0)];
    const gen = fakeGenerator({
      answer: {
        summary: 's',
        statements: [{ text: 'fabricated', factKind: 'known', citations: [0, 5, 9] }],
      },
      repaired: false,
    });
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    const body = answerResponseSchema.parse(res.body);
    expect(body.answer?.statements[0]?.citations).toEqual([0]);
  });

  it('falls back when the generator returns no answer', async () => {
    evidenceStore.citations = [claimCitation(0)];
    const gen = fakeGenerator({ answer: null, repaired: false });
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    const body = answerResponseSchema.parse(res.body);
    expect(body.ai.attempted).toBe(true);
    expect(body.answer).toBeNull();
    expect(body.fallback.results).toHaveLength(1);
  });

  it('falls back to manual search when the generator throws', async () => {
    evidenceStore.citations = [claimCitation(0)];
    const gen = fakeGenerator(
      { answer: null, repaired: false },
      {
        generate: () => Promise.reject(new Error('boom')),
      },
    );
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);
    searchStore.results = [sampleResult()];

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    const body = answerResponseSchema.parse(res.body);
    expect(body.answer).toBeNull();
    expect(body.citations).toHaveLength(0);
    expect(body.fallback.results).toHaveLength(1);
  });

  it('allows viewer generation when policy permits (AC6)', async () => {
    evidenceStore.citations = [];
    const gen = fakeGenerator({
      answer: { summary: 's', statements: [] },
      repaired: false,
    });
    const app = buildApp(gen);
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    allowLocalAi(userId);

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/answers`).send({ q: 'who?' });
    expect(res.status).toBe(200);
    const body = answerResponseSchema.parse(res.body);
    expect(body.ai.available).toBe(true);
  });
});
