import type {
  AiProviderKind,
  EmbeddingRequest,
  EmbeddingResult,
  LlmCompletionRequest,
  LlmCompletionResult,
} from '@jotmind/schemas';
import { joinUrl, postJson } from './http.js';
import {
  AiProviderError,
  embeddingInputs,
  type EmbeddingProvider,
  type LlmProvider,
} from './types.js';

/**
 * OpenAI-compatible HTTP adapter (US-015 AC2/AC3). Targets any endpoint
 * implementing the OpenAI REST shape (`/chat/completions`, `/embeddings`):
 *
 * - local servers (LM Studio, llama.cpp, vLLM, ...) — `apiKey` optional (AC2),
 * - the remote OpenAI API itself — same adapter, `kind: 'openai'`, `apiKey`
 *   required by config validation (AC3).
 */
export interface OpenAiCompatibleProviderOptions {
  name: string;
  /** `openai-compatible` for local/3rd-party endpoints, `openai` for OpenAI. */
  kind: Extract<AiProviderKind, 'openai-compatible' | 'openai'>;
  baseUrl: string;
  llmModel?: string;
  embeddingModel?: string;
  apiKey?: string;
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAiEmbeddingsResponse {
  model?: string;
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export class OpenAiCompatibleProvider implements LlmProvider, EmbeddingProvider {
  readonly kind: Extract<AiProviderKind, 'openai-compatible' | 'openai'>;
  readonly capabilities = ['llm', 'embedding'] as const;
  readonly dimensions = 0;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly llmModel?: string;
  private readonly embeddingModel?: string;
  private readonly apiKey?: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.name = options.name;
    this.kind = options.kind;
    this.baseUrl = options.baseUrl;
    this.llmModel = options.llmModel;
    this.embeddingModel = options.embeddingModel;
    this.apiKey = options.apiKey;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const model = request.model ?? this.llmModel;
    if (!model) throw new AiProviderError('No LLM model configured', this.kind);
    const data = await postJson<OpenAiChatResponse>(
      joinUrl(this.baseUrl, '/chat/completions'),
      {
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stop: request.stop,
      },
      this.headers(),
      this.kind,
    );
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      model: data.model ?? model,
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const model = request.model ?? this.embeddingModel;
    if (!model) throw new AiProviderError('No embedding model configured', this.kind);
    const inputs = embeddingInputs(request);
    const data = await postJson<OpenAiEmbeddingsResponse>(
      joinUrl(this.baseUrl, '/embeddings'),
      { model, input: inputs },
      this.headers(),
      this.kind,
    );
    const rows = (data.data ?? [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding ?? []);
    if (rows.length !== inputs.length) {
      throw new AiProviderError(
        `Expected ${inputs.length} embeddings, received ${rows.length}`,
        this.kind,
      );
    }
    return {
      embeddings: rows,
      model: data.model ?? model,
      dimensions: rows[0]?.length ?? 0,
    };
  }
}
