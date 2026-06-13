import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { noteSchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { NoteRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { CreateNoteInput, NoteStore, UpdateNoteInput, DeleteNoteInput } from './store.js';

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

function createMemoryNoteStore(): NoteStore & { audits: SideEffect[]; outbox: SideEffect[] } {
  const byId = new Map<string, NoteRow>();
  const audits: SideEffect[] = [];
  const outbox: SideEffect[] = [];
  return {
    audits,
    outbox,
    listNotes: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((n) => n.knowledgeBaseId === kb && n.deletedAt === null),
      ),
    getNote: (kb, id) => {
      const n = byId.get(id);
      return Promise.resolve(n && n.knowledgeBaseId === kb && n.deletedAt === null ? n : undefined);
    },
    createNote: (input: CreateNoteInput) => {
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
      outbox.push({ action: 'note.created', targetId: row.id });
      audits.push({ action: 'note.created', targetId: row.id });
      return Promise.resolve(row);
    },
    updateNote: (input: UpdateNoteInput) => {
      const n = byId.get(input.id);
      if (!n || n.knowledgeBaseId !== input.knowledgeBaseId || n.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      const f = input.fields;
      if (f.title !== undefined) n.title = f.title;
      if (f.content !== undefined) n.content = f.content;
      if (f.properties !== undefined) n.properties = f.properties;
      n.updatedAt = new Date();
      outbox.push({ action: 'note.updated', targetId: n.id });
      audits.push({ action: 'note.updated', targetId: n.id });
      return Promise.resolve(n);
    },
    deleteNote: (input: DeleteNoteInput) => {
      const n = byId.get(input.id);
      if (!n || n.knowledgeBaseId !== input.knowledgeBaseId || n.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      n.deletedAt = new Date();
      n.updatedAt = new Date();
      outbox.push({ action: 'note.deleted', targetId: n.id });
      audits.push({ action: 'note.deleted', targetId: n.id });
      return Promise.resolve(n);
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

describe('notes API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let noteStore: ReturnType<typeof createMemoryNoteStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    noteStore = createMemoryNoteStore();
    app = createApp({ authStore, kbStore, noteStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/notes`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/notes`);
    expect(res.status).toBe(404);
  });

  it('lets an editor create a note with audit + outbox events (no AI needed)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/notes`)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Idea', content: 'Some freeform thought.' });
    expect(res.status).toBe(201);
    expect(noteSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.content).toBe('Some freeform thought.');
    expect(res.body.createdBy).toBe(userId);
    expect(noteStore.outbox).toEqual([{ action: 'note.created', targetId: res.body.id }]);
    expect(noteStore.audits).toEqual([{ action: 'note.created', targetId: res.body.id }]);
  });

  it('rejects a note without content', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/notes`)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'No body' });
    expect(res.status).toBe(400);
    expect(noteStore.outbox).toHaveLength(0);
  });

  it('requires CSRF for creation', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/notes`).send({ content: 'x' });
    expect(res.status).toBe(403);
  });

  it('forbids viewers from creating notes but allows reads', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const create = await agent
      .post(`/api/knowledge-bases/${KB_ID}/notes`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'x' });
    expect(create.status).toBe(403);
    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/notes`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('lets an editor edit and delete a note', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/notes`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'original' });
    const id = created.body.id as string;

    const edit = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/notes/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ content: 'edited' });
    expect(edit.status).toBe(200);
    expect(edit.body.content).toBe('edited');

    const del = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/notes/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(del.status).toBe(204);

    const after = await agent.get(`/api/knowledge-bases/${KB_ID}/notes/${id}`);
    expect(after.status).toBe(404);
  });
});
