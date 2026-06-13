import type {
  AiProviderCapability,
  AiProviderKind,
  EmbeddingRequest,
  EmbeddingResult,
  LlmCompletionRequest,
  LlmCompletionResult,
} from '@jotmind/schemas';

/**
 * Typed adapter interfaces (US-015 AC1). UI and graph repositories depend on
 * these — never on a vendor SDK directly. Concrete adapters live alongside this
 * file (`ollama.ts`, `openai-compatible.ts`, `anthropic.ts`, `mock.ts`) and are
 * constructed from validated config via the factory in `factory.ts`.
 */

/** Common metadata shared by every provider adapter. */
export interface AiProvider {
  /** Operator-facing label from the config. */
  readonly name: string;
  /** Discriminator identifying the underlying vendor/protocol. */
  readonly kind: AiProviderKind;
  /** Capabilities this adapter actually implements. */
  readonly capabilities: readonly AiProviderCapability[];
}

/** LLM (chat/completion) adapter. */
export interface LlmProvider extends AiProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/** Embedding adapter. `dimensions` is the size of the vectors it returns. */
export interface EmbeddingProvider extends AiProvider {
  readonly dimensions: number;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

/** Error thrown when a provider HTTP call fails or returns an unexpected shape. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly providerKind: AiProviderKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Normalize an embedding request `input` to an array of strings. */
export function embeddingInputs(request: EmbeddingRequest): string[] {
  return Array.isArray(request.input) ? request.input : [request.input];
}
