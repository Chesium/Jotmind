import type { LlmCompletionRequest, LlmCompletionResult } from '@jotmind/schemas';
import { joinUrl, postJson } from './http.js';
import { AiProviderError, type LlmProvider } from './types.js';

/**
 * Anthropic (Claude) LLM adapter (US-015 AC3). Remote, LLM-only — Anthropic has
 * no embedding endpoint. V1 ships this as a configured-but-untested skeleton:
 * config validation is complete and the request shape is correct, but it is not
 * exercised against the live API in tests.
 */
export interface AnthropicProviderOptions {
  name: string;
  baseUrl: string;
  llmModel: string;
  apiKey: string;
  anthropicVersion: string;
}

interface AnthropicMessagesResponse {
  model?: string;
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements LlmProvider {
  readonly kind = 'anthropic' as const;
  readonly capabilities = ['llm'] as const;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly llmModel: string;
  private readonly apiKey: string;
  private readonly anthropicVersion: string;

  constructor(options: AnthropicProviderOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl;
    this.llmModel = options.llmModel;
    this.apiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const model = request.model ?? this.llmModel;
    // Anthropic takes the system prompt separately from the message turns.
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const data = await postJson<AnthropicMessagesResponse>(
      joinUrl(this.baseUrl, '/v1/messages'),
      {
        model,
        system: system || undefined,
        messages,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature,
        stop_sequences: request.stop,
      },
      {
        'x-api-key': this.apiKey,
        'anthropic-version': this.anthropicVersion,
      },
      this.kind,
    );

    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (data.content === undefined) {
      throw new AiProviderError('Anthropic returned no content', this.kind);
    }
    return {
      text,
      model: data.model ?? model,
      finishReason: data.stop_reason ?? null,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
      },
    };
  }
}
