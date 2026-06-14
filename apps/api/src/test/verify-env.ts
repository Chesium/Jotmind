/**
 * Verify-time AI safety guard (US-034 AC2).
 *
 * `pnpm verify` runs `test:api` with `JOTMIND_VERIFY=true`. In that mode no real
 * AI adapter credentials may be present and the only permitted env-driven AI
 * provider is the deterministic local `mock`. This keeps the authoritative agent
 * loop / CI check from ever reaching a remote provider, and forces every AI /
 * embedding assertion onto the mock provider.
 *
 * This module is registered as a Vitest `setupFile` (see `vitest.config.ts`) so
 * it runs before every API test file. It ALWAYS strips real provider key env
 * vars (so an adapter can never accidentally pick one up), and — under
 * `JOTMIND_VERIFY` — additionally rejects any non-mock `AI_PROVIDER_CONFIG`.
 */

/** Standalone credential env vars a real provider could read. */
export const REAL_AI_KEY_ENV_VARS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'AI_API_KEY',
] as const;

/** Remove real provider credentials so no adapter can use them during tests. */
export function blockRealAiKeys(env: NodeJS.ProcessEnv): void {
  for (const key of REAL_AI_KEY_ENV_VARS) {
    delete env[key];
  }
}

/**
 * Under `JOTMIND_VERIFY=true`, assert the env-driven AI provider is mock-only.
 * Throws (failing the test run) on a real/remote provider or any leaked apiKey.
 * A no-op when `JOTMIND_VERIFY` is not set or `AI_PROVIDER_CONFIG` is absent.
 */
export function assertMockOnlyAiConfig(env: NodeJS.ProcessEnv): void {
  if (env.JOTMIND_VERIFY !== 'true') return;

  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'JOTMIND_VERIFY: AI_PROVIDER_CONFIG must be absent or valid mock JSON during pnpm verify',
    );
  }

  const config = parsed as { kind?: unknown; apiKey?: unknown };
  if (config.kind !== 'mock') {
    throw new Error(
      `JOTMIND_VERIFY blocks real AI providers; AI_PROVIDER_CONFIG.kind must be "mock" (got ${String(
        config.kind,
      )})`,
    );
  }
  if (config.apiKey) {
    throw new Error('JOTMIND_VERIFY blocks AI_PROVIDER_CONFIG.apiKey during pnpm verify');
  }
}

blockRealAiKeys(process.env);
assertMockOnlyAiConfig(process.env);
