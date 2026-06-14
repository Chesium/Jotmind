import type { AiProviderConfig, AiProviderKind } from '@jotmind/schemas';
import { createEmbeddingProvider, parseProviderConfig } from '../ai/factory.js';
import { AiProviderError, type EmbeddingProvider } from '../ai/types.js';

/**
 * Resolve the configured embedding provider (US-021), mirroring
 * `resolveExtractorFromEnv` (US-017). Embeddings sit behind the same typed
 * adapter layer (US-015) — the indexer never calls a vendor SDK directly.
 */

/** Remote provider kinds — gated by the separate remote-embeddings consent (AC3). */
export function isRemoteProviderKind(kind: AiProviderKind): boolean {
  return kind === 'openai' || kind === 'anthropic';
}

/** An embedding provider plus the config metadata the indexer/status need. */
export interface ConfiguredEmbeddingProvider {
  provider: EmbeddingProvider;
  name: string;
  kind: AiProviderKind;
  model: string | null;
  /** True for deterministic mock output (used by tests). */
  demo: boolean;
  /** True when the provider is remote and needs explicit consent (AC3). */
  remote: boolean;
}

/** Build a configured embedding provider from validated config, or null. */
export function createConfiguredEmbeddingProvider(
  config: AiProviderConfig,
): ConfiguredEmbeddingProvider | null {
  try {
    const provider = createEmbeddingProvider(config);
    const model = 'embeddingModel' in config ? (config.embeddingModel ?? null) : null;
    return {
      provider,
      name: config.name,
      kind: config.kind,
      model,
      demo: config.kind === 'mock',
      remote: isRemoteProviderKind(config.kind),
    };
  } catch (err) {
    // Anthropic has no embedding endpoint → no embedding provider available.
    if (err instanceof AiProviderError) return null;
    throw err;
  }
}

/**
 * Resolve the embedding provider from the environment, or `null` when no AI
 * provider is configured (→ No embeddings can be generated). Reads
 * `AI_PROVIDER_CONFIG` (JSON), the same env var as extraction/command/answers.
 * Any parse/build error resolves to `null` rather than crashing.
 */
export function resolveEmbeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredEmbeddingProvider | null {
  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return null;
  try {
    const config = parseProviderConfig(JSON.parse(raw));
    return createConfiguredEmbeddingProvider(config);
  } catch {
    return null;
  }
}
