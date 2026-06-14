import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Real-API e2e global setup (US-034 AC4/AC5): apply migrations to the test
 * PostgreSQL database, then reset public tables so the run starts clean
 * (first-run setup visible). Only runs when `E2E_REAL_API=1`.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_REAL_API !== '1') return;

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when E2E_REAL_API=1');
  }

  execFileSync('pnpm', ['--filter', '@jotmind/api', 'db:migrate'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  execFileSync('pnpm', ['--filter', '@jotmind/api', 'db:reset:test'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
