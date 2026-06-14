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

// --- Provider status (US-046) ----------------------------------------------
//
// A *sanitized* view of the active provider configuration that is safe to send
// to the browser so operators can see which provider is active and whether it
// is usable — WITHOUT ever exposing API keys or other secrets (AC4).

/**
 * Local-vs-remote classification of a provider (AC2):
 * - `local`  — runs against a self-hosted endpoint (ollama, openai-compatible).
 * - `remote` — calls a third-party cloud API (openai, anthropic).
 * - `demo`   — deterministic mock provider; output is not real (AC5).
 */
export const AI_PROVIDER_CLASSIFICATIONS = ['local', 'remote', 'demo'] as const;
export const aiProviderClassificationSchema = z.enum(AI_PROVIDER_CLASSIFICATIONS);
export type AiProviderClassification = (typeof AI_PROVIDER_CLASSIFICATIONS)[number];

/**
 * Sanitized provider status returned by the backend to the UI (US-046). It
 * carries only non-secret, display-safe fields. `configured: false` means no
 * provider is set up (AI features are off). Provider configuration is currently
 * environment-only (`editable: false`, `configSource: 'environment'`, AC3).
 */
export const aiProviderStatusSchema = z.object({
  /** Whether any AI provider is configured at all. */
  configured: z.boolean(),
  /** Provider config is managed by server environment, not the browser (AC3). */
  editable: z.literal(false),
  configSource: z.literal('environment'),
  /** The active provider kind, when configured (AC1). */
  kind: aiProviderKindSchema.optional(),
  /** Human-readable provider label/name (AC2). */
  name: z.string().optional(),
  /** Local / remote / demo classification (AC2, AC5). */
  classification: aiProviderClassificationSchema.optional(),
  /** True for cloud providers (openai/anthropic) that send data off-box (AC2). */
  remote: z.boolean().optional(),
  /** True for the deterministic mock provider; output is demo only (AC5). */
  demo: z.boolean().optional(),
  /**
   * Readiness/verification state (AC2). Remote providers ship as
   * configured-but-untested skeletons in V1, so they report `verified: false`.
   */
  verified: z.boolean().optional(),
  /** Configured LLM model, when known (AC2). */
  llmModel: z.string().nullable().optional(),
  /** Configured embedding model, when known (AC2). */
  embeddingModel: z.string().nullable().optional(),
  /** Whether this provider kind offers embeddings (anthropic does not). */
  embeddingsSupported: z.boolean().optional(),
  /** Base URL of the provider endpoint, when applicable (AC2). */
  baseUrl: z.string().optional(),
});
export type AiProviderStatus = z.infer<typeof aiProviderStatusSchema>;

/**
 * Build a sanitized {@link AiProviderStatus} from a parsed provider config (or
 * `null` when none is configured). Only display-safe fields are read — secret
 * fields like `apiKey` are NEVER copied through, so the result is always safe to
 * return to the browser (AC4).
 */
export function buildAiProviderStatus(config: AiProviderConfig | null): AiProviderStatus {
  if (!config) {
    return { configured: false, editable: false, configSource: 'environment' };
  }
  const remote = config.kind === 'openai' || config.kind === 'anthropic';
  const demo = config.kind === 'mock';
  const classification: AiProviderClassification = demo ? 'demo' : remote ? 'remote' : 'local';
  return {
    configured: true,
    editable: false,
    configSource: 'environment',
    kind: config.kind,
    name: config.name,
    classification,
    remote,
    demo,
    // Remote providers are configured-but-untested skeletons in V1.
    verified: !remote,
    llmModel: 'llmModel' in config ? (config.llmModel ?? null) : null,
    embeddingModel: 'embeddingModel' in config ? (config.embeddingModel ?? null) : null,
    embeddingsSupported: config.kind !== 'anthropic',
    baseUrl: 'baseUrl' in config ? config.baseUrl : undefined,
  };
}

