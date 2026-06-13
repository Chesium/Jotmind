import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseProviderConfig } from './factory.js';
import { createEmbeddingProvider, createLlmProvider } from './factory.js';
import { MockEmbeddingProvider, MockLlmProvider } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { AiProviderError } from './types.js';

describe('mock providers (deterministic, AC5)', () => {
  it('returns a stable completion derived from the last user message', async () => {
    const llm = new MockLlmProvider();
    const a = await llm.complete({ messages: [{ role: 'user', content: 'hello' }] });
    const b = await llm.complete({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
    });
    expect(a.text).toBe('mock-response: hello');
    expect(a.text).toBe(b.text);
    expect(a.model).toBe('mock');
  });

  it('produces deterministic, fixed-dimension embeddings', async () => {
    const embed = new MockEmbeddingProvider('Mock', 8);
    const r1 = await embed.embed({ input: ['cat', 'dog'] });
    const r2 = await embed.embed({ input: ['cat', 'dog'] });
    expect(r1.embeddings).toHaveLength(2);
    expect(r1.embeddings[0]).toHaveLength(8);
    expect(r1).toEqual(r2);
    // Different inputs differ; identical inputs match.
    expect(r1.embeddings[0]).not.toEqual(r1.embeddings[1]);
  });
});

describe('factory (AC1)', () => {
  it('builds the right adapter for each kind', () => {
    expect(createLlmProvider(parseProviderConfig({ kind: 'mock', name: 'M' }))).toBeInstanceOf(
      MockLlmProvider,
    );
    expect(createLlmProvider(parseProviderConfig({ kind: 'ollama', name: 'O' }))).toBeInstanceOf(
      OllamaProvider,
    );
    expect(
      createLlmProvider(
        parseProviderConfig({
          kind: 'openai-compatible',
          name: 'L',
          baseUrl: 'http://localhost:1234/v1',
        }),
      ),
    ).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(
      createLlmProvider(parseProviderConfig({ kind: 'openai', name: 'OAI', apiKey: 'sk' })),
    ).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(
      createLlmProvider(parseProviderConfig({ kind: 'anthropic', name: 'C', apiKey: 'sk' })),
    ).toBeInstanceOf(AnthropicProvider);
  });

  it('throws when requesting embeddings from anthropic', () => {
    const config = parseProviderConfig({ kind: 'anthropic', name: 'C', apiKey: 'sk' });
    expect(() => createEmbeddingProvider(config)).toThrowError(AiProviderError);
  });

  it('builds embedding adapters for the mock provider', () => {
    const config = parseProviderConfig({ kind: 'mock', name: 'M', dimensions: 16 });
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(MockEmbeddingProvider);
    expect(provider.dimensions).toBe(16);
  });
});

describe('http adapters (AC2/AC3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ollama posts to /api/chat and normalizes the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ model: 'llama3', message: { content: 'hi there' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = new OllamaProvider({
      name: 'O',
      baseUrl: 'http://localhost:11434',
      llmModel: 'llama3',
    });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hey' }] });
    expect(result.text).toBe('hi there');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openai-compatible sends a Bearer token when an api key is set', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ model: 'gpt', choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = new OpenAiCompatibleProvider({
      name: 'OAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      llmModel: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('ok');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
  });

  it('surfaces non-2xx responses as AiProviderError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const provider = new OllamaProvider({
      name: 'O',
      baseUrl: 'http://localhost:11434',
      llmModel: 'llama3',
    });
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hey' }] }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});
