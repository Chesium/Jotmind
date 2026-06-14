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
import type {
  EntityRow,
  NoteRow,
  ProposalRow,
  SessionRow,
  SourceRow,
  UserRow,
} from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import type { NoteStore } from '../notes/store.js';
import type { SourceStore } from '../sources/store.js';
import type { EntityStore } from '../entities/store.js';
import type { ClaimStore, ClaimWithArguments, CreateClaimInput } from '../claims/store.js';
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

function createMemoryNoteStore(): NoteStore & { created: NoteRow[] } {
  const byId = new Map<string, NoteRow>();
  const created: NoteRow[] = [];
  return {
    created,
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
      created.push(row);
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
    updateProposalChanges: (input) => {
      const p = byId.get(input.id);
      if (!p || p.knowledgeBaseId !== input.knowledgeBaseId || p.status !== 'pending') {
        return Promise.resolve(undefined);
      }
      const updated: ProposalRow = { ...p, changes: input.changes, updatedAt: new Date() };
      byId.set(updated.id, updated);
      audits.push('proposal.updated');
      return Promise.resolve(updated);
    },
    reviewProposal: (input) => {
      const p = byId.get(input.id);
      if (!p || p.knowledgeBaseId !== input.knowledgeBaseId || p.status !== 'pending') {
        return Promise.resolve(undefined);
      }
      const now = new Date();
      const updated: ProposalRow = {
        ...p,
        status: input.status,
        reviewReason: input.reviewReason ?? null,
        reviewedBy: input.actorUserId,
        reviewedAt: now,
        updatedAt: now,
      };
      byId.set(updated.id, updated);
      audits.push(`proposal.${input.status}`);
      return Promise.resolve(updated);
    },
  };
}

function createMemoryEntityStore(): EntityStore & { created: EntityRow[] } {
  const byId = new Map<string, EntityRow>();
  const created: EntityRow[] = [];
  const store: EntityStore & { created: EntityRow[] } = {
    created,
    listEntities: (kb) =>
      Promise.resolve([...byId.values()].filter((e) => e.knowledgeBaseId === kb)),
    getEntity: (kb, id) => {
      const e = byId.get(id);
      return Promise.resolve(e && e.knowledgeBaseId === kb && e.deletedAt === null ? e : undefined);
    },
    createEntity: (input) => {
      const now = new Date();
      const row: EntityRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        type: input.type,
        name: input.name,
        aliases: input.aliases ?? [],
        description: input.description ?? null,
        tags: input.tags ?? [],
        properties: input.properties ?? {},
        schemaVersionId: input.schemaVersionId ?? null,
        mergedIntoId: null,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      created.push(row);
      return Promise.resolve(row);
    },
    updateEntity: () => Promise.resolve(undefined),
    deleteEntity: () => Promise.resolve(undefined),
    mergeEntities: () => Promise.resolve({ ok: false, reason: 'source_not_found' }),
    getEntityImpact: () => Promise.resolve(undefined),
  };
  return store;
}

function createMemoryClaimStore(): ClaimStore & { created: CreateClaimInput[] } {
  const created: CreateClaimInput[] = [];
  const store: ClaimStore & { created: CreateClaimInput[] } = {
    created,
    listClaims: () => Promise.resolve([]),
    getClaim: () => Promise.resolve(undefined),
    createClaim: (input) => {
      created.push(input);
      const now = new Date();
      const claim: ClaimWithArguments = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        predicate: input.predicate,
        description: input.description ?? null,
        confidence: input.confidence ?? null,
        validStart: input.validStart ? new Date(input.validStart) : null,
        validEnd: input.validEnd ? new Date(input.validEnd) : null,
        properties: input.properties ?? {},
        provenance: input.provenance ?? {},
        schemaVersionId: input.schemaVersionId ?? null,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        arguments: [],
      };
      return Promise.resolve(claim);
    },
    updateClaim: () => Promise.resolve(undefined),
    deleteClaim: () => Promise.resolve(undefined),
  };
  return store;
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
const REMOTE_PER_REQUEST: AiPolicy = { mode: 'remote_per_request', remoteEmbeddings: false };

