import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { claimSchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { ClaimArgumentRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type {
  ClaimStore,
  ClaimWithArguments,
  CreateClaimInput,
  DeleteClaimInput,
  UpdateClaimInput,
} from './store.js';

/** Minimal in-memory AuthStore (mirrors entities/entities.test.ts) for setup/login. */
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

interface AuditRecord {
  action: string;
  actorUserId: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

interface OutboxRecord {
  eventType: 'created' | 'updated' | 'deleted';
  targetId: string;
}

/** In-memory ClaimStore that records audit + outbox side-effects for assertions. */
function createMemoryClaimStore(): ClaimStore & {
  audits: AuditRecord[];
  outbox: OutboxRecord[];
} {
  const byId = new Map<string, ClaimWithArguments>();
  const audits: AuditRecord[] = [];
  const outbox: OutboxRecord[] = [];

  function buildArgs(
    kb: string,
    claimId: string,
    args: CreateClaimInput['arguments'],
  ): ClaimArgumentRow[] {
    const now = new Date();
    return args.map((arg, position) => ({
      id: randomUUID(),
      knowledgeBaseId: kb,
      claimId,
      role: arg.role,
      position,
      argumentKind: arg.argumentKind,
      entityId: arg.argumentKind === 'entity' ? (arg.entityId ?? null) : null,
      value: arg.argumentKind === 'literal' ? (arg.value ?? null) : null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
  }

  return {
    audits,
    outbox,
    listClaims: (kb) =>
      Promise.resolve(
        [...byId.values()].filter((c) => c.knowledgeBaseId === kb && c.deletedAt === null),
      ),
    getClaim: (kb, id) => {
      const c = byId.get(id);
      return Promise.resolve(c && c.knowledgeBaseId === kb && c.deletedAt === null ? c : undefined);
    },
    createClaim: (input: CreateClaimInput) => {
      const now = new Date();
      const id = randomUUID();
      const row: ClaimWithArguments = {
        id,
        knowledgeBaseId: input.knowledgeBaseId,
        predicate: input.predicate,
        schemaVersionId: input.schemaVersionId ?? null,
        description: input.description ?? null,
        confidence: input.confidence ?? null,
        validStart: input.validStart ? new Date(input.validStart) : null,
        validEnd: input.validEnd ? new Date(input.validEnd) : null,
        properties: input.properties ?? {},
        provenance: {},
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        arguments: buildArgs(input.knowledgeBaseId, id, input.arguments),
      };
      byId.set(id, row);
      outbox.push({ eventType: 'created', targetId: id });
      audits.push({
        action: 'claim.created',
        actorUserId: input.actorUserId,
        targetId: id,
        metadata: { predicate: row.predicate, argumentCount: row.arguments.length },
      });
      return Promise.resolve(row);
    },
    updateClaim: (input: UpdateClaimInput) => {
      const c = byId.get(input.id);
      if (!c || c.knowledgeBaseId !== input.knowledgeBaseId || c.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      const f = input.fields;
      if (f.predicate !== undefined) c.predicate = f.predicate;
      if (f.description !== undefined) c.description = f.description;
      if (f.confidence !== undefined) c.confidence = f.confidence;
      if (f.validStart !== undefined) c.validStart = f.validStart ? new Date(f.validStart) : null;
      if (f.validEnd !== undefined) c.validEnd = f.validEnd ? new Date(f.validEnd) : null;
      if (f.properties !== undefined) c.properties = f.properties;
      if (f.arguments !== undefined) c.arguments = buildArgs(c.knowledgeBaseId, c.id, f.arguments);
      c.updatedAt = new Date();
      outbox.push({ eventType: 'updated', targetId: c.id });
      audits.push({
        action: 'claim.updated',
        actorUserId: input.actorUserId,
        targetId: c.id,
        metadata: { changed: Object.keys(f) },
      });
      return Promise.resolve(c);
    },
    deleteClaim: (input: DeleteClaimInput) => {
      const c = byId.get(input.id);
      if (!c || c.knowledgeBaseId !== input.knowledgeBaseId || c.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      const now = new Date();
      c.deletedAt = now;
      c.updatedAt = now;
      for (const arg of c.arguments) arg.deletedAt = now;
      outbox.push({ eventType: 'deleted', targetId: c.id });
      audits.push({
        action: 'claim.deleted',
        actorUserId: input.actorUserId,
        targetId: c.id,
        metadata: { predicate: c.predicate },
      });
      return Promise.resolve(c);
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const KB_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_A = '22222222-2222-2222-2222-222222222222';
const ENTITY_B = '33333333-3333-3333-3333-333333333333';

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return {
    agent,
    csrfToken: setup.body.csrfToken as string,
    userId: setup.body.user.id as string,
  };
}

describe('claims API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let claimStore: ReturnType<typeof createMemoryClaimStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    claimStore = createMemoryClaimStore();
    app = createApp({ authStore, kbStore, claimStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/claims`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/claims`);
    expect(res.status).toBe(404);
  });

  it('lets an editor create a multi-argument claim with audit + outbox events', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({
        predicate: 'met',
        description: 'They met at a conference',
        confidence: 0.8,
        validStart: '2020-01-01T00:00:00.000Z',
        validEnd: '2020-01-02T00:00:00.000Z',
        arguments: [
          { role: 'subject', argumentKind: 'entity', entityId: ENTITY_A },
          { role: 'object', argumentKind: 'entity', entityId: ENTITY_B },
          { role: 'location', argumentKind: 'literal', value: 'Berlin' },
        ],
      });

    expect(res.status).toBe(201);
    expect(claimSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.predicate).toBe('met');
    expect(res.body.confidence).toBe(0.8);
    expect(res.body.arguments).toHaveLength(3);
    expect(res.body.arguments[0].role).toBe('subject');
    expect(res.body.arguments[2].argumentKind).toBe('literal');
    expect(res.body.arguments[2].value).toBe('Berlin');
    expect(res.body.createdBy).toBe(userId);

    expect(claimStore.outbox).toEqual([{ eventType: 'created', targetId: res.body.id }]);
    expect(claimStore.audits).toHaveLength(1);
    expect(claimStore.audits[0]).toMatchObject({
      action: 'claim.created',
      actorUserId: userId,
      targetId: res.body.id,
    });
  });

  it('rejects creation without a predicate', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({ arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }] });

    expect(res.status).toBe(400);
    expect(claimStore.outbox).toHaveLength(0);
  });

  it('rejects creation without at least one argument', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({ predicate: 'met', arguments: [] });

    expect(res.status).toBe(400);
    expect(claimStore.outbox).toHaveLength(0);
  });

  it('rejects an entity argument that is missing entityId', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({ predicate: 'met', arguments: [{ role: 'subject', argumentKind: 'entity' }] });

    expect(res.status).toBe(400);
  });

  it('rejects a literal argument that is missing a value', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({ predicate: 'met', arguments: [{ role: 'location', argumentKind: 'literal' }] });

    expect(res.status).toBe(400);
  });

  it('requires CSRF for creation', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent.post(`/api/knowledge-bases/${KB_ID}/claims`).send({
      predicate: 'met',
      arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
    });

    expect(res.status).toBe(403);
  });

  it('forbids viewers from creating claims but allows reads', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'viewer');

    const create = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({
        predicate: 'met',
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      });
    expect(create.status).toBe(403);

    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/claims`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('lets an editor edit claim metadata and argument roles', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({
        predicate: 'met',
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      });
    const id = created.body.id as string;

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/claims/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({
        confidence: 0.5,
        arguments: [
          { role: 'attendee', argumentKind: 'entity', entityId: ENTITY_A },
          { role: 'attendee', argumentKind: 'entity', entityId: ENTITY_B },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe(0.5);
    expect(res.body.arguments).toHaveLength(2);
    expect(res.body.arguments.map((a: { role: string }) => a.role)).toEqual([
      'attendee',
      'attendee',
    ]);
    expect(claimStore.outbox.some((e) => e.eventType === 'updated' && e.targetId === id)).toBe(
      true,
    );
    expect(claimStore.audits.some((a) => a.action === 'claim.updated')).toBe(true);
  });

  it('rejects an empty update payload', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const created = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({
        predicate: 'met',
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      });

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/claims/${created.body.id}`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when editing a missing claim', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');

    const res = await agent
      .patch(`/api/knowledge-bases/${KB_ID}/claims/${randomUUID()}`)
      .set('x-csrf-token', csrfToken)
      .send({ predicate: 'nope' });
    expect(res.status).toBe(404);
  });

  async function createClaim(
    agent: ReturnType<typeof request.agent>,
    csrfToken: string,
  ): Promise<string> {
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/claims`)
      .set('x-csrf-token', csrfToken)
      .send({
        predicate: 'met',
        arguments: [{ role: 'subject', argumentKind: 'entity', entityId: ENTITY_A }],
      });
    return res.body.id as string;
  }

  it('soft-deletes a claim and records audit + outbox events', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createClaim(agent, csrfToken);

    const res = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/claims/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(res.status).toBe(204);

    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/claims`);
    expect(list.body).toEqual([]);

    expect(claimStore.outbox.some((e) => e.eventType === 'deleted' && e.targetId === id)).toBe(
      true,
    );
    expect(claimStore.audits.some((a) => a.action === 'claim.deleted')).toBe(true);
  });

  it('requires CSRF and editor role to delete', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createClaim(agent, csrfToken);

    const noCsrf = await agent.delete(`/api/knowledge-bases/${KB_ID}/claims/${id}`);
    expect(noCsrf.status).toBe(403);

    kbStore.setRole(KB_ID, userId, 'viewer');
    const asViewer = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/claims/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(asViewer.status).toBe(403);
  });

  it('returns 404 deleting a missing claim', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/claims/${randomUUID()}`)
      .set('x-csrf-token', csrfToken);
    expect(res.status).toBe(404);
  });
});
