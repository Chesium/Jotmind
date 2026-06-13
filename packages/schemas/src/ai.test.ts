import { describe, expect, it } from 'vitest';
import {
  aiProviderConfigSchema,
  embeddingResultSchema,
  llmCompletionRequestSchema,
  portableAiProviderConfigSchema,
  providerConfigHasSecrets,
  toPortableProviderConfig,
} from './ai.js';

describe('aiProviderConfigSchema', () => {
  it('accepts a local ollama config with no credentials (AC2)', () => {
    const parsed = aiProviderConfigSchema.parse({ kind: 'ollama', name: 'Local Ollama' });
    expect(parsed.kind).toBe('ollama');
    // Default local base URL is applied.
    if (parsed.kind === 'ollama') expect(parsed.baseUrl).toBe('http://localhost:11434');
  });

  it('accepts an openai-compatible local endpoint without an api key (AC2)', () => {
    const parsed = aiProviderConfigSchema.parse({
      kind: 'openai-compatible',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234/v1',
    });
    expect(parsed.kind).toBe('openai-compatible');
  });

  it('requires an api key for the remote openai provider (AC3)', () => {
    expect(aiProviderConfigSchema.safeParse({ kind: 'openai', name: 'OpenAI' }).success).toBe(
      false,
    );
    const ok = aiProviderConfigSchema.parse({ kind: 'openai', name: 'OpenAI', apiKey: 'sk-test' });
    if (ok.kind === 'openai') {
      expect(ok.llmModel).toBe('gpt-4o-mini');
      expect(ok.embeddingModel).toBe('text-embedding-3-small');
    }
  });

  it('requires an api key for the remote anthropic provider (AC3)', () => {
    expect(aiProviderConfigSchema.safeParse({ kind: 'anthropic', name: 'Claude' }).success).toBe(
      false,
    );
    const ok = aiProviderConfigSchema.parse({
      kind: 'anthropic',
      name: 'Claude',
      apiKey: 'sk-ant',
    });
    if (ok.kind === 'anthropic') expect(ok.anthropicVersion).toBe('2023-06-01');
  });

  it('rejects an unknown provider kind', () => {
    expect(aiProviderConfigSchema.safeParse({ kind: 'gemini', name: 'x' }).success).toBe(false);
  });
});

describe('secret separation (AC4)', () => {
  it('strips secrets from a config for portable export', () => {
    const config = aiProviderConfigSchema.parse({
      kind: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-secret',
    });
    expect(providerConfigHasSecrets(config)).toBe(true);

    const portable = toPortableProviderConfig(config);
    expect('apiKey' in portable).toBe(false);
    expect(portable.name).toBe('OpenAI');
    // The portable schema also rejects/strips secret fields directly.
    const reparsed = portableAiProviderConfigSchema.parse({ ...portable, apiKey: 'leaked' });
    expect('apiKey' in reparsed).toBe(false);
  });

  it('reports configs with no secrets', () => {
    const config = aiProviderConfigSchema.parse({ kind: 'mock', name: 'Mock' });
    expect(providerConfigHasSecrets(config)).toBe(false);
    expect('apiKey' in toPortableProviderConfig(config)).toBe(false);
  });
});

describe('message + embedding shapes', () => {
  it('requires at least one message', () => {
    expect(llmCompletionRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      llmCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'hi' }],
      }).success,
    ).toBe(true);
  });

  it('validates an embedding result', () => {
    const parsed = embeddingResultSchema.parse({
      embeddings: [[0.1, 0.2]],
      model: 'mock',
      dimensions: 2,
    });
    expect(parsed.embeddings).toHaveLength(1);
  });
});
