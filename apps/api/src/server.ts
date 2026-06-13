import { createApp } from './app.js';
import { defaultJobHandlers } from './jobs/handlers.js';
import { startInProcessWorker, type InProcessWorker } from './jobs/worker.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3001);

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`[jotmind-api] listening on http://${HOST}:${PORT}`);
});

// Optionally run the durable-jobs worker in-process (US-007 AC2). For
// production scale-out run the dedicated worker process instead
// (`pnpm --filter @jotmind/api worker`).
let inProcessWorker: InProcessWorker | undefined;
if (process.env.WORKER_INLINE === 'true') {
  inProcessWorker = startInProcessWorker({ handlers: defaultJobHandlers });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void inProcessWorker?.stop();
  });
}
