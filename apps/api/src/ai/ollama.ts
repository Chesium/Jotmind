import type {
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
 * Ollama-native HTTP adapter (US-015 AC2). Targets a local Ollama server
 * (`/api/chat`, `/api/embeddings`) and works without any remote credentials.
 */
export interface OllamaProviderOptions {
  name: string;
  baseUrl: string;
  llmModel?: string;
  embeddingModel?: string;
}

interface OllamaChatResponse {
  model?: string;
  message?: { role?: string; content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingsResponse {
  embedding?: number[];
}

export class OllamaProvider implements LlmProvider, EmbeddingProvider {
  readonly kind = 'ollama' as const;
  readonly capabilities = ['llm', 'embedding'] as const;
  /** Unknown until a model responds; 0 signals "determined at call time". */
  readonly dimensions = 0;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly llmModel?: string;
  private readonly embeddingModel?: string;

  constructor(options: OllamaProviderOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl;
    this.llmModel = options.llmModel;
    this.embeddingModel = options.embeddingModel;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const model = request.model ?? this.llmModel;
    if (!model) throw new AiProviderError('No LLM model configured for Ollama', this.kind);
    const data = await postJson<OllamaChatResponse>(
      joinUrl(this.baseUrl, '/api/chat'),
      {
        model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
          stop: request.stop,
        },
      },
      {},
      this.kind,
    );
    return {
      text: data.message?.content ?? '',
      model: data.model ?? model,
      finishReason: data.done_reason ?? null,
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
      },
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const model = request.model ?? this.embeddingModel;
    if (!model) throw new AiProviderError('No embedding model configured for Ollama', this.kind);
    const inputs = embeddingInputs(request);
    // Ollama's native /api/embeddings embeds one prompt per call.
    const embeddings: number[][] = [];
    for (const prompt of inputs) {
      const data = await postJson<OllamaEmbeddingsResponse>(
        joinUrl(this.baseUrl, '/api/embeddings'),
        { model, prompt },
        {},
        this.kind,
      );
      if (!data.embedding) {
        throw new AiProviderError('Ollama returned no embedding vector', this.kind);
      }
      embeddings.push(data.embedding);
    }
    return {
      embeddings,
      model,
      dimensions: embeddings[0]?.length ?? 0,
    };
  }
}
