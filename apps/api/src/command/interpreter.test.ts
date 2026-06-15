import { describe, expect, it } from 'vitest';
import type { LlmCompletionResult } from '@jotmind/schemas';
import type { LlmProvider } from '../ai/types.js';
import {
  LlmCommandInterpreter,
  MockCommandInterpreter,
  createInterpreterFromConfig,
  parseCommandOutput,
  resolveCommandInterpreterFromEnv,
} from './interpreter.js';

/** LLM provider returning scripted responses in order, per `complete` call. */
function scriptedLlm(responses: string[]): LlmProvider {
  let i = 0;
  return {
    name: 'Scripted',
    kind: 'openai-compatible',
    capabilities: ['llm'],
    complete(): Promise<LlmCompletionResult> {
      const text = responses[i++] ?? '';
      return Promise.resolve({ text, model: 'scripted', finishReason: 'stop' });
    },
  };
}

describe('MockCommandInterpreter (US-019)', () => {
  it('is deterministic and emits a search intent', async () => {
    const interp = new MockCommandInterpreter();
    const a = await interp.interpret('find ada');
    const b = await interp.interpret('find ada');
    expect(a).toEqual(b);
    expect(a.interpretation?.intent).toBe('search');
    expect(a.repaired).toBe(false);
  });

  it('parses key:value hints into structured filters', async () => {
    const interp = new MockCommandInterpreter();
    const { interpretation } = await interp.interpret('type:Person tag:pioneer kind:entity ada');
    expect(interpretation?.intent).toBe('search');
    if (interpretation?.intent === 'search') {
      expect(interpretation.filters.type).toBe('Person');
      expect(interpretation.filters.tag).toBe('pioneer');
      expect(interpretation.filters.kinds).toEqual(['entity']);
      expect(interpretation.filters.q).toBe('ada');
    }
  });

  it('emits a create-entity suggestion for simple create commands (US-051)', async () => {
    const interp = new MockCommandInterpreter();
    const { interpretation } = await interp.interpret(
      'create type:Person tag:pioneer Ada Lovelace',
    );
    expect(interpretation?.intent).toBe('create');
    if (interpretation?.intent === 'create') {
      expect(interpretation.changes.items).toEqual([
        {
          op: 'create_entity',
          ref: 'ada-lovelace',
          type: 'Person',
          name: 'Ada Lovelace',
          tags: ['pioneer'],
        },
      ]);
    }
  });

  it('is marked as demo output', () => {
    const interp = new MockCommandInterpreter();
    expect(interp.demo).toBe(true);
    expect(interp.verified).toBe(true);
  });
});

describe('parseCommandOutput (US-019 AC2/AC3)', () => {
  it('parses valid JSON (with code fence) into an interpretation', () => {
    const out = parseCommandOutput(
      '```json\n{"intent":"search","confidence":0.9,"filters":{"q":"ada"}}\n```',
    );
    expect(out?.intent).toBe('search');
  });

  it('discards invalid JSON', () => {
    expect(parseCommandOutput('not json')).toBeNull();
  });

  it('discards JSON that fails schema validation', () => {
    expect(parseCommandOutput('{"intent":"nuke","confidence":1}')).toBeNull();
  });
});

describe('LlmCommandInterpreter (US-019 AC4 repair retry)', () => {
  const config = { kind: 'openai-compatible' as const, name: 'Local', baseUrl: 'http://x' };

  it('returns the first valid output without repairing', async () => {
    const llm = scriptedLlm(['{"intent":"search","confidence":0.8,"filters":{"q":"ada"}}']);
    const interp = new LlmCommandInterpreter(llm, config);
    const result = await interp.interpret('find ada');
    expect(result.repaired).toBe(false);
    expect(result.interpretation?.intent).toBe('search');
  });

  it('attempts exactly one repair retry on invalid output', async () => {
    const llm = scriptedLlm([
      'garbage not json',
      '{"intent":"search","confidence":0.6,"filters":{"q":"ada"}}',
    ]);
    const interp = new LlmCommandInterpreter(llm, config);
    const result = await interp.interpret('find ada');
    expect(result.repaired).toBe(true);
    expect(result.interpretation?.intent).toBe('search');
  });

  it('discards output when the repair also fails (AC3)', async () => {
    const llm = scriptedLlm(['garbage', 'still garbage']);
    const interp = new LlmCommandInterpreter(llm, config);
    const result = await interp.interpret('find ada');
    expect(result.interpretation).toBeNull();
    expect(result.repaired).toBe(false);
  });
});

describe('interpreter factory / env resolution (US-019)', () => {
  it('builds a mock interpreter only when demo is allowed', () => {
    const config = { kind: 'mock' as const, name: 'Mock', dimensions: 8 };
    expect(createInterpreterFromConfig(config, { allowDemo: true })).toBeInstanceOf(
      MockCommandInterpreter,
    );
    expect(createInterpreterFromConfig(config, { allowDemo: false })).toBeNull();
  });

  it('returns null when no provider is configured (No-AI, AC1)', () => {
    expect(resolveCommandInterpreterFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns null on malformed AI_PROVIDER_CONFIG', () => {
    expect(
      resolveCommandInterpreterFromEnv({ AI_PROVIDER_CONFIG: 'not json' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('builds the mock interpreter from env with the demo flag', () => {
    const interp = resolveCommandInterpreterFromEnv({
      AI_PROVIDER_CONFIG: JSON.stringify({ kind: 'mock', name: 'Mock' }),
      AI_DEMO_EXTRACTION: 'true',
    } as NodeJS.ProcessEnv);
    expect(interp).toBeInstanceOf(MockCommandInterpreter);
  });
});
