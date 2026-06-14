import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type {
  AuditEventRow,
  ClaimArgumentRow,
  EntityRow,
  NoteRow,
  RuleDefinitionRow,
  SessionRow,
  SourceExcerptRow,
  SourceRow,
  UserRow,
} from '../db/schema.js';
import type { AuthStore } from '../auth/index.js';
import type { KnowledgeBaseStore, KnowledgeBaseWithRole } from '../kb/store.js';
import type { EntityStore } from '../entities/store.js';
import type { ClaimStore, ClaimWithArguments } from '../claims/store.js';
import type { NoteStore } from '../notes/store.js';
import type { SourceStore } from '../sources/store.js';
import type { SourceExcerptStore, SourceExcerptWithClaim } from '../source-excerpts/store.js';
import type { RuleStore } from '../rules/store.js';
import { createMemorySchemaStore } from '../schema-defs/schema-defs.test.js';

const unsupported = () => Promise.reject(new Error('not supported in this fake'));

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

interface MemoryKbStore extends KnowledgeBaseStore {
  seedKb(name: string, createdBy: string): KnowledgeBaseWithRole;
  setRole(kb: string, user: string, role: KbRole): void;
  addAudit(event: AuditEventRow): void;
}

function createMemoryKbStore(): MemoryKbStore {
  const kbs = new Map<string, KnowledgeBaseWithRole>();
  const roles = new Map<string, KbRole>();
  const audits: AuditEventRow[] = [];
  const key = (kb: string, user: string) => `${kb}:${user}`;
  return {
    seedKb(name, createdBy) {
      const now = new Date();
      const kb: KnowledgeBaseWithRole = {
        id: randomUUID(),
        name,
        description: null,
        createdBy,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        role: 'owner',
      } as KnowledgeBaseWithRole;
      kbs.set(kb.id, kb);
      roles.set(key(kb.id, createdBy), 'owner');
      return kb;
    },
    setRole(kb, user, role) {
      roles.set(key(kb, user), role);
    },
    addAudit(event) {
      audits.push(event);
    },
    createKnowledgeBase: (input) => {
      const now = new Date();
      const kb: KnowledgeBaseWithRole = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        role: 'owner',
      } as KnowledgeBaseWithRole;
      kbs.set(kb.id, kb);
      roles.set(key(kb.id, input.createdBy), 'owner');
      return Promise.resolve(kb);
    },
    listForUser: () => Promise.resolve([...kbs.values()]),
    getForUser: (id, userId) => {
      const kb = kbs.get(id);
      const role = roles.get(key(id, userId));
      if (!kb || !role) return Promise.resolve(undefined);
      return Promise.resolve({ ...kb, role });
    },
    getRole: (kb, user) => Promise.resolve(roles.get(key(kb, user))),
    listMembers: () => Promise.resolve([]),
    userExists: () => Promise.resolve(true),
    assignRole: unsupported as never,
    listAuditEvents: (kbId) => Promise.resolve(audits.filter((a) => a.knowledgeBaseId === kbId)),
  };
}

interface MemoryEntityStore extends EntityStore {
  rows: EntityRow[];
}

function createMemoryEntityStore(): MemoryEntityStore {
  const rows: EntityRow[] = [];
  return {
    rows,
    listEntities: (kb) => Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb)),
    getEntity: (kb, id) =>
      Promise.resolve(rows.find((r) => r.knowledgeBaseId === kb && r.id === id)),
    createEntity: (input) => {
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
      rows.push(row);
      return Promise.resolve(row);
    },
    updateEntity: unsupported as never,
    deleteEntity: unsupported as never,
    mergeEntities: unsupported as never,
    getEntityImpact: unsupported as never,
  };
}

interface MemoryClaimStore extends ClaimStore {
  rows: ClaimWithArguments[];
}

