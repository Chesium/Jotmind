import { describe, expect, it } from 'vitest';
import { assertMockOnlyAiConfig, blockRealAiKeys, REAL_AI_KEY_ENV_VARS } from './verify-env.js';

describe('verify-env AI guard (US-034 AC2)', () => {
  it('strips every real AI key env var', () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'sk-real',
      ANTHROPIC_API_KEY: 'ak-real',
      OPENAI_COMPATIBLE_API_KEY: 'oc-real',
      AI_API_KEY: 'ai-real',
      KEEP_ME: 'yes',
    };
    blockRealAiKeys(env);
    for (const key of REAL_AI_KEY_ENV_VARS) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.KEEP_ME).toBe('yes');
  });

  it('is a no-op when JOTMIND_VERIFY is not set', () => {
    expect(() =>
      assertMockOnlyAiConfig({ AI_PROVIDER_CONFIG: '{"kind":"openai","apiKey":"sk"}' }),
    ).not.toThrow();
  });

  it('allows a mock provider config under JOTMIND_VERIFY', () => {
    expect(() =>
      assertMockOnlyAiConfig({
        JOTMIND_VERIFY: 'true',
        AI_PROVIDER_CONFIG: '{"kind":"mock","name":"Test"}',
      }),
    ).not.toThrow();
  });

  it('allows an absent config under JOTMIND_VERIFY', () => {
    expect(() => assertMockOnlyAiConfig({ JOTMIND_VERIFY: 'true' })).not.toThrow();
  });

  it('rejects a real provider config under JOTMIND_VERIFY', () => {
    expect(() =>
      assertMockOnlyAiConfig({
        JOTMIND_VERIFY: 'true',
        AI_PROVIDER_CONFIG: '{"kind":"openai","apiKey":"sk-real"}',
      }),
    ).toThrow(/blocks real AI providers/);
  });

  it('rejects a leaked apiKey on a mock config under JOTMIND_VERIFY', () => {
    expect(() =>
      assertMockOnlyAiConfig({
        JOTMIND_VERIFY: 'true',
        AI_PROVIDER_CONFIG: '{"kind":"mock","name":"Test","apiKey":"sk-real"}',
      }),
    ).toThrow(/apiKey/);
  });

  it('rejects malformed JSON under JOTMIND_VERIFY', () => {
    expect(() =>
      assertMockOnlyAiConfig({ JOTMIND_VERIFY: 'true', AI_PROVIDER_CONFIG: '{bad' }),
    ).toThrow(/valid mock JSON/);
  });
});
