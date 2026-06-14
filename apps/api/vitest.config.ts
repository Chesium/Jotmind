import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration test files (auth/kb/db) share one PostgreSQL database and
    // TRUNCATE the same tables in setup/teardown. Running test files in parallel
    // lets one file's TRUNCATE wipe another's fixtures mid-test (FK violations),
    // so disable cross-file parallelism. The API suite is small; the cost is
    // negligible and the default DATABASE_URL-less run is unaffected.
    fileParallelism: false,
    // Verify-time AI safety guard (US-034 AC2): strips real provider keys and,
    // under JOTMIND_VERIFY, forces mock-only AI config.
    setupFiles: ['./src/test/verify-env.ts'],
    // Local-inference (Ollama) checks are EXCLUDED from the default run / pnpm
    // verify (US-034 AC3) — they run only via `pnpm verify:local-ai`.
    exclude: [...configDefaults.exclude, '**/*.local-ai.test.ts'],
  },
});
