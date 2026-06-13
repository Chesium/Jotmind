import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sourceExcerptViewSchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, SourceExcerptRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type {
  CreateSourceExcerptInput,
  DeleteSourceExcerptInput,
  ListSourceExcerptsFilter,
  SourceExcerptStore,
  SourceExcerptWithClaim,
  UpdateSourceExcerptInput,
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

/**
 * In-memory SourceExcerptStore that validates origins/claims against seeded ids
 * (mirrors the DB store's KB-scoped existence checks) and records audit events.
 */
function createMemoryExcerptStore(): SourceExcerptStore & {
  audits: { action: string; targetId: string }[];
  addNote(id: string): void;
  addSource(id: string): void;
  addClaim(id: string, predicate: string): void;
} {
  const byId = new Map<string, SourceExcerptWithClaim>();
  const notes = new Set<string>();
  const sources = new Set<string>();
  const claims = new Map<string, string>();
  const audits: { action: string; targetId: string }[] = [];

  return {
    audits,
    addNote: (id) => void notes.add(id),
    addSource: (id) => void sources.add(id),
    addClaim: (id, predicate) => void claims.set(id, predicate),
    listSourceExcerpts: (kb, filter: ListSourceExcerptsFilter = {}) =>
      Promise.resolve(
        [...byId.values()].filter(
          (e) =>
            e.knowledgeBaseId === kb &&
            e.deletedAt === null &&
            (!filter.noteId || e.noteId === filter.noteId) &&
            (!filter.sourceId || e.sourceId === filter.sourceId) &&
            (!filter.claimId || e.claimId === filter.claimId),
        ),
      ),
    getSourceExcerpt: (kb, id) => {
      const e = byId.get(id);
      return Promise.resolve(e && e.knowledgeBaseId === kb && e.deletedAt === null ? e : undefined);
    },
    createSourceExcerpt: (input: CreateSourceExcerptInput) => {
      if (input.noteId && !notes.has(input.noteId)) {
        return Promise.resolve({ ok: false as const, reason: 'note_not_found' as const });
      }
      if (input.sourceId && !sources.has(input.sourceId)) {
        return Promise.resolve({ ok: false as const, reason: 'source_not_found' as const });
      }
      if (input.claimId && !claims.has(input.claimId)) {
        return Promise.resolve({ ok: false as const, reason: 'claim_not_found' as const });
      }
      const now = new Date();
      const row: SourceExcerptRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        sourceId: input.sourceId ?? null,
        noteId: input.noteId ?? null,
        claimId: input.claimId ?? null,
        excerpt: input.excerpt ?? null,
        spanStart: input.spanStart ?? null,
        spanEnd: input.spanEnd ?? null,
        metadata: input.metadata ?? {},
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const view: SourceExcerptWithClaim = {
        ...row,
        claim: row.claimId ? { id: row.claimId, predicate: claims.get(row.claimId) ?? '' } : null,
      };
      byId.set(row.id, view);
      audits.push({ action: 'source_excerpt.created', targetId: row.id });
      return Promise.resolve({ ok: true as const, excerpt: view });
    },
    updateSourceExcerpt: (input: UpdateSourceExcerptInput) => {
      const e = byId.get(input.id);
      if (!e || e.knowledgeBaseId !== input.knowledgeBaseId || e.deletedAt !== null) {
        return Promise.resolve({ ok: false as const, reason: 'not_found' as const });
      }
      const f = input.fields;
      if (f.claimId !== undefined && f.claimId !== null && !claims.has(f.claimId)) {
        return Promise.resolve({ ok: false as const, reason: 'claim_not_found' as const });
      }
      if (f.claimId !== undefined) e.claimId = f.claimId;
      if (f.excerpt !== undefined) e.excerpt = f.excerpt;
      if (f.spanStart !== undefined) e.spanStart = f.spanStart;
      if (f.spanEnd !== undefined) e.spanEnd = f.spanEnd;
      if (f.metadata !== undefined) e.metadata = f.metadata;
      e.updatedAt = new Date();
      e.claim = e.claimId ? { id: e.claimId, predicate: claims.get(e.claimId) ?? '' } : null;
      audits.push({ action: 'source_excerpt.updated', targetId: e.id });
      return Promise.resolve({ ok: true as const, excerpt: e });
    },
    deleteSourceExcerpt: (input: DeleteSourceExcerptInput) => {
      const e = byId.get(input.id);
      if (!e || e.knowledgeBaseId !== input.knowledgeBaseId || e.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      e.deletedAt = new Date();
      e.updatedAt = new Date();
      audits.push({ action: 'source_excerpt.deleted', targetId: e.id });
      return Promise.resolve(e);
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const KB_ID = '11111111-1111-1111-1111-111111111111';
const NOTE_ID = '22222222-2222-2222-2222-222222222222';
const SOURCE_ID = '33333333-3333-3333-3333-333333333333';
const CLAIM_ID = '44444444-4444-4444-4444-444444444444';

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return {
    agent,
    csrfToken: setup.body.csrfToken as string,
    userId: setup.body.user.id as string,
  };
}

describe('source excerpts API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let excerptStore: ReturnType<typeof createMemoryExcerptStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    excerptStore = createMemoryExcerptStore();
    excerptStore.addNote(NOTE_ID);
    excerptStore.addSource(SOURCE_ID);
    excerptStore.addClaim(CLAIM_ID, 'authored');
    app = createApp({ authStore, kbStore, sourceExcerptStore: excerptStore });
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/source-excerpts`);
    expect(res.status).toBe(404);
  });

  it('lets an editor cite a span in a note and link a claim', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({
        noteId: NOTE_ID,
        claimId: CLAIM_ID,
        spanStart: 0,
        spanEnd: 12,
        excerpt: 'hello world',
      });
    expect(res.status).toBe(201);
    expect(sourceExcerptViewSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.noteId).toBe(NOTE_ID);
    expect(res.body.claim).toEqual({ id: CLAIM_ID, predicate: 'authored' });
    expect(excerptStore.audits).toEqual([
      { action: 'source_excerpt.created', targetId: res.body.id },
    ]);
  });

  it('rejects an excerpt with two origins', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ noteId: NOTE_ID, sourceId: SOURCE_ID, excerpt: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects an excerpt with no origin', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ excerpt: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects an excerpt with neither span nor excerpt text', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ noteId: NOTE_ID });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the origin note does not exist', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ noteId: '55555555-5555-5555-5555-555555555555', excerpt: 'x' });
    expect(res.status).toBe(404);
  });

  it('filters excerpts by source and exposes the linked claim for views', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ sourceId: SOURCE_ID, claimId: CLAIM_ID, excerpt: 'cited passage' });
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ noteId: NOTE_ID, excerpt: 'note passage' });

    const list = await agent.get(
      `/api/knowledge-bases/${KB_ID}/source-excerpts?sourceId=${SOURCE_ID}`,
    );
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].sourceId).toBe(SOURCE_ID);
    expect(list.body[0].claim).toEqual({ id: CLAIM_ID, predicate: 'authored' });
  });

  it('forbids viewers from creating excerpts but allows reads', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const create = await agent
      .post(`/api/knowledge-bases/${KB_ID}/source-excerpts`)
      .set('x-csrf-token', csrfToken)
      .send({ noteId: NOTE_ID, excerpt: 'x' });
    expect(create.status).toBe(403);
    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/source-excerpts`);
    expect(list.status).toBe(200);
  });
});
