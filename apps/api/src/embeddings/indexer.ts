import {
  EMBEDDING_TARGET_TYPES,
  resolveAiPolicy,
  type EmbeddingCounts,
  type EmbeddingIndexResult,
  type EmbeddingTargetType,
} from '@jotmind/schemas';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import type { EmbeddingStore } from './store.js';
import type { EmbeddingTargetSource } from './targets.js';
import { resolveEmbeddingProviderFromEnv, type ConfiguredEmbeddingProvider } from './provider.js';

/** Dependencies for {@link runEmbeddingIndex}. Injectable for unit tests. */
export interface EmbeddingIndexDeps {
  embeddingStore: EmbeddingStore;
  targetSource: EmbeddingTargetSource;
  aiPolicyStore: AiPolicyStore;
  /** Resolve the configured embedding provider, or null when none is set. */
  resolveProvider: () => ConfiguredEmbeddingProvider | null;
}

export interface RunEmbeddingIndexInput {
  knowledgeBaseId: string;
  targetTypes?: EmbeddingTargetType[];
  /** The requesting user, whose AI policy layer also applies. */
  requestedBy?: string | null;
}

const ZERO_COUNTS: EmbeddingCounts = { entity: 0, claim: 0, note: 0, source: 0 };

function skipped(reason: string): EmbeddingIndexResult {
  return { status: 'skipped', reason, indexed: 0, counts: { ...ZERO_COUNTS } };
}

/**
 * Generate and store embeddings for a Knowledge Base's canonical records
 * (US-021). Enforces the layered AI policy (US-016): skips when AI is off, and
 * requires the SEPARATE remote-embeddings consent before using a remote provider
 * (AC3). Indexes entities/claims/notes/sources (aliases + tags fold into entity
 * content, AC2). Embeds in one batch and upserts so re-indexing is idempotent.
 */
export async function runEmbeddingIndex(
  deps: EmbeddingIndexDeps,
  input: RunEmbeddingIndexInput,
): Promise<EmbeddingIndexResult> {
  const configured = deps.resolveProvider();
  if (!configured) {
    return skipped('No embedding provider is configured');
  }

  // Resolve the applicable AI policy layers (server + KB + requesting user).
  const keys: PolicyKey[] = [
    { scope: 'server', scopeId: null },
    { scope: 'knowledge_base', scopeId: input.knowledgeBaseId },
  ];
  if (input.requestedBy) {
    keys.push({ scope: 'user', scopeId: input.requestedBy });
  }
  const policies = await deps.aiPolicyStore.getPolicies(keys);
  const resolved = resolveAiPolicy(policies);

  if (resolved.mode === 'off') {
    return skipped('AI is disabled by policy');
  }
  // Remote embeddings need their own explicit consent on every layer (AC3).
  if (configured.remote && !resolved.remoteEmbeddingsAllowed) {
    return skipped('Remote embeddings are not permitted by policy');
  }

  const targetTypes = input.targetTypes ?? [...EMBEDDING_TARGET_TYPES];
  const targets = await deps.targetSource.listTargets(input.knowledgeBaseId, targetTypes);
  if (targets.length === 0) {
    return { status: 'indexed', reason: null, indexed: 0, counts: { ...ZERO_COUNTS } };
  }

  const result = await configured.provider.embed({
    input: targets.map((t) => t.content),
    ...(configured.model ? { model: configured.model } : {}),
  });
  const vectors = result.embeddings;
  const model = result.model;

  const counts: EmbeddingCounts = { ...ZERO_COUNTS };
  let indexed = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const vector = vectors[i];
    if (!target || !vector) continue;
    await deps.embeddingStore.upsert({
      knowledgeBaseId: input.knowledgeBaseId,
      targetType: target.targetType,
      targetId: target.targetId,
      model,
      dimensions: result.dimensions,
      contentHash: target.contentHash,
      embedding: vector,
    });
    counts[target.targetType] += 1;
    indexed += 1;
  }

  return { status: 'indexed', reason: null, indexed, counts };
}

export { resolveEmbeddingProviderFromEnv };
