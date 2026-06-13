import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { JobStatus } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { jobs, type JobRow } from '../db/schema.js';

export interface EnqueueJobInput {
  type: string;
  payload?: Record<string, unknown>;
  knowledgeBaseId?: string | null;
  ownerUserId?: string | null;
  /** Total attempts before the job is dead-lettered. Defaults to the DB default (5). */
  maxAttempts?: number;
  /** Earliest time the job may run. Defaults to now. */
  runAfter?: Date;
}

export interface ListJobsFilter {
  status?: JobStatus;
  knowledgeBaseId?: string;
  limit?: number;
}

/**
 * Persistence boundary for durable jobs (US-007). Defined as an interface so the
 * worker and router can be unit-tested with an in-memory fake (no live DB) while
 * production uses the PostgreSQL-backed {@link dbJobStore}.
 */
export interface JobStore {
  enqueue(input: EnqueueJobInput): Promise<JobRow>;
  /**
   * Atomically claim the next runnable job: the oldest `queued` job whose
   * `runAfter <= now`, transitioning it to `running` and incrementing
   * `attempts`. Uses `FOR UPDATE SKIP LOCKED` so multiple workers (in-process or
   * separate-process) never claim the same job. Returns undefined if none.
   */
  claimNext(now?: Date): Promise<JobRow | undefined>;
  markSucceeded(id: string, result?: Record<string, unknown>): Promise<JobRow | undefined>;
  /** Re-queue a failed-but-retryable job with a future `runAfter` (backoff). */
  markForRetry(id: string, failureReason: string, runAfter: Date): Promise<JobRow | undefined>;
  /** Move a job to the terminal `failed` (dead-letter) state. */
  markFailed(id: string, failureReason: string): Promise<JobRow | undefined>;
  getById(id: string): Promise<JobRow | undefined>;
  list(filter?: ListJobsFilter): Promise<JobRow[]>;
  countByStatus(): Promise<Record<JobStatus, number>>;
}

const ZERO_COUNTS: Record<JobStatus, number> = {
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

/** PostgreSQL-backed JobStore. Resolves the Drizzle client per call. */
export const dbJobStore: JobStore = {
  async enqueue(input) {
    const rows = await getDb()
      .insert(jobs)
      .values({
        type: input.type,
        payload: input.payload ?? {},
        knowledgeBaseId: input.knowledgeBaseId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
      })
      .returning();
    const job = rows[0];
    if (!job) throw new Error('Failed to enqueue job');
    return job;
  },

  async claimNext(now = new Date()) {
    return getDb().transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'queued'), lte(jobs.runAfter, now)))
        .orderBy(asc(jobs.runAfter), asc(jobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      const job = candidates[0];
      if (!job) return undefined;
      const updated = await tx
        .update(jobs)
        .set({ status: 'running', attempts: job.attempts + 1, updatedAt: new Date() })
        .where(eq(jobs.id, job.id))
        .returning();
      return updated[0];
    });
  },

  async markSucceeded(id, result) {
    const rows = await getDb()
      .update(jobs)
      .set({
        status: 'succeeded',
        result: result ?? {},
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
      .returning();
    return rows[0];
  },

  async markForRetry(id, failureReason, runAfter) {
    const rows = await getDb()
      .update(jobs)
      .set({ status: 'queued', failureReason, runAfter, updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning();
    return rows[0];
  },

  async markFailed(id, failureReason) {
    const rows = await getDb()
      .update(jobs)
      .set({ status: 'failed', failureReason, updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning();
    return rows[0];
  },

  async getById(id) {
    const rows = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return rows[0];
  },

  async list(filter = {}) {
    const conditions = [];
    if (filter.status) conditions.push(eq(jobs.status, filter.status));
    if (filter.knowledgeBaseId) conditions.push(eq(jobs.knowledgeBaseId, filter.knowledgeBaseId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return getDb()
      .select()
      .from(jobs)
      .where(where)
      .orderBy(asc(jobs.runAfter), asc(jobs.createdAt))
      .limit(filter.limit ?? 100);
  },

  async countByStatus() {
    const rows = await getDb()
      .select({ status: jobs.status, count: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status);
    const counts: Record<JobStatus, number> = { ...ZERO_COUNTS };
    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as JobStatus] = row.count;
      }
    }
    return counts;
  },
};