function createMemoryClaimStore(): MemoryClaimStore {
  const rows: ClaimWithArguments[] = [];
  return {
    rows,
    listClaims: (kb) => Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb)),
    getClaim: (kb, id) =>
      Promise.resolve(rows.find((r) => r.knowledgeBaseId === kb && r.id === id)),
    createClaim: (input) => {
      const now = new Date();
      const claimId = randomUUID();
      const args: ClaimArgumentRow[] = input.arguments.map((a, i) => ({
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        claimId,
        role: a.role,
        position: i,
        argumentKind: a.argumentKind,
        entityId: a.entityId ?? null,
        value: a.value ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }));
      const row: ClaimWithArguments = {
        id: claimId,
        knowledgeBaseId: input.knowledgeBaseId,
        predicate: input.predicate,
        schemaVersionId: input.schemaVersionId ?? null,
        description: input.description ?? null,
        confidence: input.confidence ?? null,
        validStart: input.validStart ? new Date(input.validStart) : null,
        validEnd: input.validEnd ? new Date(input.validEnd) : null,
        properties: input.properties ?? {},
        provenance: input.provenance ?? {},
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        arguments: args,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    updateClaim: unsupported as never,
    deleteClaim: unsupported as never,
  };
}

interface MemoryNoteStore extends NoteStore {
  rows: NoteRow[];
}

function createMemoryNoteStore(): MemoryNoteStore {
  const rows: NoteRow[] = [];
  return {
    rows,
    listNotes: (kb) => Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb)),
    getNote: (kb, id) => Promise.resolve(rows.find((r) => r.knowledgeBaseId === kb && r.id === id)),
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
      rows.push(row);
      return Promise.resolve(row);
    },
    updateNote: unsupported as never,
    deleteNote: unsupported as never,
  };
}

interface MemorySourceStore extends SourceStore {
  rows: SourceRow[];
}

function createMemorySourceStore(): MemorySourceStore {
  const rows: SourceRow[] = [];
  return {
    rows,
    listSources: (kb) => Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb)),
    getSource: (kb, id) =>
      Promise.resolve(rows.find((r) => r.knowledgeBaseId === kb && r.id === id)),
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
      rows.push(row);
      return Promise.resolve(row);
    },
    updateSource: unsupported as never,
    deleteSource: unsupported as never,
  };
}

interface MemoryExcerptStore extends SourceExcerptStore {
  rows: SourceExcerptRow[];
}

function createMemoryExcerptStore(): MemoryExcerptStore {
  const rows: SourceExcerptRow[] = [];
  const withClaim = (r: SourceExcerptRow): SourceExcerptWithClaim => ({ ...r, claim: null });
  return {
    rows,
    listSourceExcerpts: (kb) =>
      Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb).map(withClaim)),
    getSourceExcerpt: (kb, id) => {
      const r = rows.find((x) => x.knowledgeBaseId === kb && x.id === id);
      return Promise.resolve(r ? withClaim(r) : undefined);
    },
    createSourceExcerpt: (input) => {
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
      rows.push(row);
      return Promise.resolve({ ok: true as const, excerpt: withClaim(row) });
    },
    updateSourceExcerpt: unsupported as never,
    deleteSourceExcerpt: unsupported as never,
  };
}

interface MemoryRuleStore extends RuleStore {
  rows: RuleDefinitionRow[];
}

function createMemoryRuleStore(): MemoryRuleStore {
  const rows: RuleDefinitionRow[] = [];
  return {
    rows,
    listRules: (kb) => Promise.resolve(rows.filter((r) => r.knowledgeBaseId === kb)),
    getRule: (kb, id) => Promise.resolve(rows.find((r) => r.knowledgeBaseId === kb && r.id === id)),
    installRulePack: unsupported as never,
    setRuleStatus: ({ knowledgeBaseId, id, status }) => {
      const r = rows.find((x) => x.knowledgeBaseId === knowledgeBaseId && x.id === id);
      if (!r) return Promise.resolve(undefined);
      r.status = status;
      return Promise.resolve(r);
    },
    createRule: (input) => {
      const dup = rows.some(
        (r) => r.knowledgeBaseId === input.knowledgeBaseId && r.name === input.name,
      );
      if (dup) return Promise.resolve({ ok: false as const, reason: 'duplicate_name' as const });
      const now = new Date();
      const row: RuleDefinitionRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId,
        name: input.name,
        description: input.description ?? null,
        ruleText: input.ruleText,
        status: 'draft',
        version: 1,
        compiled: { authored: { recursionCap: input.recursionCap ?? 16 } },
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      rows.push(row);
      return Promise.resolve({ ok: true as const, rule: row });
    },
    updateRule: unsupported as never,
  };
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };

function buildApp() {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const entityStore = createMemoryEntityStore();
  const claimStore = createMemoryClaimStore();
  const noteStore = createMemoryNoteStore();
  const sourceStore = createMemorySourceStore();
  const sourceExcerptStore = createMemoryExcerptStore();
  const schemaStore = createMemorySchemaStore();
  const ruleStore = createMemoryRuleStore();
  const app = createApp({
    authStore,
    kbStore,
    entityStore,
    claimStore,
    noteStore,
    sourceStore,
    sourceExcerptStore,
    schemaStore,
    ruleStore,
    extractor: null,
    commandInterpreter: null,
    answerGenerator: null,
  });
  return {
    app,
    kbStore,
    entityStore,
    claimStore,
    noteStore,
    sourceStore,
    sourceExcerptStore,
    schemaStore,
    ruleStore,
  };
}

async function setupAdmin(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string, csrf: setup.body.csrfToken as string };
}

/** Seed a source KB with one entity, one claim referencing it, a note, source, citation, schema, rule. */
async function seedSourceKb(ctx: ReturnType<typeof buildApp>, userId: string) {
  const kb = ctx.kbStore.seedKb('Source KB', userId);
  const schema = await ctx.schemaStore.createDefinition({
    knowledgeBaseId: kb.id,
    kind: 'entity_type',
    name: 'Person',
    displayName: 'Person',
    propertySchema: {},
    actorUserId: userId,
  });
  const versionId = schema.ok ? schema.definition.activeVersion?.id : undefined;
  const entity = await ctx.entityStore.createEntity({
    knowledgeBaseId: kb.id,
    type: 'Person',
    name: 'Ada Lovelace',
    tags: ['math'],
    schemaVersionId: versionId,
    actorUserId: userId,
  });
  const claim = await ctx.claimStore.createClaim({
    knowledgeBaseId: kb.id,
    predicate: 'knows',
    provenance: { origin: 'inferred', apiKey: 'sk-secret-should-not-leak' },
    arguments: [{ role: 'subject', argumentKind: 'entity', entityId: entity.id }],
    actorUserId: userId,
  });
  const note = await ctx.noteStore.createNote({
    knowledgeBaseId: kb.id,
    title: 'A note',
    content: 'Hello world',
    actorUserId: userId,
  });
  const source = await ctx.sourceStore.createSource({
    knowledgeBaseId: kb.id,
    title: 'A book',
    actorUserId: userId,
  });
  await ctx.sourceExcerptStore.createSourceExcerpt({
    knowledgeBaseId: kb.id,
    sourceId: source.id,
    claimId: claim.id,
    excerpt: 'cited text',
    actorUserId: userId,
  });
  await ctx.ruleStore.createRule({
    knowledgeBaseId: kb.id,
    name: 'my rule',
    ruleText: 'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).',
    actorUserId: userId,
  });
  ctx.kbStore.addAudit({
    id: randomUUID(),
    knowledgeBaseId: kb.id,
    actorUserId: userId,
    action: 'entity.created',
    targetType: 'entity',
    targetId: entity.id,
    metadata: {},
    createdAt: new Date(),
  } as AuditEventRow);
  return { kb, entity, claim, note, source };
}

describe('portable KB export (US-032)', () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it('rejects unauthenticated export', async () => {
    const kbId = '11111111-1111-1111-1111-111111111111';
    await request(ctx.app).get(`/api/knowledge-bases/${kbId}/export/json`).expect(401);
  });

  it('returns 404 for a non-member', async () => {
    const { agent } = await setupAdmin(ctx.app);
    const other = ctx.kbStore.seedKb('Other', 'someone-else');
    await agent.get(`/api/knowledge-bases/${other.id}/export/json`).expect(404);
  });

  it('returns 403 for a viewer (export is admin-only)', async () => {
    const { agent, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    ctx.kbStore.setRole(seeded.kb.id, userId, 'viewer');
    await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/json`).expect(403);
  });

  it('exports full-fidelity JSON with all buckets and no secrets (AC2/AC5)', async () => {
    const { agent, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    const res = await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/json`).expect(200);
    const body = res.body;
    expect(body.format).toBe('jotmind.kb.portable');
    expect(body.data.entities).toHaveLength(1);
    expect(body.data.claims).toHaveLength(1);
    expect(body.data.claims[0].arguments).toHaveLength(1);
    expect(body.data.notes).toHaveLength(1);
    expect(body.data.sources).toHaveLength(1);
    expect(body.data.citations).toHaveLength(1);
    expect(body.data.schemas).toHaveLength(1);
    expect(body.data.schemas[0].versions.length).toBeGreaterThanOrEqual(1);
    expect(body.data.rules).toHaveLength(1);
    expect(body.audit.events.length).toBeGreaterThanOrEqual(1);
    expect(body.secretPolicy.excludesProviderSecrets).toBe(true);
    // AC5: secret stashed in provenance must NOT leak.
    expect(JSON.stringify(body)).not.toContain('sk-secret-should-not-leak');
    expect(body.data.claims[0].provenance.apiKey).toBeUndefined();
    expect(body.data.claims[0].provenance.origin).toBe('inferred');
  });

  it('markdown export is labeled human-readable / not full-fidelity (AC3)', async () => {
    const { agent, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    const res = await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/markdown`).expect(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('Human-readable');
    expect(res.text).toContain('NOT a guaranteed full-fidelity');
    expect(res.text).toContain('Ada Lovelace');
  });

  it('csv export is labeled a structured subset (AC4)', async () => {
    const { agent, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    const res = await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/csv`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Structured subset');
    expect(res.text.split('\n')[1]).toBe('id,type,name,aliases,tags,description');
    expect(res.text).toContain('Ada Lovelace');
  });
});

