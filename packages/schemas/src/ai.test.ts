import { describe, expect, it } from 'vitest';
import {
  aiProviderConfigSchema,
  buildRemoteAiAuditMetadata,
  DEFAULT_AI_POLICY,
  embeddingResultSchema,
  llmCompletionRequestSchema,
  portableAiProviderConfigSchema,
  providerConfigHasSecrets,
  REMOTE_AI_AUDIT_FORBIDDEN_KEYS,
  resolveAiPolicy,
  toPortableProviderConfig,
  updateAiPolicySchema,
  type AiPolicy,
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

describe('resolveAiPolicy (US-016)', () => {
  const off: AiPolicy = { mode: 'off', remoteEmbeddings: false };
  const localOnly: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };
  const perRequest: AiPolicy = { mode: 'remote_per_request', remoteEmbeddings: false };
  const always: AiPolicy = { mode: 'remote_always', remoteEmbeddings: true };

  it('defaults to No AI when no policies apply (AC1)', () => {
    const r = resolveAiPolicy([]);
    expect(r.mode).toBe('off');
    expect(r.remoteAllowed).toBe(false);
    expect(r.remoteEmbeddingsAllowed).toBe(false);
    expect(r.requiresPerRequestConfirmation).toBe(false);
  });

  it('the default policy is No AI (AC1)', () => {
    expect(DEFAULT_AI_POLICY).toEqual({ mode: 'off', remoteEmbeddings: false });
  });

  it('picks the strictest mode across layers (AC2)', () => {
    expect(resolveAiPolicy([always, always, perRequest]).mode).toBe('remote_per_request');
    expect(resolveAiPolicy([perRequest, always, always]).mode).toBe('remote_per_request');
    expect(resolveAiPolicy([always, localOnly, always]).mode).toBe('local_only');
    expect(resolveAiPolicy([always, always, off]).mode).toBe('off');
    expect(resolveAiPolicy([always, always, always]).mode).toBe('remote_always');
  });

  it('only allows remote_always when every layer selects it (AC3)', () => {
    expect(resolveAiPolicy([always, always, always]).requiresPerRequestConfirmation).toBe(false);
    expect(resolveAiPolicy([always, always, perRequest]).requiresPerRequestConfirmation).toBe(true);
  });

  it('requires every layer to consent to remote embeddings (AC4)', () => {
    expect(resolveAiPolicy([always, always, always]).remoteEmbeddingsAllowed).toBe(true);
    expect(
      resolveAiPolicy([always, always, { mode: 'remote_always', remoteEmbeddings: false }])
        .remoteEmbeddingsAllowed,
    ).toBe(false);
    // No remote embeddings when remote isn't allowed at all.
    expect(
      resolveAiPolicy([
        { mode: 'local_only', remoteEmbeddings: true },
        { mode: 'local_only', remoteEmbeddings: true },
      ]).remoteEmbeddingsAllowed,
    ).toBe(false);
  });
});

describe('updateAiPolicySchema (US-016)', () => {
  it('rejects an empty payload', () => {
    expect(updateAiPolicySchema.safeParse({}).success).toBe(false);
  });
  it('accepts a partial update', () => {
    expect(updateAiPolicySchema.safeParse({ mode: 'local_only' }).success).toBe(true);
    expect(updateAiPolicySchema.safeParse({ remoteEmbeddings: true }).success).toBe(true);
  });
});

describe('buildRemoteAiAuditMetadata (US-016 AC6)', () => {
  it('excludes prompts, content, api keys, and responses via allowlist', () => {
    const meta = buildRemoteAiAuditMetadata({
      provider: 'openai',
      model: 'gpt-4o-mini',
      feature: 'proposal_extraction',
      contentCategories: ['note_text'],
      tokenCounts: { totalTokens: 42 },
      // Hostile extra fields that must never survive:
      prompt: 'full secret prompt',
      content: 'full note content',
      apiKey: 'sk-secret',
      response: 'full model response',
      messages: [{ role: 'user', content: 'secret' }],
    });
    const serialized = JSON.stringify(meta);
    for (const key of REMOTE_AI_AUDIT_FORBIDDEN_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(meta, key)).toBe(false);
    }
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('full note content');
    expect(meta.provider).toBe('openai');
    expect(meta.contentCategories).toEqual(['note_text']);
    expect(meta.tokenCounts?.totalTokens).toBe(42);
  });
});

