import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { IMPORT_JOB_TYPE, type ImportJobPayload, type KbRole } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { JobRow, ProposalRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { JobStore } from '../jobs/store.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { CreateProposalInput, ProposalStore } from '../proposals/store.js';
import { runImport } from './runner.js';

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

function memoryJobStore(): JobStore & { rows: JobRow[] } {
  const rows: JobRow[] = [];
  return {
    rows,
    enqueue: (input) => {
      const now = new Date();
      const row: JobRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId ?? null,
        type: input.type,
        status: 'queued',
        payload: input.payload ?? {},
        result: {},
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAfter: input.runAfter ?? now,
        failureReason: null,
        ownerUserId: input.ownerUserId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    claimNext: () => Promise.resolve(undefined),
    markSucceeded: () => Promise.resolve(undefined),
    markForRetry: () => Promise.resolve(undefined),
    markFailed: () => Promise.resolve(undefined),
    getById: (id) => Promise.resolve(rows.find((r) => r.id === id)),
    list: (filter) =>
      Promise.resolve(
        rows.filter(
          (r) => !filter?.knowledgeBaseId || r.knowledgeBaseId === filter.knowledgeBaseId,
        ),
      ),
    countByStatus: () =>
      Promise.resolve({ queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }),
  };
}

/** In-memory ProposalStore that records created proposals (for runner tests). */
function memoryProposalStore(): ProposalStore & { created: CreateProposalInput[] } {
  const created: CreateProposalInput[] = [];
  return {
    created,
    listProposals: () => Promise.resolve([]),
    getProposal: () => Promise.resolve(undefined),
    createProposal: (input) => {
      created.push(input);
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
      return Promise.resolve(row);
    },
    updateProposalChanges: () => Promise.resolve(undefined),
    reviewProposal: () => Promise.resolve(undefined),
  };
}

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
const KB_ID = '11111111-1111-1111-1111-111111111111';

async function setupAdminAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const setup = await agent.post('/api/auth/setup').send(ADMIN);
  return { agent, userId: setup.body.user.id as string, csrf: setup.body.csrfToken as string };
}

function buildApp() {
  const authStore = createMemoryAuthStore();
  const kbStore = createMemoryKbStore();
  const jobStore = memoryJobStore();
  const app = createApp({ authStore, kbStore, jobStore });
  return { app, kbStore, jobStore };
}

describe('imports API (US-031)', () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it('requires authentication to enqueue an import', async () => {
    const res = await request(ctx.app)
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .send({ format: 'text', content: 'hi' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-members (hides existence)', async () => {
    const { agent } = await setupAdminAgent(ctx.app);
    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/imports`);
    expect(res.status).toBe(404);
  });

  it('forbids viewers from enqueuing imports (AC5)', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'viewer');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .set('x-csrf-token', csrf)
      .send({ format: 'text', content: 'hi' });
    expect(res.status).toBe(403);
  });

  it('rejects a mutation without a CSRF token', async () => {
    const { agent, userId } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .send({ format: 'text', content: 'hi' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid import body (400)', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .set('x-csrf-token', csrf)
      .send({ format: 'csv', content: 'name\nAda' }); // missing mapping
    expect(res.status).toBe(400);
  });

  it('enqueues an import job for an editor and returns 202 (AC4/AC5)', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    const res = await agent
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .set('x-csrf-token', csrf)
      .send({ format: 'text', target: 'note', content: 'Imported note body' });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    expect(res.body.status).toBe('queued');

    expect(ctx.jobStore.rows).toHaveLength(1);
    const job = ctx.jobStore.rows[0] as JobRow;
    expect(job.type).toBe(IMPORT_JOB_TYPE);
    expect(job.knowledgeBaseId).toBe(KB_ID);
    const payload = job.payload as unknown as ImportJobPayload;
    expect(payload.requestedBy).toBe(userId);
    expect(payload.request.format).toBe('text');
  });

  it('lists this KB import jobs (user-visible status, AC4)', async () => {
    const { agent, userId, csrf } = await setupAdminAgent(ctx.app);
    ctx.kbStore.setRole(KB_ID, userId, 'editor');
    await agent
      .post(`/api/knowledge-bases/${KB_ID}/imports`)
      .set('x-csrf-token', csrf)
      .send({ format: 'text', content: 'a' });
    // A non-import job in the same KB must be filtered out.
    await ctx.jobStore.enqueue({ type: 'noop', knowledgeBaseId: KB_ID });

    const res = await agent.get(`/api/knowledge-bases/${KB_ID}/imports`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].type).toBe(IMPORT_JOB_TYPE);
  });
});

describe('runImport (US-031 runner)', () => {
  const KB = '11111111-1111-1111-1111-111111111111';
  const USER = '22222222-2222-2222-2222-222222222222';

  it('builds a note proposal from a text import (AC1/AC3)', async () => {
    const store = memoryProposalStore();
    const result = await runImport(
      { proposalStore: store },
      {
        knowledgeBaseId: KB,
        requestedBy: USER,
        request: { format: 'text', target: 'note', title: 'T', content: 'body' },
      },
    );
    expect(result.status).toBe('created');
    expect(result.itemCount).toBe(1);
    expect(result.proposalId).toBeTruthy();
    expect(store.created).toHaveLength(1);
    const proposal = store.created[0] as CreateProposalInput;
    expect(proposal.kind).toBe('import');
    expect(proposal.changes.items[0]).toMatchObject({ op: 'create_note', content: 'body' });
  });

  it('builds an entity proposal from a CSV import (AC2/AC3)', async () => {
    const store = memoryProposalStore();
    const result = await runImport(
      { proposalStore: store },
      {
        knowledgeBaseId: KB,
        requestedBy: USER,
        request: {
          format: 'csv',
          content: 'name\nAda\nGrace',
          mapping: { target: 'entity', type: 'Person', nameColumn: 'name' },
        },
      },
    );
    expect(result.status).toBe('created');
    expect(result.itemCount).toBe(2);
    expect(result.rowCount).toBe(2);
    const proposal = store.created[0] as CreateProposalInput;
    expect(proposal.changes.items).toHaveLength(2);
    expect(proposal.changes.items.every((i) => i.op === 'create_entity')).toBe(true);
  });

  it('returns an error result (no proposal) for an unparseable CSV (AC4)', async () => {
    const store = memoryProposalStore();
    const result = await runImport(
      { proposalStore: store },
      {
        knowledgeBaseId: KB,
        requestedBy: USER,
        request: {
          format: 'csv',
          content: 'name\nAda',
          mapping: { target: 'entity', type: 'Person', nameColumn: 'missing' },
        },
      },
    );
    expect(result.status).toBe('error');
    expect(result.proposalId).toBeNull();
    expect(result.error).toMatch(/not found/i);
    expect(store.created).toHaveLength(0);
  });
});
