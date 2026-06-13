import type { JobRow } from '../db/schema.js';
import { dbJobStore, type JobStore } from './store.js';

/**
 * Durable job worker (US-007). Claims jobs from a {@link JobStore}, runs the
 * registered handler for each job's `type`, and on failure retries with capped
 * exponential backoff until `maxAttempts` is reached, at which point the job is
 * moved to the terminal `failed` (dead-letter) state.
 *
 * The same primitives power both run modes:
 *   - in-process: call {@link startInProcessWorker} (e.g. from the API server),
 *   - separate-process: run `worker-process.ts` which calls {@link runWorkerLoop}.
 */

export interface BackoffOptions {
  /** Delay before the first retry. Defaults to 1s. */
  baseDelayMs?: number;
  /** Maximum delay between retries (the cap). Defaults to 5min. */
  maxDelayMs?: number;
}

export const DEFAULT_BASE_DELAY_MS = 1_000;
export const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

/**
 * Capped exponential backoff. `attempts` is the number of attempts already made
 * (>= 1). Delay = base * 2^(attempts-1), clamped to `maxDelayMs`.
 */
export function computeBackoffMs(attempts: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const cap = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const exponent = Math.max(0, attempts - 1);
  const delay = base * 2 ** exponent;
  return Math.min(delay, cap);
}

/** Handler for a single job type. Returning a value stores it as the job result. */
export type JobHandler = (job: JobRow) => Promise<Record<string, unknown> | void>;
/** Map of job `type` → handler. */
export type JobHandlerRegistry = Record<string, JobHandler>;

export type JobOutcome = 'succeeded' | 'retried' | 'failed' | 'no-handler';

export interface RunJobOptions extends BackoffOptions {
  store?: JobStore;
  handlers: JobHandlerRegistry;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export interface RunJobResult {
  job: JobRow;
  outcome: JobOutcome;
}

/**
 * Claim and run a single job. Returns undefined when no job is currently
 * runnable. On handler failure, retries with backoff or dead-letters once
 * `attempts >= maxAttempts`.
 */
export async function runNextJob(options: RunJobOptions): Promise<RunJobResult | undefined> {
  const store = options.store ?? dbJobStore;
  const now = options.now ?? (() => new Date());

  const job = await store.claimNext(now());
  if (!job) return undefined;

  const handler = options.handlers[job.type];
  if (!handler) {
    const reason = `No handler registered for job type "${job.type}"`;
    const updated = await store.markFailed(job.id, reason);
    console.error(`[jotmind-worker] job ${job.id} (${job.type}): ${reason}`);
    return { job: updated ?? job, outcome: 'no-handler' };
  }

  try {
    const result = await handler(job);
    const updated = await store.markSucceeded(job.id, result ?? {});
    return { job: updated ?? job, outcome: 'succeeded' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown job error';
    // `job.attempts` already reflects the just-claimed attempt.
    if (job.attempts >= job.maxAttempts) {
      const updated = await store.markFailed(job.id, reason);
      console.error(
        `[jotmind-worker] job ${job.id} (${job.type}) dead-lettered after ${job.attempts} attempt(s): ${reason}`,
      );
      return { job: updated ?? job, outcome: 'failed' };
    }
    const delay = computeBackoffMs(job.attempts, options);
    const runAfter = new Date(now().getTime() + delay);
    const updated = await store.markForRetry(job.id, reason, runAfter);
    console.warn(
      `[jotmind-worker] job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.maxAttempts}), retrying in ${delay}ms: ${reason}`,
    );
    return { job: updated ?? job, outcome: 'retried' };
  }
}

export interface ProcessJobsSummary {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  noHandler: number;
}

/**
 * Drain currently-runnable jobs until none remain (or `maxJobs` is reached).
 * Jobs scheduled for the future via backoff are not picked up by this pass.
 */
export async function processAvailableJobs(
  options: RunJobOptions & { maxJobs?: number },
): Promise<ProcessJobsSummary> {
  const summary: ProcessJobsSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    noHandler: 0,
  };
  const max = options.maxJobs ?? Number.POSITIVE_INFINITY;
  while (summary.processed < max) {
    const result = await runNextJob(options);
    if (!result) break;
    summary.processed += 1;
    switch (result.outcome) {
      case 'succeeded':
        summary.succeeded += 1;
        break;
      case 'retried':
        summary.retried += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'no-handler':
        summary.noHandler += 1;
        break;
    }
  }
  return summary;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface WorkerLoopOptions extends RunJobOptions {
  /** Poll interval when no job is available. Defaults to 1s. */
  pollIntervalMs?: number;
  /** Abort to stop the loop gracefully (e.g. on SIGTERM). */
  signal?: AbortSignal;
}

/**
 * Long-running worker loop for separate-process mode. Continuously claims and
 * runs jobs, sleeping `pollIntervalMs` whenever the queue is empty. Resolves
 * when `signal` is aborted.
 */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const poll = options.pollIntervalMs ?? 1_000;
  while (!options.signal?.aborted) {
    let result: RunJobResult | undefined;
    try {
      result = await runNextJob(options);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown worker error';
      console.error(`[jotmind-worker] unexpected error claiming/running job: ${reason}`);
    }
    if (!result) {
      await sleep(poll, options.signal);
    }
  }
}

export interface InProcessWorker {
  /** Stop the worker loop and resolve when it has fully stopped. */
  stop(): Promise<void>;
}

/**
 * Start the worker in-process (e.g. alongside the API server) without blocking.
 * Returns a handle whose `stop()` aborts the loop. Use separate-process mode
 * (worker-process.ts) for production scale-out.
 */
export function startInProcessWorker(options: Omit<WorkerLoopOptions, 'signal'>): InProcessWorker {
  const controller = new AbortController();
  const done = runWorkerLoop({ ...options, signal: controller.signal });
  console.log('[jotmind-worker] in-process worker started');
  return {
    async stop() {
      controller.abort();
      await done;
      console.log('[jotmind-worker] in-process worker stopped');
    },
  };
}
