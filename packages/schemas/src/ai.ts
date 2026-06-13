import { z } from 'zod';

/**
 * AI provider adapter layer (US-015). All AI integrations sit behind typed
 * adapters so the UI and graph repositories never call vendor SDKs directly.
 * This module defines the **shared, serializable shapes**:
 *
 * - provider config schemas (Zod) that **separate secrets** (e.g. API keys)
 *   from the portable fields safe to include in Knowledge Base exports
 *   (AC4), and
 * - the request/response message shapes the LLM and embedding adapter
 *   interfaces exchange.
 *
 * The adapter *interfaces* and concrete HTTP/mock implementations live in
 * `apps/api/src/ai/`.
 */

/**
 * Supported provider kinds.
 *
 * - `ollama` / `openai-compatible` are **local** inference targets that work in
 *   V1 without remote credentials (AC2).
 * - `openai` / `anthropic` are **remote** providers. V1 may ship them as
 *   configured-but-untested skeletons, but their config validation is complete
 *   (AC3).
 * - `mock` is the deterministic provider used by normal tests (AC5).
 */
export const AI_PROVIDER_KINDS = [
  'ollama',
  'openai-compatible',
  'openai',
  'anthropic',
  'mock',
] as const;
export const aiProviderKindSchema = z.enum(AI_PROVIDER_KINDS);
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Capabilities a provider may expose. */
export const AI_PROVIDER_CAPABILITIES = ['llm', 'embedding'] as const;
export const aiProviderCapabilitySchema = z.enum(AI_PROVIDER_CAPABILITIES);
export type AiProviderCapability = (typeof AI_PROVIDER_CAPABILITIES)[number];

/**
 * Secret config field names. These are stripped from a provider config before
 * it is included in a portable Knowledge Base export (AC4). Keep this list and
 * {@link toPortableProviderConfig} in sync with any new secret-bearing field.
 */
export const AI_PROVIDER_SECRET_FIELDS = ['apiKey'] as const;
export type AiProviderSecretField = (typeof AI_PROVIDER_SECRET_FIELDS)[number];

// --- Chat / completion message shapes ---------------------------------------

export const CHAT_ROLES = ['system', 'user', 'assistant'] as const;
export const chatRoleSchema = z.enum(CHAT_ROLES);
export type ChatRole = (typeof CHAT_ROLES)[number];

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Request passed to an {@link LlmProvider}. `model` overrides the configured default. */
export const llmCompletionRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stop: z.array(z.string()).optional(),
});
export type LlmCompletionRequest = z.infer<typeof llmCompletionRequestSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const llmCompletionResultSchema = z.object({
  text: z.string(),
  model: z.string(),
  finishReason: z.string().nullable().optional(),
  usage: tokenUsageSchema.optional(),
});
export type LlmCompletionResult = z.infer<typeof llmCompletionResultSchema>;

// --- Embedding shapes -------------------------------------------------------

/** Request passed to an {@link EmbeddingProvider}. Accepts one string or a batch. */
export const embeddingRequestSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  model: z.string().min(1).optional(),
});
export type EmbeddingRequest = z.infer<typeof embeddingRequestSchema>;

export const embeddingResultSchema = z.object({
  /** One vector per input item, in input order. */
  embeddings: z.array(z.array(z.number())),
  model: z.string(),
  dimensions: z.number().int().positive(),
});
export type EmbeddingResult = z.infer<typeof embeddingResultSchema>;

// --- Provider config schemas (portable + full) ------------------------------
//
// For each kind we define a *portable* schema (safe to export) and a *full*
// schema that additionally carries secrets. `toPortableProviderConfig` strips
// the secrets; `portableAiProviderConfigSchema` re-validates and drops any
// unknown keys (so a leaked secret cannot survive a round-trip).

const baseFields = {
  /** Human-readable label for this provider configuration. */
  name: z.string().min(1).max(200),
};

// Ollama — local, no credentials (AC2).
const ollamaPortable = z.object({
  ...baseFields,
  kind: z.literal('ollama'),
  baseUrl: z.string().url().default('http://localhost:11434'),
  llmModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
});
const ollamaConfig = ollamaPortable;

// OpenAI-compatible — local servers (LM Studio, llama.cpp, vLLM, ...) or any
// OpenAI-compatible HTTP endpoint. `apiKey` is optional so local endpoints work
// without remote credentials (AC2).
const openaiCompatiblePortable = z.object({
  ...baseFields,
  kind: z.literal('openai-compatible'),
  baseUrl: z.string().url(),
  llmModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
});
const openaiCompatibleConfig = openaiCompatiblePortable.extend({
  apiKey: z.string().min(1).optional(),
});

// OpenAI — remote (AC3). Config validation is complete: an API key is required.
const openaiPortable = z.object({
  ...baseFields,
  kind: z.literal('openai'),
  baseUrl: z.string().url().default('https://api.openai.com/v1'),
  llmModel: z.string().min(1).default('gpt-4o-mini'),
  embeddingModel: z.string().min(1).default('text-embedding-3-small'),
});
const openaiConfig = openaiPortable.extend({
  apiKey: z.string().min(1),
});

// Anthropic — remote, LLM only (no embedding endpoint) (AC3).
const anthropicPortable = z.object({
  ...baseFields,
  kind: z.literal('anthropic'),
  baseUrl: z.string().url().default('https://api.anthropic.com'),
  llmModel: z.string().min(1).default('claude-3-5-sonnet-latest'),
  anthropicVersion: z.string().min(1).default('2023-06-01'),
});
const anthropicConfig = anthropicPortable.extend({
  apiKey: z.string().min(1),
});

// Mock — deterministic, used by normal tests (AC5).
const mockPortable = z.object({
  ...baseFields,
  kind: z.literal('mock'),
  /** Embedding dimensionality the deterministic mock produces. */
  dimensions: z.number().int().positive().max(4096).default(8),
});
const mockConfig = mockPortable;

/**
 * Full provider config including secrets. Use this to validate config supplied
 * by an operator (e.g. from settings or env). Discriminated on `kind`.
 */
export const aiProviderConfigSchema = z.discriminatedUnion('kind', [
  ollamaConfig,
  openaiCompatibleConfig,
  openaiConfig,
  anthropicConfig,
  mockConfig,
]);
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;

/**
 * Portable provider config — secrets removed. This is what may be embedded in a
 * portable Knowledge Base export (AC4). Parsing strips unknown keys, so a
 * secret can never round-trip through it.
 */
export const portableAiProviderConfigSchema = z.discriminatedUnion('kind', [
  ollamaPortable,
  openaiCompatiblePortable,
  openaiPortable,
  anthropicPortable,
  mockPortable,
]);
export type PortableAiProviderConfig = z.infer<typeof portableAiProviderConfigSchema>;

/**
 * Strip secret fields from a provider config, returning the portable form safe
 * to include in Knowledge Base exports (AC4). Re-validates against
 * {@link portableAiProviderConfigSchema} so any unexpected keys are dropped.
 */
export function toPortableProviderConfig(config: AiProviderConfig): PortableAiProviderConfig {
  const copy: Record<string, unknown> = { ...config };
  for (const field of AI_PROVIDER_SECRET_FIELDS) {
    delete copy[field];
  }
  return portableAiProviderConfigSchema.parse(copy);
}

/** Whether a config currently carries any secret value. */
export function providerConfigHasSecrets(config: AiProviderConfig): boolean {
  return AI_PROVIDER_SECRET_FIELDS.some(
    (field) => (config as Record<string, unknown>)[field] !== undefined,
  );
}
