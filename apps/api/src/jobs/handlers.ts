import type { JobHandlerRegistry } from './worker.js';

/**
 * Registry of job handlers keyed by job `type`. Later stories register their
 * handlers here (US-018 AI proposals, US-021 embeddings, imports/exports, and
 * the AGE projection worker). The built-in `noop` handler exists so the worker
 * can be smoke-tested end-to-end before those land.
 */
export const defaultJobHandlers: JobHandlerRegistry = {
  noop: (job) => Promise.resolve({ ok: true, jobId: job.id }),
};
