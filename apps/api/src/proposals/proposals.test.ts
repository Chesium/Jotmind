import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  DEFAULT_AI_POLICY,
  proposalSchema,
  type AiPolicy,
  type KbRole,
  type ProposalChange,
} from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { NoteRow, ProposalRow, SessionRow, SourceRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import type { NoteStore } from '../notes/store.js';
import type { SourceStore } from '../sources/store.js';
import type { GraphExtractor } from '../extraction/index.js';
import type { CreateProposalInput, ListProposalsFilter, ProposalStore } from './store.js';

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
    getPolicy: (key) => Promise.resolve(byKey.get(k(key)) ?? { ...DEFAULT_AI_POLICY }),
    getPolicies: (keys) => Promise.all(keys.map((key) => store.getPolicy(key))),
    updatePolicy: () => Promise.reject(new Error('not supported in this fake')),
  };
  return store;
}

function createMemoryNoteStore(): NoteStore {
  const byId = new Map<string, NoteRow>();
  return {
    listNotes: (kb) => Promise.resolve([...byId.values()].filter((n) => n.knowledgeBaseId === kb)),
    getNote: (kb, id) => {
      const n = byId.get(id);
      return Promise.resolve(n && n.knowledgeBaseId === kb ? n : undefined);
    },
    createNote: (input) => {
      const now = new Date();
      const row: NoteRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        title: input.title ?? null,
        content: input.content,
        properties: input.properties ?? {},
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      return Promise.resolve(row);
    },
    updateNote: () => Promise.resolve(undefined),
    deleteNote: () => Promise.resolve(undefined),
  };
}

function createMemorySourceStore(): SourceStore {
  const byId = new Map<string, SourceRow>();
  return {
    listSources: (kb) =>
      Promise.resolve([...byId.values()].filter((s) => s.knowledgeBaseId === kb)),
    getSource: (kb, id) => {
      const s = byId.get(id);
      return Promise.resolve(s && s.knowledgeBaseId === kb ? s : undefined);
    },
    createSource: (input) => {
      const now = new Date();
      const row: SourceRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        title: input.title,
        sourceType: input.sourceType ?? null,
        uri: input.uri ?? null,
        content: input.content ?? null,
        metadata: input.metadata ?? {},
        properties: input.properties ?? {},
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      return Promise.resolve(row);
    },
    updateSource: () => Promise.resolve(undefined),
    deleteSource: () => Promise.resolve(undefined),
  };
}

function createMemoryProposalStore(): ProposalStore & { audits: string[] } {
  const byId = new Map<string, ProposalRow>();
  const audits: string[] = [];
  return {
    audits,
    listProposals: (kb, filter?: ListProposalsFilter) =>
      Promise.resolve(
        [...byId.values()]
          .filter((p) => p.knowledgeBaseId === kb && p.deletedAt === null)
          .filter((p) => (filter?.status ? p.status === filter.status : true))
          .filter((p) => (filter?.sourceNoteId ? p.sourceNoteId === filter.sourceNoteId : true)),
      ),
    getProposal: (kb, id) => {
      const p = byId.get(id);
      return Promise.resolve(p && p.knowledgeBaseId === kb && p.deletedAt === null ? p : undefined);
    },
    createProposal: (input: CreateProposalInput) => {
      const now = new Date();
      const row: ProposalRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        kind: input.kind,
        status: 'pending',
        changes: input.changes,
        sourceNoteId: input.sourceNoteId ?? null,
        sourceSourceId: input.sourceSourceId ?? null,
        sourceExcerptId: input.sourceExcerptId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        metadata: input.metadata ?? {},
        reviewReason: null,
        createdBy: input.actorUserId,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      audits.push('proposal.created');
      return Promise.resolve(row);
    },
  };
}

const STATIC_CHANGES: ProposalChange[] = [
  { op: 'create_entity', ref: 'ada', type: 'Person', name: 'Ada' },
];

function fakeExtractor(overrides: Partial<GraphExtractor> = {}): GraphExtractor {
  return {
    name: 'Fake',
    providerKind: 'mock',
    model: 'fake',
    demo: false,
    verified: true,
    extract: () => Promise.resolve(STATIC_CHANGES),
    ...overrides,
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const KB_ID = '11111111-1111-1111-1111-111111111111';

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return {
    agent,
    csrfToken: setup.body.csrfToken as string,
    userId: setup.body.user.id as string,
  };
}

/** Set all three policy layers (server/user/KB) to the same mode. Because the
 * effective policy is strictest-wins (US-016), every layer must permit AI. */
function allowAi(h: Harness, userId: string, policy: AiPolicy): void {
  h.aiPolicyStore.set({ scope: 'server', scopeId: null }, policy);
  h.aiPolicyStore.set({ scope: 'user', scopeId: userId }, policy);
  h.aiPolicyStore.set({ scope: 'knowledge_base', scopeId: KB_ID }, policy);
}

const LOCAL_ONLY: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };

