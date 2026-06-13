import { aiProviderConfigSchema, type AiProviderConfig } from '@jotmind/schemas';
import { AnthropicProvider } from './anthropic.js';
import { MockEmbeddingProvider, MockLlmProvider } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';
import { AiProviderError, type EmbeddingProvider, type LlmProvider } from './types.js';

/**
 * Provider factory (US-015). Builds typed adapters from validated config so the
 * rest of the app never constructs vendor clients directly. Pass a parsed
 * {@link AiProviderConfig}, or use {@link parseProviderConfig} to validate raw
 * input first.
 */

/** Validate raw config input against the shared Zod schema (applies defaults). */
export function parseProviderConfig(input: unknown): AiProviderConfig {
  return aiProviderConfigSchema.parse(input);
}

/** Build an LLM adapter for the given config. Every kind supports LLM. */
export function createLlmProvider(config: AiProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'mock':
      return new MockLlmProvider(config.name);
    case 'ollama':
      return new OllamaProvider(config);
    case 'openai-compatible':
    case 'openai':
      return new OpenAiCompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
  }
}

/**
 * Build an embedding adapter for the given config. Throws for providers that do
 * not offer embeddings (Anthropic).
 */
export function createEmbeddingProvider(config: AiProviderConfig): EmbeddingProvider {
  switch (config.kind) {
    case 'mock':
      return new MockEmbeddingProvider(config.name, config.dimensions);
    case 'ollama':
      return new OllamaProvider(config);
    case 'openai-compatible':
    case 'openai':
      return new OpenAiCompatibleProvider(config);
    case 'anthropic':
      throw new AiProviderError('Anthropic does not provide an embedding endpoint', config.kind);
  }
}
