import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration test files (auth/kb/db) share one PostgreSQL database and
    // TRUNCATE the same tables in setup/teardown. Running test files in parallel
    // lets one file's TRUNCATE wipe another's fixtures mid-test (FK violations),
    // so disable cross-file parallelism. The API suite is small; the cost is
    // negligible and the default DATABASE_URL-less run is unaffected.
    fileParallelism: false,
  },
});
