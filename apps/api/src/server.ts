import { createApp } from './app.js';
import { defaultJobHandlers } from './jobs/handlers.js';
import { startInProcessWorker, type InProcessWorker } from './jobs/worker.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3001);

// Loopback by default (US-033 AC4); LAN/public binding is an explicit opt-in
// via the HOST env var.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`[jotmind-api] listening on http://${HOST}:${PORT}`);
  if (!LOOPBACK_HOSTS.has(HOST)) {
    console.warn(
      `[jotmind-api] WARNING: bound to non-loopback host ${HOST} — the API is reachable beyond this machine. ` +
        `Ensure authentication is set up (complete first-run admin setup), set CORS_ALLOWED_ORIGINS, ` +
        `and put it behind HTTPS/a trusted TLS reverse proxy before exposing it publicly (see docs/deployment.md).`,
    );
  }
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
