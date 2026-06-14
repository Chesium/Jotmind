import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { graphProjectionStatusSchema, type OutboxStatus } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { GraphOutboxRow, JobRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import type { JobStore } from '../jobs/store.js';
import {
  getProjectionStatus,
  processOutbox,
  rebuildProjection,
  stubProjector,
  type ProjectionLifecycleStatus,
  type ProjectionStatusStore,
  type ProjectionStore,
  type ProjectionTarget,
  type Projector,
} from './projector.js';
import { outboxEventType } from './outbox.js';

/** In-memory ProjectionStatusStore for unit tests (no DB). */
function createMemoryStatusStore(): ProjectionStatusStore & {
  current(): ProjectionLifecycleStatus;
} {
  let status: ProjectionLifecycleStatus = {
    state: 'synchronized',
    activeKnowledgeBaseId: null,
    lastJobId: null,
    lastRebuildStartedAt: null,
    lastSynchronizedAt: null,
    failedAt: null,
    lastError: null,
    updatedAt: null,
  };
  return {
    current: () => status,
    get: () => Promise.resolve(status),
    markRebuilding: (input) => {
      status = {
        ...status,
        state: 'rebuilding',
        activeKnowledgeBaseId: input?.knowledgeBaseId ?? null,
        lastJobId: input?.jobId ?? null,
        lastRebuildStartedAt: new Date().toISOString(),
        lastError: null,
        failedAt: null,
        updatedAt: new Date().toISOString(),
      };
      return Promise.resolve();
    },
    markSynchronized: () => {
      status = {
        ...status,
        state: 'synchronized',
        activeKnowledgeBaseId: null,
        lastSynchronizedAt: new Date().toISOString(),
        lastError: null,
        failedAt: null,
        updatedAt: new Date().toISOString(),
      };
      return Promise.resolve();
    },
    markFailed: (error) => {
      status = {
        ...status,
        state: 'failed',
        failedAt: new Date().toISOString(),
        lastError: error,
        updatedAt: new Date().toISOString(),
      };
      return Promise.resolve();
    },
  };
}

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

/** In-memory ProjectionStore for unit tests (no DB). */
function createMemoryProjectionStore(): ProjectionStore & {
  add(
    row: Partial<GraphOutboxRow> & Pick<GraphOutboxRow, 'targetType' | 'targetId'>,
  ): GraphOutboxRow;
  addTarget(t: ProjectionTarget): void;
  all(): GraphOutboxRow[];
} {
  const events: GraphOutboxRow[] = [];
  const targets: ProjectionTarget[] = [];

  return {
    add(row) {
      const now = new Date();
      const full: GraphOutboxRow = {
        id: randomUUID(),
        knowledgeBaseId: row.knowledgeBaseId ?? randomUUID(),
        eventType: row.eventType ?? `${row.targetType}.created`,
        targetType: row.targetType,
        targetId: row.targetId,
        payload: row.payload ?? {},
        status: row.status ?? 'pending',
        attempts: row.attempts ?? 0,
        lastError: row.lastError ?? null,
        runAfter: row.runAfter ?? now,
        processedAt: row.processedAt ?? null,
        createdAt: row.createdAt ?? now,
        updatedAt: row.updatedAt ?? now,
      };
      events.push(full);
      return full;
    },
    addTarget(t) {
      targets.push(t);
    },
    all: () => events,
    claimPendingEvents: (limit) =>
      Promise.resolve(events.filter((e) => e.status === 'pending').slice(0, limit)),
    markEventProcessed: (id) => {
      const e = events.find((x) => x.id === id);
      if (e) {
        e.status = 'processed';
        e.processedAt = new Date();
        e.lastError = null;
      }
      return Promise.resolve();
    },
    markEventFailed: (id, error) => {
      const e = events.find((x) => x.id === id);
      if (e) {
        e.status = 'failed';
        e.attempts += 1;
        e.lastError = error;
      }
      return Promise.resolve();
    },
    countByStatus: () => {
      const counts: Record<OutboxStatus, number> = { pending: 0, processed: 0, failed: 0 };
      for (const e of events) {
        if (e.status === 'pending' || e.status === 'processed' || e.status === 'failed') {
          counts[e.status] += 1;
        }
      }
      return Promise.resolve(counts);
    },
    listCanonicalTargets: () => Promise.resolve([...targets]),
  };
}

/** A recording projector that captures every event it projects. */
function recordingProjector(opts: { fail?: boolean } = {}): Projector & {
  seen: { targetType: string; targetId: string; eventType: string }[];
} {
  const seen: { targetType: string; targetId: string; eventType: string }[] = [];
  return {
    name: 'recording',
    stubbed: false,
    seen,
    project: (event) => {
      if (opts.fail) return Promise.reject(new Error('boom'));
      seen.push({
        targetType: event.targetType,
        targetId: event.targetId,
        eventType: event.eventType,
      });
      return Promise.resolve();
    },
  };
}

describe('graph outbox helpers', () => {
  it('composes outbox event_type strings', () => {
    expect(outboxEventType('entity', 'created')).toBe('entity.created');
    expect(outboxEventType('claim', 'deleted')).toBe('claim.deleted');
  });
});

describe('graph projection runner', () => {
  it('processes pending events and marks them processed', async () => {
    const store = createMemoryProjectionStore();
    store.add({ targetType: 'entity', targetId: randomUUID() });
    store.add({ targetType: 'claim', targetId: randomUUID() });
    const projector = recordingProjector();

    const result = await processOutbox({ store, projector });

    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(projector.seen).toHaveLength(2);
    expect(store.all().every((e) => e.status === 'processed')).toBe(true);
  });

  it('marks events failed and records the error when the projector throws', async () => {
    const store = createMemoryProjectionStore();
    store.add({ targetType: 'note', targetId: randomUUID() });
    const projector = recordingProjector({ fail: true });

    const result = await processOutbox({ store, projector });

    expect(result).toEqual({ processed: 0, failed: 1 });
    const event = store.all()[0]!;
    expect(event.status).toBe('failed');
    expect(event.attempts).toBe(1);
    expect(event.lastError).toBe('boom');
  });

  it('does not reprocess already-processed events', async () => {
    const store = createMemoryProjectionStore();
    store.add({ targetType: 'entity', targetId: randomUUID(), status: 'processed' });
    const projector = recordingProjector();

    const result = await processOutbox({ store, projector });
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(projector.seen).toHaveLength(0);
  });
});

describe('graph projection rebuild', () => {
  it('reprojects every canonical record and drives status to synchronized', async () => {
    const store = createMemoryProjectionStore();
    const statusStore = createMemoryStatusStore();
    const kb = randomUUID();
    store.addTarget({ knowledgeBaseId: kb, targetType: 'entity', targetId: randomUUID() });
    store.addTarget({ knowledgeBaseId: kb, targetType: 'note', targetId: randomUUID() });
    const projector = recordingProjector();

    const result = await rebuildProjection({ store, projector, statusStore });

    expect(result.reprojected).toBe(2);
    expect(projector.seen).toHaveLength(2);
    expect(projector.seen.map((s) => s.eventType)).toEqual(['entity.rebuild', 'note.rebuild']);
    expect(statusStore.current().state).toBe('synchronized');
    expect(statusStore.current().lastSynchronizedAt).not.toBeNull();
  });

  it('calls prepareRebuild before reprojecting and clears the projection', async () => {
    const store = createMemoryProjectionStore();
    const statusStore = createMemoryStatusStore();
    store.addTarget({
      knowledgeBaseId: randomUUID(),
      targetType: 'entity',
      targetId: randomUUID(),
    });
    const calls: string[] = [];
    const projector: Projector = {
      name: 'recording',
      stubbed: false,
      prepareRebuild: () => {
        calls.push('prepare');
        return Promise.resolve();
      },
      project: (event) => {
        calls.push(`project:${event.targetType}`);
        return Promise.resolve();
      },
    };

    await rebuildProjection({ store, projector, statusStore });

    expect(calls).toEqual(['prepare', 'project:entity']);
  });

  it('marks the projection failed and rethrows when reprojection fails', async () => {
    const store = createMemoryProjectionStore();
    const statusStore = createMemoryStatusStore();
    store.addTarget({
      knowledgeBaseId: randomUUID(),
      targetType: 'entity',
      targetId: randomUUID(),
    });
    const projector = recordingProjector({ fail: true });

    await expect(rebuildProjection({ store, projector, statusStore })).rejects.toThrow('boom');
    expect(statusStore.current().state).toBe('failed');
    expect(statusStore.current().lastError).toBe('boom');
  });
});

describe('graph projection status', () => {
  it('reports state, the stub projector, and backlog counts', async () => {
    const store = createMemoryProjectionStore();
    const statusStore = createMemoryStatusStore();
    store.add({ targetType: 'entity', targetId: randomUUID() });
    store.add({ targetType: 'note', targetId: randomUUID(), status: 'processed' });

    const status = await getProjectionStatus({ store, projector: stubProjector, statusStore });

    expect(graphProjectionStatusSchema.parse(status)).toEqual(status);
    expect(status.state).toBe('synchronized');
    expect(status.projector).toEqual({ name: 'stub', stubbed: true });
    expect(status.counts).toEqual({ pending: 1, processed: 1, failed: 0 });
  });
});

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const MEMBER = { email: 'member@example.com', password: 'an0therpass!' };

describe('graph projection API', () => {
  let authStore: AuthStore;
  let projectionStore: ReturnType<typeof createMemoryProjectionStore>;
  let projectionStatusStore: ReturnType<typeof createMemoryStatusStore>;
  let jobStore: { enqueued: { type: string; payload: unknown }[] } & Pick<JobStore, 'enqueue'>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    authStore = createMemoryAuthStore();
    projectionStore = createMemoryProjectionStore();
    projectionStatusStore = createMemoryStatusStore();
    const enqueued: { type: string; payload: unknown }[] = [];
    jobStore = {
      enqueued,
      enqueue: (input) => {
        enqueued.push({ type: input.type, payload: input.payload });
        const now = new Date();
        const job: JobRow = {
          id: randomUUID(),
          type: input.type,
          payload: (input.payload as Record<string, unknown>) ?? {},
          status: 'queued',
          attempts: 0,
          maxAttempts: 5,
          runAfter: now,
          result: null,
          failureReason: null,
          knowledgeBaseId: input.knowledgeBaseId ?? null,
          ownerUserId: input.ownerUserId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        return Promise.resolve(job);
      },
    };
    // Use the stub projector so unit tests never touch a live AGE database.
    app = createApp({
      authStore,
      projectionStore,
      projectionStatusStore,
      projector: stubProjector,
      jobStore: jobStore as unknown as JobStore,
    });
  });

  it('requires authentication for status', async () => {
    const res = await request(app).get('/api/graph/projection/status');
    expect(res.status).toBe(401);
  });

  it('returns projection status to an authenticated user', async () => {
    projectionStore.add({ targetType: 'entity', targetId: randomUUID() });
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);

    const res = await agent.get('/api/graph/projection/status');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('synchronized');
    expect(res.body.projector).toEqual({ name: 'stub', stubbed: true });
    expect(res.body.counts.pending).toBe(1);
  });

  it('enqueues a rebuild job for an admin (does not block the app)', async () => {
    const agent = request.agent(app);
    const setup = await agent.post('/api/auth/setup').send(ADMIN);
    const csrf = setup.body.csrfToken as string;

    const res = await agent
      .post('/api/graph/projection/rebuild')
      .set('x-csrf-token', csrf)
      .send({});
    expect(res.status).toBe(202);
    expect(res.body.job.type).toBe('graph.projection.rebuild');
    expect(jobStore.enqueued).toHaveLength(1);
    expect(jobStore.enqueued[0]?.type).toBe('graph.projection.rebuild');
  });

  it('rejects process/rebuild for non-admins', async () => {
    const adminAgent = request.agent(app);
    const setup = await adminAgent.post('/api/auth/setup').send(ADMIN);
    const adminCsrf = setup.body.csrfToken as string;
    // Admin creates a plain member account.
    await adminAgent.post('/api/auth/users').set('x-csrf-token', adminCsrf).send(MEMBER);

    const memberAgent = request.agent(app);
    const login = await memberAgent.post('/api/auth/login').send(MEMBER);
    const memberCsrf = login.body.csrfToken as string;

    const res = await memberAgent
      .post('/api/graph/projection/process')
      .set('x-csrf-token', memberCsrf)
      .send({});
    expect(res.status).toBe(403);
  });

  it('lets an admin drain the outbox via the API', async () => {
    projectionStore.add({ targetType: 'entity', targetId: randomUUID() });
    projectionStore.add({ targetType: 'claim', targetId: randomUUID() });
    const agent = request.agent(app);
    const setup = await agent.post('/api/auth/setup').send(ADMIN);
    const csrf = setup.body.csrfToken as string;

    const res = await agent
      .post('/api/graph/projection/process')
      .set('x-csrf-token', csrf)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 2, failed: 0 });

    const status = await agent.get('/api/graph/projection/status');
    expect(status.body.counts).toEqual({ pending: 0, processed: 2, failed: 0 });
  });

  it('requires CSRF for mutations', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);
    const res = await agent.post('/api/graph/projection/process').send({});
    expect(res.status).toBe(403);
  });
});
