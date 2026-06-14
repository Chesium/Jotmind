import { defineConfig } from 'vitest/config';

/**
 * Manual local-inference (Ollama) verification config (US-034 AC3).
 *
 * Used ONLY by `pnpm verify:local-ai` — it includes the `*.local-ai.test.ts`
 * files that the default `vitest.config.ts` excludes, so they never run during
 * routine loops or `pnpm verify`. These tests skip unless `OLLAMA_BASE_URL` is
 * set, so the command is safe to run without a local Ollama server.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.local-ai.test.ts'],
  },
});
