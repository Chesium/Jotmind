import { describe, expect, it } from 'vitest';
import {
  createConfiguredEmbeddingProvider,
  isRemoteProviderKind,
  resolveEmbeddingProviderFromEnv,
} from './provider.js';

describe('isRemoteProviderKind', () => {
  it('flags remote vendors', () => {
    expect(isRemoteProviderKind('openai')).toBe(true);
    expect(isRemoteProviderKind('anthropic')).toBe(true);
    expect(isRemoteProviderKind('ollama')).toBe(false);
    expect(isRemoteProviderKind('openai-compatible')).toBe(false);
    expect(isRemoteProviderKind('mock')).toBe(false);
  });
});

describe('createConfiguredEmbeddingProvider', () => {
  it('builds a local mock embedding provider', () => {
    const configured = createConfiguredEmbeddingProvider({
      kind: 'mock',
      name: 'Test',
      dimensions: 8,
    });
    expect(configured).not.toBeNull();
    expect(configured?.kind).toBe('mock');
    expect(configured?.remote).toBe(false);
    expect(configured?.provider.dimensions).toBe(8);
  });

  it('returns null for anthropic (no embedding endpoint)', () => {
    const configured = createConfiguredEmbeddingProvider({
      kind: 'anthropic',
      name: 'Claude',
      baseUrl: 'https://api.anthropic.com',
      llmModel: 'claude-3-5-sonnet-latest',
      anthropicVersion: '2023-06-01',
      apiKey: 'sk-test',
    });
    expect(configured).toBeNull();
  });

  it('flags a remote openai provider', () => {
    const configured = createConfiguredEmbeddingProvider({
      kind: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      llmModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
      apiKey: 'sk-test',
    });
    expect(configured?.remote).toBe(true);
    expect(configured?.model).toBe('text-embedding-3-small');
  });
});

describe('resolveEmbeddingProviderFromEnv', () => {
  it('returns null when AI_PROVIDER_CONFIG is unset', () => {
    expect(resolveEmbeddingProviderFromEnv({})).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(resolveEmbeddingProviderFromEnv({ AI_PROVIDER_CONFIG: 'not json' })).toBeNull();
  });

  it('builds a provider from valid config', () => {
    const configured = resolveEmbeddingProviderFromEnv({
      AI_PROVIDER_CONFIG: JSON.stringify({ kind: 'mock', name: 'Env Mock', dimensions: 16 }),
    });
    expect(configured?.kind).toBe('mock');
    expect(configured?.provider.dimensions).toBe(16);
  });
});
