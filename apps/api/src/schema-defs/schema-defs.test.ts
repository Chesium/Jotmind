import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { schemaDefinitionSchema, schemaExportSchema, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SchemaDefinitionRow, SchemaVersionRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { CreateSchemaDefinitionInput, SchemaStore } from './store.js';

/** Minimal in-memory AuthStore for setup/login. */
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
  knowledgeBaseId: string;
  actorUserId: string;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/**
 * In-memory SchemaStore mirroring the DB store behavior (v1 active version on
 * create, (kb, kind, name) uniqueness, active-version-by-name lookup). Reused by
 * the entity/claim router tests so they can validate against custom schemas
 * without a live DB.
 */
export function createMemorySchemaStore(): SchemaStore & {
  audits: AuditRecord[];
} {
  const defs = new Map<string, SchemaDefinitionRow>();
  const versions = new Map<string, SchemaVersionRow>();
  const audits: AuditRecord[] = [];

  const activeVersionFor = (defId: string): SchemaVersionRow | null => {
    for (const v of versions.values()) {
      if (v.schemaDefinitionId === defId && v.isActive && v.deletedAt === null) return v;
    }
    return null;
  };

  return {
    audits,
    listDefinitions: (kb) =>
      Promise.resolve(
        [...defs.values()]
          .filter((d) => d.knowledgeBaseId === kb && d.deletedAt === null)
          .map((d) => ({ ...d, activeVersion: activeVersionFor(d.id) })),
      ),
    getDefinition: (kb, id) => {
      const d = defs.get(id);
      if (!d || d.knowledgeBaseId !== kb || d.deletedAt !== null) return Promise.resolve(undefined);
      return Promise.resolve({ ...d, activeVersion: activeVersionFor(d.id) });
    },
    createDefinition: (input: CreateSchemaDefinitionInput) => {
      const dup = [...defs.values()].some(
        (d) =>
          d.knowledgeBaseId === input.knowledgeBaseId &&
          d.kind === input.kind &&
          d.name === input.name &&
          d.deletedAt === null,
      );
      if (dup) return Promise.resolve({ ok: false as const, reason: 'duplicate_name' as const });
      const now = new Date();
      const def: SchemaDefinitionRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        kind: input.kind,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const version: SchemaVersionRow = {
        id: randomUUID(),
        schemaDefinitionId: def.id,
        knowledgeBaseId: input.knowledgeBaseId,
        version: 1,
        propertySchema: input.propertySchema ?? {},
        spec: input.spec ?? {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      defs.set(def.id, def);
      versions.set(version.id, version);
      audits.push({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'schema.created',
        targetId: def.id,
        metadata: { kind: def.kind, name: def.name, version: version.version },
      });
      return Promise.resolve({ ok: true as const, definition: { ...def, activeVersion: version } });
    },
    getActiveVersionByName: (kb, kind, name) => {
      const def = [...defs.values()].find(
        (d) =>
          d.knowledgeBaseId === kb && d.kind === kind && d.name === name && d.deletedAt === null,
      );
      if (!def) return Promise.resolve(undefined);
      return Promise.resolve(activeVersionFor(def.id) ?? undefined);
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const MEMBER = { email: 'member@example.com', password: 'an0therpass!' };
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

async function createMemberAgent(
  app: ReturnType<typeof createApp>,
  adminAgent: ReturnType<typeof request.agent>,
  adminCsrf: string,
) {
  await adminAgent
    .post('/api/auth/users')
    .set('x-csrf-token', adminCsrf)
    .send({ ...MEMBER, role: 'member' });
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send(MEMBER);
  return { agent, csrfToken: login.body.csrfToken as string, userId: login.body.user.id as string };
}

describe('schema definitions API', () => {
  let authStore: AuthStore;
  let kbStore: ReturnType<typeof createMemoryKbStore>;
  let schemaStore: ReturnType<typeof createMemorySchemaStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authStore = createMemoryAuthStore();
    kbStore = createMemoryKbStore();
    schemaStore = createMemorySchemaStore();
    app = createApp({ authStore, kbStore, schemaStore });
  });

  it('requires authentication to list', async () => {
    const res = await request(app).get(`/api/knowledge-bases/${KB_ID}/schema`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/schema`);
    expect(res.status).toBe(404);
  });

  it('creates an entity-type definition with a v1 active version (AC1)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({
        kind: 'entity_type',
        name: 'Person',
        displayName: 'Person',
        description: 'A human',
        propertySchema: { age: { type: 'number', required: true } },
      });
    expect(res.status).toBe(201);
    const parsed = schemaDefinitionSchema.parse(res.body);
    expect(parsed.kind).toBe('entity_type');
    expect(parsed.activeVersion?.version).toBe(1);
    expect(parsed.activeVersion?.isActive).toBe(true);
    expect(parsed.activeVersion?.propertySchema.age?.type).toBe('number');
    expect(schemaStore.audits.map((a) => a.action)).toContain('schema.created');
  });

  it('creates a claim-predicate definition with argument roles (AC2)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({
        kind: 'claim_predicate',
        name: 'knows',
        displayName: 'knows',
        spec: {
          argumentRoles: [
            { name: 'subject', required: true, entityTypes: ['Person'] },
            { name: 'object', required: true, entityTypes: ['Person'] },
          ],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.activeVersion.spec.argumentRoles).toHaveLength(2);
  });

  it('rejects a duplicate (kind, name) with 409', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const body = { kind: 'entity_type', name: 'Person', displayName: 'Person' };
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send(body);
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send(body);
    expect(res.status).toBe(409);
  });

  it('rejects invalid payloads with 400', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'bogus', name: '', displayName: '' });
    expect(res.status).toBe(400);
  });

  it('requires CSRF for create', async () => {
    const { agent, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .send({ kind: 'entity_type', name: 'Person', displayName: 'Person' });
    expect(res.status).toBe(403);
  });

  it('forbids viewers from creating (AC: KB scoped, read-only viewers)', async () => {
    const { agent: adminAgent, csrfToken: adminCsrf } = await setupAdminAgent(app);
    const { agent, csrfToken, userId } = await createMemberAgent(app, adminAgent, adminCsrf);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'entity_type', name: 'Person', displayName: 'Person' });
    expect(res.status).toBe(403);
  });

  it('lists definitions for members and exports portable JSON (AC4)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'entity_type', name: 'Person', displayName: 'Person' });

    const list = await agent.get(`/api/knowledge-bases/${KB_ID}/schema`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const exported = await agent.get(`/api/knowledge-bases/${KB_ID}/schema/export`);
    expect(exported.status).toBe(200);
    const parsed = schemaExportSchema.parse(exported.body);
    expect(parsed.knowledgeBaseId).toBe(KB_ID);
    expect(parsed.schemaDefinitions).toHaveLength(1);
    expect(parsed.schemaDefinitions[0]?.name).toBe('Person');
  });
});
