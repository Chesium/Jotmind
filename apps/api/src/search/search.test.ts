import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { searchResponseSchema, type KbRole, type SearchResult } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { SearchFilters, SearchStore } from './store.js';

/** Minimal in-memory AuthStore for setup/login (mirrors entities.test.ts). */
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

/** In-memory SearchStore that records the filters it was called with. */
function createMemorySearchStore(): SearchStore & {
  lastFilters?: SearchFilters;
  results: SearchResult[];
  vectorAvailable: boolean;
} {
  const state = {
    lastFilters: undefined as SearchFilters | undefined,
    results: [] as SearchResult[],
    vectorAvailable: false,
    search(_kb: string, filters: SearchFilters) {
      state.lastFilters = filters;
      return Promise.resolve(state.results);
    },
    getVectorSearchAvailability() {
      return Promise.resolve(
        state.vectorAvailable
          ? { available: true, reason: null }
          : {
              available: false,
              reason: 'No embeddings have been generated; semantic search is unavailable.',
            },
      );
    },
  };
  return state;
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
const KB_ID = '11111111-1111-1111-1111-111111111111';

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string };
}

function sampleResult(): SearchResult {
  const now = new Date().toISOString();
  return {
    kind: 'entity',
    id: randomUUID(),
    knowledgeBaseId: KB_ID,
    title: 'Ada Lovelace',
    snippet: 'Mathematician',
    type: 'Person',
    tags: ['pioneer'],
    confidence: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('search API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let searchStore: ReturnType<typeof createMemorySearchStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    searchStore = createMemorySearchStore();
    app = createApp({ authStore, kbStore, searchStore });
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/search?q=ada`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/search?q=ada`);
    expect(res.status).toBe(404);
  });

  it('lets a viewer search and reports vector search as unavailable', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    searchStore.results = [sampleResult()];

    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/search?q=ada`);
    expect(res.status).toBe(200);
    const parsed = searchResponseSchema.parse(res.body);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.vectorSearch.available).toBe(false);
    expect(parsed.vectorSearch.reason).toMatch(/embeddings/i);
    expect(searchStore.lastFilters?.query).toBe('ada');
  });

  it('parses structured filters into the store call', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent.get(
      `/api/knowledge-bases/${KB_ID}/search?q=who&kinds=claim,note&predicate=knows&confidenceMin=0.2&confidenceMax=0.9&hasProvenance=true&limit=10`,
    );
    expect(res.status).toBe(200);
    expect(searchStore.lastFilters).toMatchObject({
      query: 'who',
      kinds: ['claim', 'note'],
      predicate: 'knows',
      confidenceMin: 0.2,
      confidenceMax: 0.9,
      hasProvenance: true,
      limit: 10,
    });
  });

  it('parses entity type and tag filters and a date range', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const res = await agent.get(
      `/api/knowledge-bases/${KB_ID}/search?type=Place&tag=city&dateFrom=2020-01-01T00:00:00.000Z&dateTo=2025-01-01T00:00:00.000Z`,
    );
    expect(res.status).toBe(200);
    expect(searchStore.lastFilters?.type).toBe('Place');
    expect(searchStore.lastFilters?.tag).toBe('city');
    expect(searchStore.lastFilters?.dateFrom?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(searchStore.lastFilters?.dateTo?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('rejects an invalid confidence range', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const res = await agent.get(
      `/api/knowledge-bases/${KB_ID}/search?confidenceMin=0.9&confidenceMax=0.1`,
    );
    expect(res.status).toBe(400);
  });

  it('allows an empty query (filters-only / browse all)', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/search`);
    expect(res.status).toBe(200);
    expect(searchStore.lastFilters?.query).toBeUndefined();
  });
});
