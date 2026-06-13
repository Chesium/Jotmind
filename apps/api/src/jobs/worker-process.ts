import { closeDb } from '../db/client.js';
import { defaultJobHandlers } from './handlers.js';
import { dbJobStore } from './store.js';
import { runWorkerLoop } from './worker.js';

/**
 * Separate-process worker mode (US-007 AC2). Run with
 * `pnpm --filter @jotmind/api worker` (needs `DATABASE_URL`). Polls the durable
 * `jobs` table and runs registered handlers; the same logic can run in-process
 * via `startInProcessWorker`.
 */
async function main(): Promise<void> {
  const controller = new AbortController();
  const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1_000);

  const shutdown = (signal: string): void => {
    console.log(`[jotmind-worker] received ${signal}, shutting down…`);
    controller.abort();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('[jotmind-worker] starting (separate-process mode)');
  await runWorkerLoop({
    store: dbJobStore,
    handlers: defaultJobHandlers,
    pollIntervalMs,
    signal: controller.signal,
  });
  await closeDb();
  console.log('[jotmind-worker] stopped');
}

main().catch((err) => {
  console.error('[jotmind-worker] fatal error', err);
  process.exit(1);
});
