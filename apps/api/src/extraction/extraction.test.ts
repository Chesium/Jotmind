import { describe, expect, it } from 'vitest';
import type { LlmCompletionResult } from '@jotmind/schemas';
import type { LlmProvider } from '../ai/types.js';
import {
  LlmGraphExtractor,
  MockGraphExtractor,
  createExtractorFromConfig,
  isRemoteProviderKind,
  parseExtractionOutput,
  resolveExtractorFromEnv,
} from './index.js';

describe('MockGraphExtractor', () => {
  it('is deterministic: same text yields the same candidates', async () => {
    const extractor = new MockGraphExtractor();
    const text = 'Ada Lovelace met Charles Babbage in London.';
    const a = await extractor.extract(text);
    const b = await extractor.extract(text);
    expect(a).toEqual(b);
  });

  it('extracts proper-noun entities and a linking claim', async () => {
    const extractor = new MockGraphExtractor();
    const changes = await extractor.extract('Ada Lovelace met Charles Babbage.');
    const entities = changes.filter((c) => c.op === 'create_entity');
    const claims = changes.filter((c) => c.op === 'create_claim');
    expect(entities.map((e) => (e.op === 'create_entity' ? e.name : ''))).toContain('Ada Lovelace');
    expect(claims).toHaveLength(1);
  });

  it('is flagged as demo output', () => {
    expect(new MockGraphExtractor().demo).toBe(true);
  });

  it('returns no claim when fewer than two entities are present', async () => {
    const changes = await new MockGraphExtractor().extract('the cat sat on the mat');
    expect(changes.filter((c) => c.op === 'create_claim')).toHaveLength(0);
  });
});

describe('parseExtractionOutput', () => {
  it('parses valid JSON output', () => {
    const items = parseExtractionOutput(
      '{"items":[{"op":"create_entity","ref":"a","type":"Person","name":"Ada"}]}',
    );
    expect(items).toHaveLength(1);
  });

  it('strips a code fence', () => {
    const items = parseExtractionOutput('```json\n{"items":[]}\n```');
    expect(items).toEqual([]);
  });

  it('discards invalid JSON', () => {
    expect(parseExtractionOutput('not json')).toEqual([]);
  });

  it('discards JSON that fails schema validation', () => {
    expect(parseExtractionOutput('{"items":[{"op":"nope"}]}')).toEqual([]);
  });
});

function fakeLlm(text: string): LlmProvider {
  return {
    name: 'fake',
    kind: 'openai-compatible',
    capabilities: ['llm'],
    complete: (): Promise<LlmCompletionResult> =>
      Promise.resolve({ text, model: 'fake-model', finishReason: 'stop' }),
  };
}

describe('LlmGraphExtractor', () => {
  it('prompts the provider and validates its JSON output', async () => {
    const llm = fakeLlm(
      '{"items":[{"op":"create_entity","ref":"a","type":"Person","name":"Ada"}]}',
    );
    const extractor = new LlmGraphExtractor(llm, {
      kind: 'openai-compatible',
      name: 'Local',
      baseUrl: 'http://localhost:1234',
    });
    const changes = await extractor.extract('Ada is a person.');
    expect(changes).toHaveLength(1);
    expect(extractor.verified).toBe(true);
  });

  it('marks remote providers as unverified skeletons (AC3)', () => {
    const extractor = new LlmGraphExtractor(fakeLlm('{"items":[]}'), {
      kind: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      llmModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(extractor.verified).toBe(false);
  });
});

describe('createExtractorFromConfig', () => {
  it('returns the mock extractor only when demo is allowed (AC6)', () => {
    const config = { kind: 'mock', name: 'Demo', dimensions: 8 } as const;
    expect(createExtractorFromConfig(config, { allowDemo: true })).toBeInstanceOf(
      MockGraphExtractor,
    );
    expect(createExtractorFromConfig(config, { allowDemo: false })).toBeNull();
  });
});

describe('isRemoteProviderKind', () => {
  it('classifies openai/anthropic as remote', () => {
    expect(isRemoteProviderKind('openai')).toBe(true);
    expect(isRemoteProviderKind('anthropic')).toBe(true);
    expect(isRemoteProviderKind('ollama')).toBe(false);
    expect(isRemoteProviderKind('mock')).toBe(false);
  });
});

describe('resolveExtractorFromEnv', () => {
  it('returns null when no provider is configured (No AI, AC4)', () => {
    expect(resolveExtractorFromEnv({})).toBeNull();
  });

  it('builds a mock extractor when demo is enabled', () => {
    const extractor = resolveExtractorFromEnv({
      AI_PROVIDER_CONFIG: JSON.stringify({ kind: 'mock', name: 'Demo' }),
      AI_DEMO_EXTRACTION: 'true',
    });
    expect(extractor).toBeInstanceOf(MockGraphExtractor);
  });

  it('returns null on invalid config rather than throwing', () => {
    expect(resolveExtractorFromEnv({ AI_PROVIDER_CONFIG: '{bad json' })).toBeNull();
  });
});
