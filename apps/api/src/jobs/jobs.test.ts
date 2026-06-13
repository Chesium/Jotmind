import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { jobStatsSchema, type JobStatus } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { JobRow, SessionRow, UserRow } from '../db/schema.js';
import { type AuthStore } from '../auth/index.js';
import {
  computeBackoffMs,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  processAvailableJobs,
  runNextJob,
  type JobHandlerRegistry,
} from './worker.js';
import type { EnqueueJobInput, JobStore, ListJobsFilter } from './store.js';

/** Minimal in-memory AuthStore (mirrors graph.test.ts) for setup/login. */
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

/** In-memory JobStore for unit tests (no DB). FIFO claim honoring runAfter. */
function createMemoryJobStore(): JobStore & { all(): JobRow[] } {
  const jobs: JobRow[] = [];

  return {
    all: () => jobs,
    enqueue(input: EnqueueJobInput) {
      const now = new Date();
      const row: JobRow = {
        id: randomUUID(),
        knowledgeBaseId: input.knowledgeBaseId ?? null,
        type: input.type,
        status: 'queued',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAfter: input.runAfter ?? now,
        payload: input.payload ?? {},
        result: null,
        failureReason: null,
        ownerUserId: input.ownerUserId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      jobs.push(row);
      return Promise.resolve(row);
    },
    claimNext(now = new Date()) {
      const candidates = jobs
        .filter((j) => j.status === 'queued' && j.runAfter.getTime() <= now.getTime())
        .sort(
          (a, b) =>
            a.runAfter.getTime() - b.runAfter.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        );
      const job = candidates[0];
      if (!job) return Promise.resolve(undefined);
      job.status = 'running';
      job.attempts += 1;
      job.updatedAt = new Date();
      return Promise.resolve(job);
    },
    markSucceeded(id, result) {
      const job = jobs.find((j) => j.id === id);
      if (job) {
        job.status = 'succeeded';
        job.result = result ?? {};
        job.failureReason = null;
        job.updatedAt = new Date();
      }
      return Promise.resolve(job);
    },
    markForRetry(id, failureReason, runAfter) {
      const job = jobs.find((j) => j.id === id);
      if (job) {
        job.status = 'queued';
        job.failureReason = failureReason;
        job.runAfter = runAfter;
        job.updatedAt = new Date();
      }
      return Promise.resolve(job);
    },
    markFailed(id, failureReason) {
      const job = jobs.find((j) => j.id === id);
      if (job) {
        job.status = 'failed';
        job.failureReason = failureReason;
        job.updatedAt = new Date();
      }
      return Promise.resolve(job);
    },
    getById(id) {
      return Promise.resolve(jobs.find((j) => j.id === id));
    },
    list(filter: ListJobsFilter = {}) {
      let out = [...jobs];
      if (filter.status) out = out.filter((j) => j.status === filter.status);
      if (filter.knowledgeBaseId)
        out = out.filter((j) => j.knowledgeBaseId === filter.knowledgeBaseId);
      out.sort(
        (a, b) =>
          a.runAfter.getTime() - b.runAfter.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return Promise.resolve(out.slice(0, filter.limit ?? 100));
    },
    countByStatus() {
      const counts: Record<JobStatus, number> = {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      };
      for (const j of jobs) counts[j.status as JobStatus] += 1;
      return Promise.resolve(counts);
    },
  };
}

describe('computeBackoffMs', () => {
  it('grows exponentially from the base delay', () => {
    expect(computeBackoffMs(1)).toBe(DEFAULT_BASE_DELAY_MS);
    expect(computeBackoffMs(2)).toBe(DEFAULT_BASE_DELAY_MS * 2);
    expect(computeBackoffMs(3)).toBe(DEFAULT_BASE_DELAY_MS * 4);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeBackoffMs(100)).toBe(DEFAULT_MAX_DELAY_MS);
    expect(computeBackoffMs(5, { baseDelayMs: 10, maxDelayMs: 50 })).toBe(50);
  });

  it('honors a custom base delay', () => {
    expect(computeBackoffMs(1, { baseDelayMs: 250 })).toBe(250);
    expect(computeBackoffMs(2, { baseDelayMs: 250 })).toBe(500);
  });
});

describe('runNextJob', () => {
  const handlers: JobHandlerRegistry = {
    ok: (job) => Promise.resolve({ echoed: job.payload }),
    boom: () => Promise.reject(new Error('kaboom')),
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns undefined when no job is runnable', async () => {
    const store = createMemoryJobStore();
    expect(await runNextJob({ store, handlers })).toBeUndefined();
  });

  it('runs the handler and marks the job succeeded', async () => {
    const store = createMemoryJobStore();
    await store.enqueue({ type: 'ok', payload: { a: 1 } });

    const result = await runNextJob({ store, handlers });

    expect(result?.outcome).toBe('succeeded');
    expect(result?.job.status).toBe('succeeded');
    expect(result?.job.attempts).toBe(1);
    expect(result?.job.result).toEqual({ echoed: { a: 1 } });
  });

  it('dead-letters a job with no registered handler', async () => {
    const store = createMemoryJobStore();
    await store.enqueue({ type: 'unknown' });

    const result = await runNextJob({ store, handlers });

    expect(result?.outcome).toBe('no-handler');
    expect(result?.job.status).toBe('failed');
    expect(result?.job.failureReason).toContain('No handler');
  });

  it('retries with capped exponential backoff before dead-lettering', async () => {
    const store = createMemoryJobStore();
    const base = new Date('2026-06-13T00:00:00.000Z');
    await store.enqueue({ type: 'boom', maxAttempts: 3, runAfter: base });
    const opts = { store, handlers, baseDelayMs: 1_000, maxDelayMs: 10_000, now: () => base };

    // Attempt 1 → retry, runAfter = base + 1s
    let result = await runNextJob(opts);
    expect(result?.outcome).toBe('retried');
    expect(result?.job.status).toBe('queued');
    expect(result?.job.attempts).toBe(1);
    expect(result?.job.runAfter.getTime()).toBe(base.getTime() + 1_000);

    // Not runnable yet (runAfter in the future relative to `base`).
    expect(await runNextJob(opts)).toBeUndefined();

    // Advance the clock so the retry is runnable. Attempt 2 → retry, +2s.
    const later = new Date(base.getTime() + 60_000);
    result = await runNextJob({ ...opts, now: () => later });
    expect(result?.outcome).toBe('retried');
    expect(result?.job.attempts).toBe(2);
    expect(result?.job.runAfter.getTime()).toBe(later.getTime() + 2_000);

    // Attempt 3 reaches maxAttempts → dead-letter.
    const evenLater = new Date(later.getTime() + 60_000);
    result = await runNextJob({ ...opts, now: () => evenLater });
    expect(result?.outcome).toBe('failed');
    expect(result?.job.status).toBe('failed');
    expect(result?.job.attempts).toBe(3);
    expect(result?.job.failureReason).toBe('kaboom');
  });
});