describe('portable KB import (US-032 AC1)', () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it('requires CSRF', async () => {
    const { agent } = await setupAdmin(ctx.app);
    await agent.post('/api/knowledge-bases/import-portable').send({}).expect(403);
  });

  it('rejects an invalid document', async () => {
    const { agent, csrf } = await setupAdmin(ctx.app);
    await agent
      .post('/api/knowledge-bases/import-portable')
      .set('x-csrf-token', csrf)
      .send({ not: 'valid' })
      .expect(400);
  });

  it('imports into a NEW KB and remaps entity/claim/schema references', async () => {
    const { agent, csrf, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    const exported = (
      await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/json`).expect(200)
    ).body;

    const res = await agent
      .post('/api/knowledge-bases/import-portable')
      .set('x-csrf-token', csrf)
      .send(exported)
      .expect(201);

    const newKbId = res.body.knowledgeBaseId as string;
    expect(newKbId).not.toBe(seeded.kb.id);
    expect(res.body.counts.entities).toBe(1);
    expect(res.body.counts.claims).toBe(1);
    expect(res.body.counts.notes).toBe(1);
    expect(res.body.counts.sources).toBe(1);
    expect(res.body.counts.citations).toBe(1);
    expect(res.body.counts.schemaDefinitions).toBe(1);
    expect(res.body.counts.rules).toBe(1);

    // New records exist under the new KB with fresh ids.
    const newEntities = ctx.entityStore.rows.filter((e) => e.knowledgeBaseId === newKbId);
    const newClaims = ctx.claimStore.rows.filter((c) => c.knowledgeBaseId === newKbId);
    expect(newEntities).toHaveLength(1);
    expect(newEntities[0]!.id).not.toBe(seeded.entity.id);
    // Claim argument points at the NEW entity id (remapped), not the old one.
    const arg = newClaims[0]!.arguments[0]!;
    expect(arg.entityId).toBe(newEntities[0]!.id);
    expect(arg.entityId).not.toBe(seeded.entity.id);
    // Entity schemaVersionId remapped to a version belonging to the new KB schema.
    expect(newEntities[0]!.schemaVersionId).not.toBe(seeded.entity.schemaVersionId);
    expect(newEntities[0]!.schemaVersionId).not.toBeNull();
  });

  it('fails preflight when a claim argument references a missing entity (no KB created)', async () => {
    const { agent, csrf, userId } = await setupAdmin(ctx.app);
    const seeded = await seedSourceKb(ctx, userId);
    const exported = (
      await agent.get(`/api/knowledge-bases/${seeded.kb.id}/export/json`).expect(200)
    ).body;
    // Corrupt the reference.
    exported.data.claims[0].arguments[0].entityId = '99999999-9999-9999-9999-999999999999';
    const kbCountBefore = (await ctx.kbStore.listForUser(userId)).length;
    await agent
      .post('/api/knowledge-bases/import-portable')
      .set('x-csrf-token', csrf)
      .send(exported)
      .expect(400);
    const kbCountAfter = (await ctx.kbStore.listForUser(userId)).length;
    expect(kbCountAfter).toBe(kbCountBefore);
  });
});