interface Harness {
  authStore: AuthStore;
  kbStore: ReturnType<typeof createMemoryKbStore>;
  aiPolicyStore: ReturnType<typeof createMemoryAiPolicyStore>;
  proposalStore: ReturnType<typeof createMemoryProposalStore>;
  noteStore: NoteStore;
  sourceStore: SourceStore;
}

function makeApp(h: Harness, extractor: GraphExtractor | null) {
  return createApp({
    authStore: h.authStore,
    kbStore: h.kbStore,
    aiPolicyStore: h.aiPolicyStore,
    proposalStore: h.proposalStore,
    noteStore: h.noteStore,
    sourceStore: h.sourceStore,
    extractor,
  });
}

describe('proposals + capture API', () => {
  let h: Harness;

  beforeEach(() => {
    h = {
      authStore: createMemoryAuthStore(),
      kbStore: createMemoryKbStore(),
      aiPolicyStore: createMemoryAiPolicyStore(),
      proposalStore: createMemoryProposalStore(),
      noteStore: createMemoryNoteStore(),
      sourceStore: createMemorySourceStore(),
    };
  });

  it('requires authentication to list proposals', async () => {
    const app = makeApp(h, null);
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/proposals`);
    expect(res.status).toBe(401);
  });

  it('returns 404 listing proposals for non-members', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/proposals`);
    expect(res.status).toBe(404);
  });

  it('stores a note and creates a proposal when AI is available (AC1/AC2)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'note', content: 'Ada met Charles.' });

    expect(res.status).toBe(201);
    expect(res.body.note.content).toBe('Ada met Charles.');
    expect(res.body.extraction.status).toBe('created');
    expect(res.body.extraction.availability.available).toBe(true);
    expect(proposalSchema.parse(res.body.extraction.proposal)).toEqual(
      res.body.extraction.proposal,
    );
    expect(res.body.extraction.proposal.sourceNoteId).toBe(res.body.note.id);
    expect(h.proposalStore.audits).toContain('proposal.created');
  });

  it('stores the note but skips extraction with no AI (AC4)', async () => {
    const app = makeApp(h, null);
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'note', content: 'Some thought.' });

    expect(res.status).toBe(201);
    expect(res.body.note.content).toBe('Some thought.');
    expect(res.body.extraction.status).toBe('unavailable');
    expect(res.body.extraction.availability.available).toBe(false);
    expect(res.body.extraction.proposal).toBeNull();
  });

  it('is unavailable when policy is off even with an extractor (AC4)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    h.aiPolicyStore.set(
      { scope: 'server', scopeId: null },
      { mode: 'off', remoteEmbeddings: false },
    );

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'x' });

    expect(res.body.extraction.status).toBe('unavailable');
    expect(res.body.extraction.availability.reason).toMatch(/disabled/i);
  });

  it('blocks a remote extractor when policy disallows remote (AC3)', async () => {
    const app = makeApp(h, fakeExtractor({ providerKind: 'openai', verified: false }));
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'x' });

    expect(res.body.extraction.status).toBe('unavailable');
    expect(res.body.extraction.availability.reason).toMatch(/remote/i);
    expect(res.body.extraction.availability.verified).toBe(false);
  });

  it('labels demo extractor output (AC6)', async () => {
    const app = makeApp(h, fakeExtractor({ demo: true }));
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'Ada met Charles.' });

    expect(res.body.extraction.availability.demo).toBe(true);
    expect(res.body.extraction.availability.label).toBe('Mock AI / deterministic demo output');
    expect(res.body.extraction.proposal.metadata.demo).toBe(true);
  });

  it('reports empty extraction without creating a proposal', async () => {
    const app = makeApp(h, fakeExtractor({ extract: () => Promise.resolve([]) }));
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'nothing notable' });

    expect(res.body.extraction.status).toBe('empty');
    expect(res.body.extraction.proposal).toBeNull();
  });

  it('reports an error but keeps the stored note when extraction throws', async () => {
    const app = makeApp(h, fakeExtractor({ extract: () => Promise.reject(new Error('boom')) }));
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'Ada met Charles.' });

    expect(res.status).toBe(201);
    expect(res.body.note).not.toBeNull();
    expect(res.body.extraction.status).toBe('error');
    expect(res.body.extraction.proposal).toBeNull();
  });

  it('forbids viewers from capturing (read-only)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'x' });
    expect(res.status).toBe(403);
  });

  it('requires CSRF to capture', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/capture`).send({ content: 'x' });
    expect(res.status).toBe(403);
  });

  it('lists created proposals for a viewer', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, LOCAL_ONLY);
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'Ada met Charles.' });

    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/proposals?status=pending`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('pending');
  });
});
