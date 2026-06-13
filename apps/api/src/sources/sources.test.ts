import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sourceSchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, SourceRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type {
  CreateSourceInput,
  DeleteSourceInput,
  SourceStore,
  UpdateSourceInput,
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

interface SideEffect {
  action: string;
  targetId: string;
}

function createMemorySourceStore(): SourceStore & { audits: SideEffect[]; outbox: SideEffect[] } {
  const byId = new Map<string, SourceRow>();
  const audits: SideEffect[] = [];
  const outbox: SideEffect[] = [];
  return {
    audits,
    outbox,
    listSources: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((s) => s.knowledgeBaseId === kb && s.deletedAt === null),
      ),
    getSource: (kb, id) => {
      const s = byId.get(id);
      return Promise.resolve(s && s.knowledgeBaseId === kb && s.deletedAt === null ? s : undefined);
    },
    createSource: (input: CreateSourceInput) => {
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
      outbox.push({ action: 'source.created', targetId: row.id });
      audits.push({ action: 'source.created', targetId: row.id });
      return Promise.resolve(row);
    },
    updateSource: (input: UpdateSourceInput) => {
      const s = byId.get(input.id);
      if (!s || s.knowledgeBaseId !== input.knowledgeBaseId || s.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      const f = input.fields;
      if (f.title !== undefined) s.title = f.title;
      if (f.sourceType !== undefined) s.sourceType = f.sourceType;
      if (f.uri !== undefined) s.uri = f.uri;
      if (f.content !== undefined) s.content = f.content;
      if (f.metadata !== undefined) s.metadata = f.metadata;
      if (f.properties !== undefined) s.properties = f.properties;
      s.updatedAt = new Date();
      outbox.push({ action: 'source.updated', targetId: s.id });
      audits.push({ action: 'source.updated', targetId: s.id });
      return Promise.resolve(s);
    },
    deleteSource: (input: DeleteSourceInput) => {
      const s = byId.get(input.id);
      if (!s || s.knowledgeBaseId !== input.knowledgeBaseId || s.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      s.deletedAt = new Date();
      s.updatedAt = new Date();
      outbox.push({ action: 'source.deleted', targetId: s.id });
      audits.push({ action: 'source.deleted', targetId: s.id });
      return Promise.resolve(s);
    },
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

describe('sources API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let sourceStore: ReturnType<typeof createMemorySourceStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    sourceStore = createMemorySourceStore();
    app = createApp({ authStore, kbStore, sourceStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/sources`);
    expect(res.status).toBe(401);
  });

  it('lets an editor create a source with structured metadata (no AI needed)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/sources`)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'The Pragmatic Programmer',
        sourceType: 'book',
        uri: 'isbn:9780135957059',
        metadata: { authors: ['Hunt', 'Thomas'], year: 2019 },
      });
    expect(res.status).toBe(201);
    expect(sourceSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.title).toBe('The Pragmatic Programmer');
    expect(res.body.metadata).toEqual({ authors: ['Hunt', 'Thomas'], year: 2019 });
    expect(sourceStore.outbox).toEqual([{ action: 'source.created', targetId: res.body.id }]);
  });

  it('rejects a source without a title', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/sources`)
      .set('x-csrf-token', csrfToken)
      .send({ sourceType: 'book' });
    expect(res.status).toBe(400);
  });

  it('forbids viewers from creating sources but allows reads', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const create = await agent
      .post(`/api/knowledge-bases/${KB_ID}/sources`)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'x' });
    expect(create.status).toBe(403);
    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/sources`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('lets an editor edit and delete a source', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/sources`)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Draft' });
    const id = created.body.id as string;

    const edit = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/sources/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Final', content: 'captured text' });
    expect(edit.status).toBe(200);
    expect(edit.body.title).toBe('Final');
    expect(edit.body.content).toBe('captured text');

    const del = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/sources/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(del.status).toBe(204);

    const after = await agent.get(`/api/knowledge-bases/${KB_ID}/sources/${id}`);
    expect(after.status).toBe(404);
  });
});
