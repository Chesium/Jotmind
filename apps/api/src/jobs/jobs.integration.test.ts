import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { jobs, knowledgeBases, users } from '../db/schema.js';
import { dbJobStore } from './store.js';
import { processAvailableJobs, runNextJob, type JobHandlerRegistry } from './worker.js';

/**
 * Integration tests for durable jobs (US-007). Skipped when DATABASE_URL is
 * unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(sql`TRUNCATE TABLE ${jobs}, ${knowledgeBases}, ${users} CASCADE`);
}

describe.skipIf(!hasDatabase)('durable jobs integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'jobs@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Jobs KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    if (hasDatabase) await truncateAll();
    await closeDb();
  });

  it('enqueues, claims atomically, and marks jobs succeeded', async () => {
    const job = await dbJobStore.enqueue({
      type: 'noop',
      payload: { a: 1 },
      knowledgeBaseId: kbId,
      ownerUserId: userId,
    });
    expect(job.status).toBe('queued');

    const handlers: JobHandlerRegistry = { noop: () => Promise.resolve({ done: true }) };
    const result = await runNextJob({ store: dbJobStore, handlers });

    expect(result?.outcome).toBe('succeeded');
    const fetched = await dbJobStore.getById(job.id);
    expect(fetched?.status).toBe('succeeded');
    expect(fetched?.attempts).toBe(1);
    expect(fetched?.result).toEqual({ done: true });

    // No more runnable jobs.
    expect(await dbJobStore.claimNext()).toBeUndefined();
  });

  it('retries with backoff and dead-letters after maxAttempts', async () => {
    const job = await dbJobStore.enqueue({ type: 'boom', maxAttempts: 2 });
    const handlers: JobHandlerRegistry = {
      boom: () => Promise.reject(new Error('always fails')),
    };

    // Attempt 1 → retry, runAfter pushed into the future.
    const t0 = new Date();
    const first = await runNextJob({ store: dbJobStore, handlers, now: () => t0 });
    expect(first?.outcome).toBe('retried');
    let fetched = await dbJobStore.getById(job.id);
    expect(fetched?.status).toBe('queued');
    expect(fetched?.attempts).toBe(1);
    expect(fetched!.runAfter.getTime()).toBeGreaterThan(t0.getTime());

    // Advance the clock past the backoff so the retry is runnable; attempt 2
    // reaches maxAttempts → dead-letter.
    const later = new Date(t0.getTime() + 60 * 60_000);
    const second = await runNextJob({ store: dbJobStore, handlers, now: () => later });
    expect(second?.outcome).toBe('failed');
    fetched = await dbJobStore.getById(job.id);
    expect(fetched?.status).toBe('failed');
    expect(fetched?.attempts).toBe(2);
    expect(fetched?.failureReason).toBe('always fails');
  });

  it('reports per-status counts and lists/filter jobs', async () => {
    await dbJobStore.enqueue({ type: 'noop' });
    await dbJobStore.enqueue({ type: 'noop' });
    const handlers: JobHandlerRegistry = { noop: () => Promise.resolve() };
    await processAvailableJobs({ store: dbJobStore, handlers });

    const counts = await dbJobStore.countByStatus();
    expect(counts.succeeded).toBe(2);
    expect(counts.queued).toBe(0);

    const succeeded = await dbJobStore.list({ status: 'succeeded' });
    expect(succeeded).toHaveLength(2);
  });
});