describe('processAvailableJobs', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('drains all currently-runnable jobs and summarizes outcomes', async () => {
    const store = createMemoryJobStore();
    const handlers: JobHandlerRegistry = {
      ok: () => Promise.resolve(),
      boom: () => Promise.reject(new Error('x')),
    };
    await store.enqueue({ type: 'ok' });
    await store.enqueue({ type: 'ok' });
    await store.enqueue({ type: 'boom' }); // will retry, then become non-runnable
    await store.enqueue({ type: 'unknown' });

    const summary = await processAvailableJobs({ store, handlers, baseDelayMs: 10_000 });

    expect(summary.processed).toBe(4);
    expect(summary.succeeded).toBe(2);
    expect(summary.retried).toBe(1);
    expect(summary.noHandler).toBe(1);
  });
});

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };
const MEMBER = { email: 'member@example.com', password: 'an0therpass!' };

describe('jobs admin/status API', () => {
  let authStore: AuthStore;
  let jobStore: ReturnType<typeof createMemoryJobStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    authStore = createMemoryAuthStore();
    jobStore = createMemoryJobStore();
    app = createApp({ authStore, jobStore });
  });

  it('requires authentication to list jobs', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin accounts', async () => {
    const adminAgent = request.agent(app);
    const setup = await adminAgent.post('/api/auth/setup').send(ADMIN);
    const adminCsrf = setup.body.csrfToken as string;
    await adminAgent.post('/api/auth/users').set('x-csrf-token', adminCsrf).send(MEMBER);

    const memberAgent = request.agent(app);
    await memberAgent.post('/api/auth/login').send(MEMBER);

    const res = await memberAgent.get('/api/jobs');
    expect(res.status).toBe(403);
  });

  it('lists jobs and filters by status for admins', async () => {
    await jobStore.enqueue({ type: 'ok' });
    const failed = await jobStore.enqueue({ type: 'boom' });
    await jobStore.markFailed(failed.id, 'nope');

    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);

    const all = await agent.get('/api/jobs');
    expect(all.status).toBe(200);
    expect(all.body.jobs).toHaveLength(2);

    const onlyFailed = await agent.get('/api/jobs?status=failed');
    expect(onlyFailed.body.jobs).toHaveLength(1);
    expect(onlyFailed.body.jobs[0].status).toBe('failed');
    expect(onlyFailed.body.jobs[0].failureReason).toBe('nope');
  });

  it('rejects an invalid status filter', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);
    const res = await agent.get('/api/jobs?status=bogus');
    expect(res.status).toBe(400);
  });

  it('returns per-status counts via /stats', async () => {
    await jobStore.enqueue({ type: 'ok' });
    await jobStore.enqueue({ type: 'ok' });
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);

    const res = await agent.get('/api/jobs/stats');
    expect(res.status).toBe(200);
    expect(jobStatsSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.queued).toBe(2);
  });

  it('fetches a single job and 404s for unknown ids', async () => {
    const job = await jobStore.enqueue({ type: 'ok', payload: { hi: true } });
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send(ADMIN);

    const found = await agent.get(`/api/jobs/${job.id}`);
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(job.id);
    expect(found.body.payload).toEqual({ hi: true });

    const missing = await agent.get(`/api/jobs/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});
