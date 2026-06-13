import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { entitySchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { EntityRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { CreateEntityInput, EntityStore, UpdateEntityInput } from './store.js';

/** Minimal in-memory AuthStore (mirrors kb/kb.test.ts) for setup/login. */
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

/**
 * Minimal in-memory KnowledgeBaseStore. Only the methods used by the entity
 * router (`getRole`) plus a `setRole` test helper are meaningful; the rest throw.
 */
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

interface AuditRecord {
  knowledgeBaseId: string;
  actorUserId: string;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

interface OutboxRecord {
  knowledgeBaseId: string;
  eventType: 'created' | 'updated' | 'deleted';
  targetId: string;
}

/** In-memory EntityStore that records audit + outbox side-effects for assertions. */
function createMemoryEntityStore(): EntityStore & {
  audits: AuditRecord[];
  outbox: OutboxRecord[];
} {
  const byId = new Map<string, EntityRow>();
  const audits: AuditRecord[] = [];
  const outbox: OutboxRecord[] = [];

  return {
    audits,
    outbox,
    listEntities: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((e) => e.knowledgeBaseId === kb && e.deletedAt === null),
      ),
    getEntity: (kb, id) => {
      const e = byId.get(id);
      return Promise.resolve(e && e.knowledgeBaseId === kb && e.deletedAt === null ? e : undefined);
    },
    createEntity: (input: CreateEntityInput) => {
      const now = new Date();
      const row: EntityRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        type: input.type,
        schemaVersionId: input.schemaVersionId ?? null,
        name: input.name,
        aliases: input.aliases ?? [],
        description: input.description ?? null,
        tags: input.tags ?? [],
        properties: input.properties ?? {},
        mergedIntoId: null,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(row.id, row);
      outbox.push({ knowledgeBaseId: row.knowledgeBaseId, eventType: 'created', targetId: row.id });
      audits.push({
        knowledgeBaseId: row.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.created',
        targetId: row.id,
        metadata: { type: row.type, name: row.name },
      });
      return Promise.resolve(row);
    },
    updateEntity: (input: UpdateEntityInput) => {
      const e = byId.get(input.id);
      if (!e || e.knowledgeBaseId !== input.knowledgeBaseId || e.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      const f = input.fields;
      if (f.type !== undefined) e.type = f.type;
      if (f.name !== undefined) e.name = f.name;
      if (f.aliases !== undefined) e.aliases = f.aliases;
      if (f.description !== undefined) e.description = f.description;
      if (f.tags !== undefined) e.tags = f.tags;
      if (f.properties !== undefined) e.properties = f.properties;
      e.updatedAt = new Date();
      outbox.push({ knowledgeBaseId: e.knowledgeBaseId, eventType: 'updated', targetId: e.id });
      audits.push({
        knowledgeBaseId: e.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.updated',
        targetId: e.id,
        metadata: { changed: Object.keys(f) },
      });
      return Promise.resolve(e);
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

describe('entities API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let entityStore: ReturnType<typeof createMemoryEntityStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    entityStore = createMemoryEntityStore();
    app = createApp({ authStore, kbStore, entityStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/entities`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/entities`);
    expect(res.status).toBe(404);
  });

  it('lets an editor create a built-in entity type with audit + outbox events', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({
        type: 'Person',
        name: 'Ada Lovelace',
        aliases: ['Ada'],
        description: 'Mathematician',
        tags: ['pioneer'],
        properties: { born: 1815 },
      });

    expect(res.status).toBe(201);
    expect(entitySchema.parse(res.body)).toEqual(res.body);
    expect(res.body.type).toBe('Person');
    expect(res.body.name).toBe('Ada Lovelace');
    expect(res.body.aliases).toEqual(['Ada']);
    expect(res.body.createdBy).toBe(userId);

    expect(entityStore.outbox).toEqual([
      { knowledgeBaseId: KB_ID, eventType: 'created', targetId: res.body.id },
    ]);
    expect(entityStore.audits).toHaveLength(1);
    expect(entityStore.audits[0]).toMatchObject({
      action: 'entity.created',
      actorUserId: userId,
      targetId: res.body.id,
    });
  });

  it('rejects creation with missing required fields', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Person' });

    expect(res.status).toBe(400);
    expect(entityStore.outbox).toHaveLength(0);
  });

  it('requires CSRF for creation', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .send({ type: 'Person', name: 'Ada' });

    expect(res.status).toBe(403);
  });

  it('forbids viewers from creating entities but allows reads', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const create = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Person', name: 'Ada' });
    expect(create.status).toBe(403);

    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/entities`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('lets an editor edit an entity and records the update', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Concept', name: 'Recursion' });
    const id = created.body.id as string;

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/entities/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Tail recursion', tags: ['cs'] });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Tail recursion');
    expect(res.body.tags).toEqual(['cs']);
    expect(entityStore.outbox.some((e) => e.eventType === 'updated' && e.targetId === id)).toBe(
      true,
    );
    expect(entityStore.audits.some((a) => a.action === 'entity.updated')).toBe(true);
  });

  it('rejects an empty update payload', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Concept', name: 'Recursion' });

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/entities/${created.body.id}`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when editing a missing entity', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/entities/${randomUUID()}`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});