// ===========================================================================
// Layered AI privacy policy (US-016)
//
// AI usage is gated by three independent policy layers — server, Knowledge
// Base, and user — evaluated with **strictest-policy-wins** semantics (AC2).
// Fresh installs (no stored rows) resolve to `off` / "No AI" (AC1).
// ===========================================================================

/**
 * AI policy modes, ordered least → most permissive. Each layer (server / KB /
 * user) independently picks one; the effective mode is the **strictest** (lowest
 * rank) across the applicable layers.
 *
 * - `off`                — No AI at all (default for fresh installs, AC1).
 * - `local_only`         — only local providers (ollama / openai-compatible); no
 *                          remote calls.
 * - `remote_per_request` — remote providers allowed but every remote call needs
 *                          explicit per-request confirmation (AC3).
 * - `remote_always`      — remote providers allowed without per-request
 *                          confirmation. Effective only when *every* applicable
 *                          layer selects it, so "always allowed" is genuinely
 *                          per-user and per-Knowledge-Base (AC3).
 */
export const AI_POLICY_MODES = [
  'off',
  'local_only',
  'remote_per_request',
  'remote_always',
] as const;
export const aiPolicyModeSchema = z.enum(AI_POLICY_MODES);
export type AiPolicyMode = (typeof AI_POLICY_MODES)[number];

/** Strictness rank: lower = stricter. The effective mode is the minimum rank. */
export const AI_POLICY_MODE_RANK: Record<AiPolicyMode, number> = {
  off: 0,
  local_only: 1,
  remote_per_request: 2,
  remote_always: 3,
};

/** The three layers an AI policy can be attached to. */
export const AI_POLICY_SCOPES = ['server', 'knowledge_base', 'user'] as const;
export const aiPolicyScopeSchema = z.enum(AI_POLICY_SCOPES);
export type AiPolicyScope = (typeof AI_POLICY_SCOPES)[number];

/** A single layer's AI policy. */
export const aiPolicySchema = z.object({
  mode: aiPolicyModeSchema,
  /**
   * Separate consent for sending content to *remote* embedding providers
   * (AC4). Even when `mode` permits remote calls, remote embeddings stay
   * disabled until this is explicitly granted on every applicable layer.
   */
  remoteEmbeddings: z.boolean(),
});
export type AiPolicy = z.infer<typeof aiPolicySchema>;

/** Default policy applied when no row exists for a layer: No AI (AC1). */
export const DEFAULT_AI_POLICY: AiPolicy = { mode: 'off', remoteEmbeddings: false };

/** Partial update to a layer's policy. Rejects empty payloads. */
export const updateAiPolicySchema = z
  .object({
    mode: aiPolicyModeSchema.optional(),
    remoteEmbeddings: z.boolean().optional(),
  })
  .refine((v) => v.mode !== undefined || v.remoteEmbeddings !== undefined, {
    message: 'At least one of mode or remoteEmbeddings is required',
  });
export type UpdateAiPolicy = z.infer<typeof updateAiPolicySchema>;

/** The resolved effective policy for a given context (set of applicable layers). */
export const resolvedAiPolicySchema = z.object({
  mode: aiPolicyModeSchema,
  /** True when the effective mode permits remote provider calls. */
  remoteAllowed: z.boolean(),
  /** True when remote embeddings are permitted (remote allowed AND all layers consent). */
  remoteEmbeddingsAllowed: z.boolean(),
  /** True when remote calls require explicit per-request confirmation (AC3/AC5). */
  requiresPerRequestConfirmation: z.boolean(),
});
export type ResolvedAiPolicy = z.infer<typeof resolvedAiPolicySchema>;

/**
 * Resolve the effective AI policy from the **applicable** layers using
 * strictest-policy-wins (AC2). Pass only the layers that apply to the call:
 * server + user for non-KB calls, server + KB + user for KB-scoped calls.
 * An empty list (no policies configured anywhere) resolves to `off` (AC1).
 *
 * Note: a *missing* row for an applicable scope should be passed as
 * {@link DEFAULT_AI_POLICY} (= `off`); do NOT omit it. Omit a layer only when it
 * does not apply to the call (e.g. there is no Knowledge Base).
 */
