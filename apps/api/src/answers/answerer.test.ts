import { describe, expect, it } from 'vitest';
import type { AnswerCitation, LlmCompletionRequest, LlmCompletionResult } from '@jotmind/schemas';
import type { LlmProvider } from '../ai/types.js';
import {
  LlmAnswerGenerator,
  MockAnswerGenerator,
  createAnswerGeneratorFromConfig,
  parseAnswerOutput,
  resolveAnswerGeneratorFromEnv,
} from './answerer.js';

const UUID = '11111111-1111-1111-1111-111111111111';

function claimCitation(ref: number, overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    ref,
    kind: 'claim',
    id: UUID,
    knowledgeBaseId: UUID,
    title: 'knows',
    snippet: null,
    predicate: 'knows',
    entities: [
      { role: 'subject', entityId: UUID, name: 'Ada' },
      { role: 'object', entityId: UUID, name: 'Charles' },
    ],
    confidence: 0.9,
    provenance: null,
    ...overrides,
  };
}

/** LlmProvider fake returning queued responses (one per `complete` call). */
function scriptedLlm(responses: string[]): LlmProvider & { calls: LlmCompletionRequest[] } {
  const calls: LlmCompletionRequest[] = [];
  let i = 0;
  return {
    name: 'Scripted',
    kind: 'openai-compatible',
    capabilities: ['llm'],
    calls,
    complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      calls.push(request);
      const text = responses[i] ?? '';
      i += 1;
      return Promise.resolve({ text, model: 'scripted', finishReason: 'stop' });
    },
  };
}

describe('MockAnswerGenerator (US-020)', () => {
  it('is deterministic and labels its demo output', async () => {
    const gen = new MockAnswerGenerator();
    expect(gen.demo).toBe(true);
    const a = await gen.generate('who?', [claimCitation(0)]);
    const b = await gen.generate('who?', [claimCitation(0)]);
    expect(a).toEqual(b);
  });

  it('cites the evidence and marks high-confidence claims as known (AC1/AC5)', async () => {
    const gen = new MockAnswerGenerator();
    const { answer } = await gen.generate('who?', [claimCitation(0)]);
    expect(answer).not.toBeNull();
    expect(answer?.statements[0]?.factKind).toBe('known');
    expect(answer?.statements[0]?.citations).toEqual([0]);
  });

  it('marks low-confidence claims as uncertain (AC5)', async () => {
    const gen = new MockAnswerGenerator();
    const { answer } = await gen.generate('who?', [claimCitation(0, { confidence: 0.2 })]);
    expect(answer?.statements[0]?.factKind).toBe('uncertain');
  });

  it('marks rule-derived claims as inferred (AC5)', async () => {
    const gen = new MockAnswerGenerator();
    const { answer } = await gen.generate('who?', [
      claimCitation(0, { provenance: { origin: 'inferred' } }),
    ]);
    expect(answer?.statements[0]?.factKind).toBe('inferred');
  });

  it('reports missing information when there is no evidence (AC5)', async () => {
    const gen = new MockAnswerGenerator();
    const { answer } = await gen.generate('who?', []);
    expect(answer?.statements[0]?.factKind).toBe('missing');
    expect(answer?.statements[0]?.citations).toEqual([]);
  });
});

describe('parseAnswerOutput', () => {
  it('parses valid JSON (with code fence) into a generated answer', () => {
    const raw =
      '```json\n{"summary":"s","statements":[{"text":"t","factKind":"known","citations":[0]}]}\n```';
    expect(parseAnswerOutput(raw)?.summary).toBe('s');
  });

  it('returns null for invalid JSON', () => {
    expect(parseAnswerOutput('not json')).toBeNull();
  });

  it('returns null when JSON fails the schema', () => {
    expect(parseAnswerOutput('{"summary":"s"}')).toBeNull();
  });
});

describe('LlmAnswerGenerator', () => {
  const valid = '{"summary":"s","statements":[{"text":"t","factKind":"known","citations":[0]}]}';

  it('returns a valid answer without a repair retry', async () => {
    const llm = scriptedLlm([valid]);
    const gen = new LlmAnswerGenerator(llm, {
      kind: 'openai-compatible',
      name: 'Local',
      baseUrl: 'http://localhost:1234',
      llmModel: 'local-model',
    });
    const result = await gen.generate('who?', [claimCitation(0)]);
    expect(result.answer?.summary).toBe('s');
    expect(result.repaired).toBe(false);
    expect(llm.calls).toHaveLength(1);
    expect(gen.verified).toBe(true);
  });

  it('does exactly one repair retry on invalid first output', async () => {
    const llm = scriptedLlm(['garbage', valid]);
    const gen = new LlmAnswerGenerator(llm, {
      kind: 'openai-compatible',
      name: 'Local',
      baseUrl: 'http://localhost:1234',
    });
    const result = await gen.generate('who?', [claimCitation(0)]);
    expect(result.answer?.summary).toBe('s');
    expect(result.repaired).toBe(true);
    expect(llm.calls).toHaveLength(2);
  });

  it('discards still-invalid output after the repair retry', async () => {
    const llm = scriptedLlm(['garbage', 'still bad']);
    const gen = new LlmAnswerGenerator(llm, {
      kind: 'openai-compatible',
      name: 'Local',
      baseUrl: 'http://localhost:1234',
    });
    const result = await gen.generate('who?', [claimCitation(0)]);
    expect(result.answer).toBeNull();
    expect(llm.calls).toHaveLength(2);
  });

  it('marks remote providers as unverified skeletons (AC1)', () => {
    const llm = scriptedLlm([valid]);
    const gen = new LlmAnswerGenerator(llm, {
      kind: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      llmModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
      apiKey: 'sk-test',
    });
    expect(gen.verified).toBe(false);
  });
});

describe('answer generator factory + env resolution', () => {
  it('builds the mock generator only when demo is allowed', () => {
    const config = { kind: 'mock' as const, name: 'Mock', dimensions: 8 };
    expect(createAnswerGeneratorFromConfig(config, { allowDemo: true })).toBeInstanceOf(
      MockAnswerGenerator,
    );
    expect(createAnswerGeneratorFromConfig(config, { allowDemo: false })).toBeNull();
  });

  it('returns null when AI_PROVIDER_CONFIG is unset (No-AI, AC2)', () => {
    expect(resolveAnswerGeneratorFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('builds the mock generator from env when demo is enabled', () => {
    const gen = resolveAnswerGeneratorFromEnv({
      AI_PROVIDER_CONFIG: JSON.stringify({ kind: 'mock', name: 'Mock', dimensions: 8 }),
      AI_DEMO_EXTRACTION: 'true',
    } as NodeJS.ProcessEnv);
    expect(gen).toBeInstanceOf(MockAnswerGenerator);
  });

  it('returns null on malformed config', () => {
    expect(
      resolveAnswerGeneratorFromEnv({ AI_PROVIDER_CONFIG: 'not json' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