interface Harness {
  authStore: AuthStore;
  kbStore: ReturnType<typeof createMemoryKbStore>;
  aiPolicyStore: ReturnType<typeof createMemoryAiPolicyStore>;
  proposalStore: ReturnType<typeof createMemoryProposalStore>;
  noteStore: NoteStore & { created: NoteRow[] };
  sourceStore: SourceStore;
  entityStore: ReturnType<typeof createMemoryEntityStore>;
  claimStore: ReturnType<typeof createMemoryClaimStore>;
}

function makeApp(h: Harness, extractor: GraphExtractor | null) {
  return createApp({
    authStore: h.authStore,
    kbStore: h.kbStore,
    aiPolicyStore: h.aiPolicyStore,
    proposalStore: h.proposalStore,
    noteStore: h.noteStore,
    sourceStore: h.sourceStore,
    entityStore: h.entityStore,
    claimStore: h.claimStore,
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
      entityStore: createMemoryEntityStore(),
      claimStore: createMemoryClaimStore(),
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

  it('requires confirmation before remote quick-capture extraction and does not store yet', async () => {
    const app = makeApp(
      h,
      fakeExtractor({ providerKind: 'openai', model: 'gpt-test', verified: false }),
    );
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    allowAi(h, userId, REMOTE_PER_REQUEST);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/capture`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'note', content: 'Ada met Charles.' });

    expect(res.status).toBe(409);
    expect(res.body.confirmation).toEqual({
      provider: 'Fake',
      model: 'gpt-test',
      feature: 'Quick capture extraction',
      contentCategories: ['note_text'],
    });
    expect(JSON.stringify(res.body)).not.toContain('Ada met Charles');
    expect(h.noteStore.created).toHaveLength(0);
    expect(h.proposalStore.audits).toHaveLength(0);
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

  // --- Review actions (US-018) ---------------------------------------------

  /** Seed a pending proposal with one entity + one claim referencing it. */
  async function seedProposal(userId: string) {
    const changes = {
      items: [
        { op: 'create_entity' as const, ref: 'ada', type: 'Person', name: 'Ada Lovelace' },
        {
          op: 'create_claim' as const,
          predicate: 'knows',
          confidence: 0.9,
          arguments: [
            { role: 'subject', kind: 'entity' as const, ref: 'ada' },
            { role: 'topic', kind: 'literal' as const, value: 'mathematics' },
          ],
        },
      ],
    };
    return h.proposalStore.createProposal({
      knowledgeBaseId: KB_ID,
      kind: 'extraction',
      changes,
      sourceNoteId: '22222222-2222-2222-2222-222222222222',
      sourceSourceId: null,
      provider: 'mock',
      model: 'demo',
      metadata: {},
      actorUserId: userId,
    });
  }

  it('accepts a proposal, creating entities and claims with provenance (AC2/AC3)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({ note: 'looks good' });

    expect(res.status).toBe(201);
    expect(res.body.proposal.status).toBe('accepted');
    expect(res.body.createdEntityIds).toHaveLength(1);
    expect(res.body.createdClaimIds).toHaveLength(1);
    expect(h.entityStore.created).toHaveLength(1);
    expect(h.claimStore.created).toHaveLength(1);

    const claim = h.claimStore.created[0];
    expect(claim?.confidence).toBe(0.9);
    expect(claim?.provenance?.origin).toBe('ai_proposal');
    expect(claim?.provenance?.provider).toBe('mock');
    expect(claim?.provenance?.sourceNoteId).toBe('22222222-2222-2222-2222-222222222222');
    expect(claim?.provenance?.acceptedBy).toBe(userId);
    expect(claim?.provenance?.confirmationNote).toBe('looks good');
    // The claim's entity argument resolves to the newly created entity id.
    const entityId = h.entityStore.created[0]?.id;
    const arg = claim?.arguments.find((a) => a.argumentKind === 'entity');
    expect(arg?.entityId).toBe(entityId);
    expect(h.proposalStore.audits).toContain('proposal.accepted');
  });

  it('accepts only selected items at the item level (AC2)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    // Apply only the entity item (index 0); skip the claim.
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({ itemIndexes: [0] });

    expect(res.status).toBe(201);
    expect(res.body.createdEntityIds).toHaveLength(1);
    expect(res.body.createdClaimIds).toHaveLength(0);
    expect(h.claimStore.created).toHaveLength(0);
  });

  it('accepts an import proposal, creating notes and sources (US-031)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await h.proposalStore.createProposal({
      knowledgeBaseId: KB_ID,
      kind: 'import',
      changes: {
        items: [
          { op: 'create_note', title: 'Imported note', content: 'note body' },
          { op: 'create_source', title: 'Imported source', sourceType: 'article', content: 'src' },
        ],
      },
      sourceNoteId: null,
      sourceSourceId: null,
      provider: null,
      model: null,
      metadata: { source: 'import' },
      actorUserId: userId,
    });

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.proposal.status).toBe('accepted');
    expect(res.body.createdNoteIds).toHaveLength(1);
    expect(res.body.createdSourceIds).toHaveLength(1);
    expect(res.body.createdEntityIds).toHaveLength(0);
    const notes = await h.noteStore.listNotes(KB_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe('note body');
    const sources = await h.sourceStore.listSources(KB_ID);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe('Imported source');
  });

  it('rejects out-of-range item indexes', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({ itemIndexes: [5] });
    expect(res.status).toBe(400);
  });

  it('cannot apply a claim whose entity ref does not resolve (AC4)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await h.proposalStore.createProposal({
      knowledgeBaseId: KB_ID,
      kind: 'extraction',
      changes: {
        items: [
          {
            op: 'create_claim',
            predicate: 'knows',
            arguments: [{ role: 'subject', kind: 'entity', ref: 'missing-ref' }],
          },
        ],
      },
      actorUserId: userId,
    });

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(422);
    expect(h.claimStore.created).toHaveLength(0);
  });

  it('rejects a proposal and keeps it linked to its source (AC2)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/reject`)
      .set('x-csrf-token', csrfToken)
      .send({ reason: 'not useful' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reviewReason).toBe('not useful');
    expect(res.body.sourceNoteId).toBe('22222222-2222-2222-2222-222222222222');
    expect(h.proposalStore.audits).toContain('proposal.rejected');
  });

  it('edits a pending proposal before accepting (AC2)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}`)
      .set('x-csrf-token', csrfToken)
      .send({
        changes: {
          items: [{ op: 'create_entity', ref: 'x', type: 'Concept', name: 'Edited' }],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.changes.items).toHaveLength(1);
    expect(res.body.changes.items[0].name).toBe('Edited');
    expect(h.proposalStore.audits).toContain('proposal.updated');
  });

  it('rejects an invalid edit payload (AC4)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ changes: { items: [{ op: 'create_entity', ref: 'x' }] } });
    expect(res.status).toBe(400);
  });

  it('forbids viewers from accepting/rejecting/editing (AC5)', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'viewer');
    const proposal = await seedProposal(userId);

    const accept = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(accept.status).toBe(403);

    const reject = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/reject`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(reject.status).toBe(403);
  });

  it('requires CSRF to accept', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 404 accepting an unknown proposal', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/33333333-3333-3333-3333-333333333333/accept`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(404);
  });

  it('cannot accept an already-reviewed proposal', async () => {
    const app = makeApp(h, fakeExtractor());
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    h.kbStore.setRole(KB_ID, userId, 'editor');
    const proposal = await seedProposal(userId);
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/reject`)
      .set('x-csrf-token', csrfToken)
      .send({});

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/proposals/${proposal.id}/accept`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(409);
  });
});
