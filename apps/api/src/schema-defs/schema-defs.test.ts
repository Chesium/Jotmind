import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  classifySchemaChange,
  predicateSpecSchema,
  schemaDefinitionSchema,
  schemaExportSchema,
  schemaValidationReportSchema,
  type KbRole,
  type PropertySchema,
} from '@jotmind/schemas';
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
    updateDefinition: (input) => {
      const def = defs.get(input.id);
      if (!def || def.knowledgeBaseId !== input.knowledgeBaseId || def.deletedAt !== null) {
        return Promise.resolve({ ok: false as const, reason: 'not_found' as const });
      }
      const active = activeVersionFor(def.id);
      const currentPropertySchema = (active?.propertySchema as PropertySchema) ?? {};
      const currentSpec = predicateSpecSchema.parse(
        (active?.spec as Record<string, unknown>) ?? {},
      );
      const nextPropertySchema = input.propertySchema ?? currentPropertySchema;
      const nextSpec = input.spec ?? currentSpec;
      const validationChanged = input.propertySchema !== undefined || input.spec !== undefined;
      const classification = validationChanged
        ? classifySchemaChange(
            def.kind as 'entity_type' | 'claim_predicate',
            { propertySchema: currentPropertySchema, spec: currentSpec },
            { propertySchema: nextPropertySchema, spec: nextSpec },
          )
        : { changeType: 'compatible' as const, reasons: [] };

      const now = new Date();
      if (input.displayName !== undefined) def.displayName = input.displayName;
      if (input.description !== undefined) def.description = input.description;
      def.updatedAt = now;

      let activeVersion = active;
      if (validationChanged && active) {
        if (classification.changeType === 'breaking') {
          active.isActive = false;
          const maxVersion = Math.max(
            ...[...versions.values()]
              .filter((v) => v.schemaDefinitionId === def.id)
              .map((v) => v.version),
          );
          const created: SchemaVersionRow = {
            id: randomUUID(),
            schemaDefinitionId: def.id,
            knowledgeBaseId: input.knowledgeBaseId,
            version: maxVersion + 1,
            propertySchema: nextPropertySchema,
            spec: nextSpec,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
          versions.set(created.id, created);
          activeVersion = created;
        } else {
          active.propertySchema = nextPropertySchema;
          active.spec = nextSpec;
          active.updatedAt = now;
          activeVersion = active;
        }
      }

      audits.push({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action:
          classification.changeType === 'breaking' ? 'schema.version_created' : 'schema.updated',
        targetId: def.id,
        metadata: { changeType: classification.changeType },
      });

      return Promise.resolve({
        ok: true as const,
        definition: { ...def, activeVersion },
        classification,
      });
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

  async function createPersonSchema(
    agent: ReturnType<typeof request.agent>,
    csrfToken: string,
    propertySchema: Record<string, unknown>,
  ): Promise<string> {
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/schema`)
      .set('x-csrf-token', csrfToken)
      .send({ kind: 'entity_type', name: 'Person', displayName: 'Person', propertySchema });
    return res.body.id as string;
  }

  it('applies a compatible change in place (no new version, US-028 AC1)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createPersonSchema(agent, csrfToken, {
      born: { type: 'number', required: true },
    });
    // Loosen: make `born` optional + add an optional field.
    const res = await agent
      .put(`/api/knowledge-bases/${KB_ID}/schema/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({
        displayName: 'People',
        propertySchema: { born: { type: 'number' }, city: { type: 'string' } },
      });
    expect(res.status).toBe(200);
    expect(res.body.changeType).toBe('compatible');
    expect(res.body.definition.displayName).toBe('People');
    expect(res.body.definition.activeVersion.version).toBe(1);
    expect(schemaStore.audits.map((a) => a.action)).toContain('schema.updated');
  });

  it('creates a new active version for a breaking change (US-028 AC2)', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createPersonSchema(agent, csrfToken, { born: { type: 'number' } });
    // Tighten: make `born` required.
    const res = await agent
      .put(`/api/knowledge-bases/${KB_ID}/schema/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ propertySchema: { born: { type: 'number', required: true } } });
    expect(res.status).toBe(200);
    expect(res.body.changeType).toBe('breaking');
    expect(res.body.definition.activeVersion.version).toBe(2);
    expect(res.body.definition.activeVersion.isActive).toBe(true);
    expect(schemaStore.audits.map((a) => a.action)).toContain('schema.version_created');
  });

  it('treats a metadata-only update as compatible', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createPersonSchema(agent, csrfToken, {});
    const res = await agent
      .put(`/api/knowledge-bases/${KB_ID}/schema/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ description: 'A human being' });
    expect(res.status).toBe(200);
    expect(res.body.changeType).toBe('compatible');
    expect(res.body.definition.description).toBe('A human being');
    expect(res.body.definition.activeVersion.version).toBe(1);
  });

  it('returns 404 when updating a missing definition', async () => {
    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .put(`/api/knowledge-bases/${KB_ID}/schema/${randomUUID()}`)
      .set('x-csrf-token', csrfToken)
      .send({ displayName: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('forbids viewers from updating (read-only)', async () => {
    const { agent: adminAgent, csrfToken: adminCsrf, userId: adminId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, adminId, 'editor');
    const id = await createPersonSchema(adminAgent, adminCsrf, {});
    const { agent, csrfToken, userId } = await createMemberAgent(app, adminAgent, adminCsrf);
    kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .put(`/api/knowledge-bases/${KB_ID}/schema/${id}`)
      .set('x-csrf-token', csrfToken)
      .send({ displayName: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('reports validation warnings for mismatched existing entities (US-028 AC6)', async () => {
    // entityStore fake: one entity that lacks the now-required `born` field.
    const entityStore = {
      listEntities: () =>
        Promise.resolve([
          {
            id: 'e1',
            knowledgeBaseId: KB_ID,
            type: 'Person',
            name: 'Ada',
            properties: {},
            schemaVersionId: 'old-version',
          },
        ]),
      getEntity: () => Promise.resolve(undefined),
    } as never;
    const claimStore = { listClaims: () => Promise.resolve([]) } as never;
    app = createApp({ authStore, kbStore, schemaStore, entityStore, claimStore });

    const { agent, csrfToken, userId } = await setupAdminAgent(app);
    kbStore.setRole(KB_ID, userId, 'editor');
    const id = await createPersonSchema(agent, csrfToken, {
      born: { type: 'number', required: true },
    });
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/schema/${id}/validation`);
    expect(res.status).toBe(200);
    const report = schemaValidationReportSchema.parse(res.body);
    expect(report.totalRecords).toBe(1);
    expect(report.invalidRecords).toBe(1);
    expect(report.onOldVersionRecords).toBe(1);
    expect(report.warnings[0]?.label).toBe('Ada');
    expect(report.warnings[0]?.issues[0]?.field).toBe('born');
  });
});
