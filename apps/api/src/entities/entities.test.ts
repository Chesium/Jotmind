import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { entitySchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { EntityRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type {
  CreateEntityInput,
  DeleteEntityInput,
  EntityStore,
  MergeEntitiesInput,
  UpdateEntityInput,
} from './store.js';
import { createMemorySchemaStore } from '../schema-defs/schema-defs.test.js';

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
  targetType?: 'entity' | 'claim';
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
    deleteEntity: (input: DeleteEntityInput) => {
      const e = byId.get(input.id);
      if (!e || e.knowledgeBaseId !== input.knowledgeBaseId || e.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      e.deletedAt = new Date();
      e.updatedAt = new Date();
      outbox.push({
        knowledgeBaseId: e.knowledgeBaseId,
        eventType: 'deleted',
        targetType: 'entity',
        targetId: e.id,
      });
      audits.push({
        knowledgeBaseId: e.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.deleted',
        targetId: e.id,
        metadata: { type: e.type, name: e.name },
      });
      return Promise.resolve(e);
    },
    mergeEntities: (input: MergeEntitiesInput) => {
      if (input.sourceId === input.targetId) {
        return Promise.resolve({ ok: false as const, reason: 'same_entity' as const });
      }
      const source = byId.get(input.sourceId);
      if (
        !source ||
        source.knowledgeBaseId !== input.knowledgeBaseId ||
        source.deletedAt !== null
      ) {
        return Promise.resolve({ ok: false as const, reason: 'source_not_found' as const });
      }
      const target = byId.get(input.targetId);
      if (
        !target ||
        target.knowledgeBaseId !== input.knowledgeBaseId ||
        target.deletedAt !== null
      ) {
        return Promise.resolve({ ok: false as const, reason: 'target_not_found' as const });
      }
      const now = new Date();
      const aliasSet = new Set<string>([
        ...(target.aliases as string[]),
        ...(source.aliases as string[]),
      ]);
      if (source.name !== target.name) aliasSet.add(source.name);
      target.aliases = [...aliasSet];
      target.tags = [
        ...new Set<string>([...(target.tags as string[]), ...(source.tags as string[])]),
      ];
      target.properties = {
        ...(source.properties as Record<string, unknown>),
        ...(target.properties as Record<string, unknown>),
      };
      target.updatedAt = now;
      source.deletedAt = now;
      source.mergedIntoId = target.id;
      source.updatedAt = now;
      outbox.push(
        {
          knowledgeBaseId: input.knowledgeBaseId,
          eventType: 'updated',
          targetType: 'entity',
          targetId: target.id,
        },
        {
          knowledgeBaseId: input.knowledgeBaseId,
          eventType: 'deleted',
          targetType: 'entity',
          targetId: source.id,
        },
      );
      audits.push({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'entity.merged',
        targetId: target.id,
        metadata: { sourceId: source.id, targetId: target.id, retargetedClaimCount: 0 },
      });
      return Promise.resolve({ ok: true as const, entity: target, retargetedClaimCount: 0 });
    },
    getEntityImpact: (kb, id) => {
      const e = byId.get(id);
      if (!e || e.knowledgeBaseId !== kb || e.deletedAt !== null) {
        return Promise.resolve(undefined);
      }
      // The in-memory fake does not track claims; impact is exercised in the
      // integration tests against a live DB.
      return Promise.resolve({ claims: [] });
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
  let schemaStore: ReturnType<typeof createMemorySchemaStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    entityStore = createMemoryEntityStore();
    schemaStore = createMemorySchemaStore();
    app = createApp({ authStore, kbStore, entityStore, schemaStore });
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

  it('validates against an active entity-type schema and stamps schemaVersionId (US-027 AC3/AC5)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const def = await schemaStore.createDefinition({
      knowledgeBaseId: KB_ID,
      kind: 'entity_type',
      name: 'Person',
      displayName: 'Person',
      propertySchema: { born: { type: 'number', required: true } },
      actorUserId: userId,
    });
    const versionId = def.ok ? def.definition.activeVersion?.id : undefined;

    // Missing the required custom property -> rejected before save.
    const bad = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Person', name: 'Ada Lovelace', properties: {} });
    expect(bad.status).toBe(400);
    expect(bad.body.issues?.[0]?.field).toBe('born');
    expect(entityStore.outbox).toHaveLength(0);

    // Valid payload -> saved + schemaVersionId stamped on the record.
    const ok = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Person', name: 'Ada Lovelace', properties: { born: 1815 } });
    expect(ok.status).toBe(201);
    expect(ok.body.schemaVersionId).toBe(versionId);
  });

  it('leaves entities without a custom schema unconstrained', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Gadget', name: 'Whatsit', properties: { anything: true } });
    expect(res.status).toBe(201);
    expect(res.body.schemaVersionId).toBeNull();
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

  async function createEntity(
    agent: ReturnType<typeof request.agent>,
    csrfToken: string,
    name: string,
  ): Promise<string> {
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities`)
      .set('x-csrf-token', csrfToken)
      .send({ type: 'Person', name });
    return res.body.id as string;
  }

  it('soft-deletes an entity and records audit + outbox events', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createEntity(agent, csrfToken, 'Ada');

    const res = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/entities/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(res.status).toBe(204);

    // No longer listed (soft-deleted).
    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/entities`);
    expect(list.body).toEqual([]);

    expect(entityStore.outbox.some((e) => e.eventType === 'deleted' && e.targetId === id)).toBe(
      true,
    );
    expect(entityStore.audits.some((a) => a.action === 'entity.deleted')).toBe(true);
  });

  it('requires CSRF and editor role to delete', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createEntity(agent, csrfToken, 'Ada');

    const noCsrf = await agent.delete(`/api/knowledge-bases/${KB_ID}/entities/${id}`);
    expect(noCsrf.status).toBe(403);

    kbStore.setRole(KB_ID, userId, 'viewer');
    const asViewer = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/entities/${id}`)
      .set('x-csrf-token', csrfToken);
    expect(asViewer.status).toBe(403);
  });

  it('returns 404 deleting a missing entity', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .delete(`/api/knowledge-bases/${KB_ID}/entities/${randomUUID()}`)
      .set('x-csrf-token', csrfToken);
    expect(res.status).toBe(404);
  });

  it('exposes delete/merge impact to viewers', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createEntity(agent, csrfToken, 'Ada');

    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/entities/${id}/impact`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claims: [] });
  });

  it('merges one entity into another (archive & pointer)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const sourceId = await createEntity(agent, csrfToken, 'Ada L.');
    const targetId = await createEntity(agent, csrfToken, 'Ada Lovelace');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities/${sourceId}/merge`)
      .set('x-csrf-token', csrfToken)
      .send({ targetId });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(targetId);
    // Source name preserved as an alias on the survivor.
    expect(res.body.aliases).toContain('Ada L.');

    // Source is archived (no longer listed); survivor remains.
    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/entities`);
    const ids = (list.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(targetId);
    expect(ids).not.toContain(sourceId);

    expect(entityStore.audits.some((a) => a.action === 'entity.merged')).toBe(true);
  });

  it('rejects merging an entity into itself', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createEntity(agent, csrfToken, 'Ada');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities/${id}/merge`)
      .set('x-csrf-token', csrfToken)
      .send({ targetId: id });
    expect(res.status).toBe(400);
  });

  it('returns 404 merging into a missing target', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const sourceId = await createEntity(agent, csrfToken, 'Ada');

    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities/${sourceId}/merge`)
      .set('x-csrf-token', csrfToken)
      .send({ targetId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('forbids viewers from merging', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const sourceId = await createEntity(agent, csrfToken, 'Ada');
    const targetId = await createEntity(agent, csrfToken, 'Ada Lovelace');

    kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/entities/${sourceId}/merge`)
      .set('x-csrf-token', csrfToken)
      .send({ targetId });
    expect(res.status).toBe(403);
  });
});