export function resolveAiPolicy(policies: readonly AiPolicy[]): ResolvedAiPolicy {
  if (policies.length === 0) {
    return {
      mode: 'off',
      remoteAllowed: false,
      remoteEmbeddingsAllowed: false,
      requiresPerRequestConfirmation: false,
    };
  }
  const mode = policies.reduce<AiPolicyMode>(
    (strictest, p) =>
      AI_POLICY_MODE_RANK[p.mode] < AI_POLICY_MODE_RANK[strictest] ? p.mode : strictest,
    'remote_always',
  );
  const remoteAllowed = mode === 'remote_per_request' || mode === 'remote_always';
  return {
    mode,
    remoteAllowed,
    remoteEmbeddingsAllowed: remoteAllowed && policies.every((p) => p.remoteEmbeddings),
    requiresPerRequestConfirmation: remoteAllowed && mode === 'remote_per_request',
  };
}

// --- Remote call confirmation (AC5) ----------------------------------------

/**
 * Coarse categories describing *what kind* of content a remote AI call sends.
 * Surfaced in confirmation dialogs (AC5) and safe audit metadata (AC6); these
 * are categories, never the content itself.
 */
export const AI_CONTENT_CATEGORIES = [
  'note_text',
  'source_text',
  'entity_data',
  'claim_data',
  'search_query',
  'graph_context',
] as const;
export const aiContentCategorySchema = z.enum(AI_CONTENT_CATEGORIES);
export type AiContentCategory = (typeof AI_CONTENT_CATEGORIES)[number];

/**
 * The information shown to a user before a remote AI call so they can give
 * informed consent (AC5): which provider/model, what feature, and the
 * categories of content that would be sent — never the raw content.
 */
export const remoteCallConfirmationSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  feature: z.string().min(1),
  contentCategories: z.array(aiContentCategorySchema),
});
export type RemoteCallConfirmation = z.infer<typeof remoteCallConfirmationSchema>;

// --- Safe audit metadata for remote calls (AC6) ----------------------------

/**
 * Keys that must NEVER appear in remote-AI-call audit metadata (AC6): full
 * prompts, full note/source content, API keys, and full model responses. The
 * builder below uses an allowlist (not a denylist), but this list documents the
 * intent and is asserted by tests.
 */
export const REMOTE_AI_AUDIT_FORBIDDEN_KEYS = [
  'prompt',
  'prompts',
  'messages',
  'content',
  'input',
  'apiKey',
  'response',
  'completion',
  'text',
] as const;

/** Optional, non-sensitive token counts safe to record in audit metadata. */
export const remoteAiTokenCountsSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});
export type RemoteAiTokenCounts = z.infer<typeof remoteAiTokenCountsSchema>;

/** Safe audit metadata recorded for a remote AI call (AC6). */
export const remoteAiAuditMetadataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  feature: z.string().min(1),
  contentCategories: z.array(aiContentCategorySchema),
  tokenCounts: remoteAiTokenCountsSchema.optional(),
});
export type RemoteAiAuditMetadata = z.infer<typeof remoteAiAuditMetadataSchema>;

export interface RemoteAiAuditInput {
  provider: string;
  model: string;
  feature: string;
  contentCategories: AiContentCategory[];
  tokenCounts?: RemoteAiTokenCounts;
  /** Any extra fields are intentionally IGNORED (allowlist). */
  [key: string]: unknown;
}

/**
 * Build safe audit metadata for a remote AI call (AC6). This is an **allowlist**:
 * only the known-safe fields are copied through; full prompts, note/source
 * content, API keys, and model responses can never leak even if present on the
 * input. All future remote-AI call sites MUST record audit via this helper.
 */
export function buildRemoteAiAuditMetadata(input: RemoteAiAuditInput): RemoteAiAuditMetadata {
  return remoteAiAuditMetadataSchema.parse({
    provider: input.provider,
    model: input.model,
    feature: input.feature,
    contentCategories: input.contentCategories,
    tokenCounts: input.tokenCounts,
  });
}
