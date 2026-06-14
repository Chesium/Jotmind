import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_POLICY, type AiPolicy } from '@jotmind/schemas';
import type { AiPolicyStore, PolicyKey } from '../ai-policy/store.js';
import { MockEmbeddingProvider } from '../ai/mock.js';
import { runEmbeddingIndex } from './indexer.js';
import type { ConfiguredEmbeddingProvider } from './provider.js';
import type { EmbeddingStore, UpsertEmbeddingInput } from './store.js';
import type { EmbeddingTargetSource } from './targets.js';
import { toIndexableTarget, type IndexableTarget } from './content.js';

const KB = '11111111-1111-1111-1111-111111111111';

function memoryEmbeddingStore(): EmbeddingStore & { upserts: UpsertEmbeddingInput[] } {
  const upserts: UpsertEmbeddingInput[] = [];
  return {
    upserts,
    upsert(input) {
      upserts.push(input);
      return Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        knowledgeBaseId: input.knowledgeBaseId,
        targetType: input.targetType,
        targetId: input.targetId,
        model: input.model,
        dimensions: input.dimensions,
        contentHash: input.contentHash,
        embedding: input.embedding,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
    deleteByTarget: () => Promise.resolve(),
    getStats: () =>
      Promise.resolve({
        total: 0,
        counts: { entity: 0, claim: 0, note: 0, source: 0 },
        model: null,
        dimensions: null,
        lastIndexedAt: null,
      }),
    hasEmbeddings: () => Promise.resolve(false),
    vectorSearch: () => Promise.resolve([]),
  };
}

function memoryTargetSource(targets: IndexableTarget[]): EmbeddingTargetSource {
  return {
    listTargets: (_kb, types) =>
      Promise.resolve(targets.filter((t) => types.includes(t.targetType))),
  };
}

function memoryPolicyStore(policies: Partial<Record<string, AiPolicy>>): AiPolicyStore {
  const get = (key: PolicyKey): AiPolicy => policies[key.scope] ?? { ...DEFAULT_AI_POLICY };
  return {
    getPolicy: (key) => Promise.resolve(get(key)),
    getPolicies: (keys) => Promise.resolve(keys.map(get)),
    updatePolicy: () => Promise.reject(new Error('not supported')),
  };
}

function localProvider(): ConfiguredEmbeddingProvider {
  return {
    provider: new MockEmbeddingProvider('Mock Embeddings', 8),
    name: 'Mock Embeddings',
    kind: 'mock',
    model: null,
    demo: true,
    remote: false,
  };
}

function remoteProvider(): ConfiguredEmbeddingProvider {
  return { ...localProvider(), kind: 'openai', remote: true };
}

const sampleTargets: IndexableTarget[] = [
  toIndexableTarget('entity', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Person\nAda Lovelace')!,
  toIndexableTarget('claim', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'knows')!,
  toIndexableTarget('note', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'a note about Ada')!,
  toIndexableTarget('source', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'A source document')!,
];

const localAllowed: AiPolicy = { mode: 'local_only', remoteEmbeddings: false };
const remoteAllowedNoEmbeddings: AiPolicy = { mode: 'remote_always', remoteEmbeddings: false };
const remoteAllowedWithEmbeddings: AiPolicy = { mode: 'remote_always', remoteEmbeddings: true };
const remotePerRequestWithEmbeddings: AiPolicy = {
  mode: 'remote_per_request',
  remoteEmbeddings: true,
};

describe('runEmbeddingIndex', () => {
  it('indexes all four canonical kinds with a local provider (AC2)', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({ server: localAllowed, knowledge_base: localAllowed }),
        resolveProvider: localProvider,
      },
      { knowledgeBaseId: KB },
    );

    expect(result.status).toBe('indexed');
    expect(result.indexed).toBe(4);
    expect(result.counts).toEqual({ entity: 1, claim: 1, note: 1, source: 1 });
    expect(store.upserts).toHaveLength(4);
    // Each upsert carries a real vector of the provider's dimensionality.
    expect(store.upserts[0]?.embedding).toHaveLength(8);
    expect(store.upserts[0]?.dimensions).toBe(8);
  });

  it('honors a targetTypes filter', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({ server: localAllowed, knowledge_base: localAllowed }),
        resolveProvider: localProvider,
      },
      { knowledgeBaseId: KB, targetTypes: ['note'] },
    );

    expect(result.indexed).toBe(1);
    expect(store.upserts.map((u) => u.targetType)).toEqual(['note']);
  });

  it('skips when no provider is configured', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({ server: localAllowed, knowledge_base: localAllowed }),
        resolveProvider: () => null,
      },
      { knowledgeBaseId: KB },
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/no embedding provider/i);
    expect(store.upserts).toHaveLength(0);
  });

  it('skips when AI policy is off (default for fresh installs)', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({}),
        resolveProvider: localProvider,
      },
      { knowledgeBaseId: KB },
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/disabled by policy/i);
    expect(store.upserts).toHaveLength(0);
  });

  it('refuses a remote provider without remote-embeddings consent (AC3)', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({
          server: remoteAllowedNoEmbeddings,
          knowledge_base: remoteAllowedNoEmbeddings,
        }),
        resolveProvider: remoteProvider,
      },
      { knowledgeBaseId: KB },
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/remote embeddings/i);
    expect(store.upserts).toHaveLength(0);
  });

  it('allows a remote provider once remote embeddings are consented on all layers (AC3)', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({
          server: remoteAllowedWithEmbeddings,
          knowledge_base: remoteAllowedWithEmbeddings,
          user: remoteAllowedWithEmbeddings,
        }),
        resolveProvider: remoteProvider,
        remoteAiAuditStore: { recordRemoteCall: () => Promise.resolve() },
      },
      { knowledgeBaseId: KB, requestedBy: '99999999-9999-9999-9999-999999999999' },
    );

    expect(result.status).toBe('indexed');
    expect(store.upserts).toHaveLength(4);
  });

  it('skips a remote provider under per-request policy without matching confirmation', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({
          server: remotePerRequestWithEmbeddings,
          knowledge_base: remotePerRequestWithEmbeddings,
          user: remotePerRequestWithEmbeddings,
        }),
        resolveProvider: remoteProvider,
      },
      { knowledgeBaseId: KB, requestedBy: '99999999-9999-9999-9999-999999999999' },
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/confirmation/i);
    expect(store.upserts).toHaveLength(0);
  });

  it('indexes and audits a remote embedding call when per-request confirmation matches', async () => {
    const store = memoryEmbeddingStore();
    const audits: unknown[] = [];
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource(sampleTargets),
        aiPolicyStore: memoryPolicyStore({
          server: remotePerRequestWithEmbeddings,
          knowledge_base: remotePerRequestWithEmbeddings,
          user: remotePerRequestWithEmbeddings,
        }),
        resolveProvider: remoteProvider,
        remoteAiAuditStore: {
          recordRemoteCall: (input) => {
            audits.push(input);
            return Promise.resolve();
          },
        },
      },
      {
        knowledgeBaseId: KB,
        requestedBy: '99999999-9999-9999-9999-999999999999',
        remoteConfirmation: {
          provider: 'Mock Embeddings',
          model: 'default',
          feature: 'Embedding reindex',
          contentCategories: ['entity_data', 'claim_data', 'note_text', 'source_text'],
        },
      },
    );

    expect(result.status).toBe('indexed');
    expect(store.upserts).toHaveLength(4);
    expect(audits).toHaveLength(1);
  });

  it('returns indexed:0 when there is nothing to embed', async () => {
    const store = memoryEmbeddingStore();
    const result = await runEmbeddingIndex(
      {
        embeddingStore: store,
        targetSource: memoryTargetSource([]),
        aiPolicyStore: memoryPolicyStore({ server: localAllowed, knowledge_base: localAllowed }),
        resolveProvider: localProvider,
      },
      { knowledgeBaseId: KB },
    );

    expect(result.status).toBe('indexed');
    expect(result.indexed).toBe(0);
    expect(store.upserts).toHaveLength(0);
  });
});