describe('resolveAiPolicy (US-016)', () => {
  const off: AiPolicy = { mode: 'off', remoteEmbeddings: false };
  const localOnly: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };
  const perRequest: AiPolicy = { mode: 'remote_per_request', remoteEmbeddings: false };
  const always: AiPolicy = { mode: 'remote_always', remoteEmbeddings: true };

  it('defaults to No AI when no policies apply (AC1)', () => {
    const r = resolveAiPolicy([]);
    expect(r.mode).toBe('off');
    expect(r.remoteAllowed).toBe(false);
    expect(r.remoteEmbeddingsAllowed).toBe(false);
    expect(r.requiresPerRequestConfirmation).toBe(false);
  });

  it('the default policy is No AI (AC1)', () => {
    expect(DEFAULT_AI_POLICY).toEqual({ mode: 'off', remoteEmbeddings: false });
  });

  it('picks the strictest mode across layers (AC2)', () => {
    expect(resolveAiPolicy([always, always, perRequest]).mode).toBe('remote_per_request');
    expect(resolveAiPolicy([perRequest, always, always]).mode).toBe('remote_per_request');
    expect(resolveAiPolicy([always, localOnly, always]).mode).toBe('local_only');
    expect(resolveAiPolicy([always, always, off]).mode).toBe('off');
    expect(resolveAiPolicy([always, always, always]).mode).toBe('remote_always');
  });

  it('only allows remote_always when every layer selects it (AC3)', () => {
    expect(resolveAiPolicy([always, always, always]).requiresPerRequestConfirmation).toBe(false);
    expect(resolveAiPolicy([always, always, perRequest]).requiresPerRequestConfirmation).toBe(true);
  });

  it('requires every layer to consent to remote embeddings (AC4)', () => {
    expect(resolveAiPolicy([always, always, always]).remoteEmbeddingsAllowed).toBe(true);
    expect(
      resolveAiPolicy([always, always, { mode: 'remote_always', remoteEmbeddings: false }])
        .remoteEmbeddingsAllowed,
    ).toBe(false);
    // No remote embeddings when remote isn't allowed at all.
    expect(
      resolveAiPolicy([
        { mode: 'local_only', remoteEmbeddings: true },
        { mode: 'local_only', remoteEmbeddings: true },
      ]).remoteEmbeddingsAllowed,
    ).toBe(false);
  });
});

describe('updateAiPolicySchema (US-016)', () => {
  it('rejects an empty payload', () => {
    expect(updateAiPolicySchema.safeParse({}).success).toBe(false);
  });
  it('accepts a partial update', () => {
    expect(updateAiPolicySchema.safeParse({ mode: 'local_only' }).success).toBe(true);
    expect(updateAiPolicySchema.safeParse({ remoteEmbeddings: true }).success).toBe(true);
  });
});

describe('buildRemoteAiAuditMetadata (US-016 AC6)', () => {
  it('excludes prompts, content, api keys, and responses via allowlist', () => {
    const meta = buildRemoteAiAuditMetadata({
      provider: 'openai',
      model: 'gpt-4o-mini',
      feature: 'proposal_extraction',
      contentCategories: ['note_text'],
      tokenCounts: { totalTokens: 42 },
      // Hostile extra fields that must never survive:
      prompt: 'full secret prompt',
      content: 'full note content',
      apiKey: 'sk-secret',
      response: 'full model response',
      messages: [{ role: 'user', content: 'secret' }],
    });
    const serialized = JSON.stringify(meta);
    for (const key of REMOTE_AI_AUDIT_FORBIDDEN_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(meta, key)).toBe(false);
    }
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('full note content');
    expect(meta.provider).toBe('openai');
    expect(meta.contentCategories).toEqual(['note_text']);
    expect(meta.tokenCounts?.totalTokens).toBe(42);
  });
});
