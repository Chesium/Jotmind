import type {
  EmbeddingRequest,
  EmbeddingResult,
  LlmCompletionRequest,
  LlmCompletionResult,
} from '@jotmind/schemas';
import { embeddingInputs, type EmbeddingProvider, type LlmProvider } from './types.js';

/**
 * Deterministic mock providers (US-015 AC5). Normal tests use these instead of
 * hitting any network so results are reproducible and no credentials are
 * required. The same input always yields the same output.
 */

const MOCK_MODEL = 'mock';

/** Stable 32-bit FNV-1a hash of a string (deterministic across runs). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic LLM provider. Echoes a normalized summary of the conversation
 * so tests can assert on a stable string without a real model.
 */
export class MockLlmProvider implements LlmProvider {
  readonly kind = 'mock' as const;
  readonly capabilities = ['llm'] as const;
  constructor(readonly name = 'Mock LLM') {}

  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = `mock-response: ${lastUser?.content ?? ''}`.trim();
    return Promise.resolve({
      text,
      model: request.model ?? MOCK_MODEL,
      finishReason: 'stop',
      usage: {
        promptTokens: request.messages.reduce((n, m) => n + m.content.length, 0),
        completionTokens: text.length,
      },
    });
  }
}

/**
 * Deterministic embedding provider. Produces fixed-dimension unit-ish vectors
 * derived from a hash of each input, so identical text always embeds the same.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'mock' as const;
  readonly capabilities = ['embedding'] as const;
  readonly dimensions: number;
  constructor(
    readonly name = 'Mock Embeddings',
    dimensions = 8,
  ) {
    this.dimensions = dimensions;
  }

  embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const embeddings = embeddingInputs(request).map((text) => this.vectorFor(text));
    return Promise.resolve({
      embeddings,
      model: request.model ?? MOCK_MODEL,
      dimensions: this.dimensions,
    });
  }

  private vectorFor(text: string): number[] {
    const vector: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      // Seed each component with the input + index so components differ.
      const h = fnv1a(`${text}#${i}`);
      // Map to [-1, 1).
      vector.push((h / 0xffffffff) * 2 - 1);
    }
    return vector;
  }
}
