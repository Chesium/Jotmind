import {
  EMBEDDING_INDEX_JOB_TYPE,
  GRAPH_REBUILD_JOB_TYPE,
  IMPORT_JOB_TYPE,
  embeddingIndexJobPayloadSchema,
  graphRebuildJobPayloadSchema,
  importJobPayloadSchema,
} from '@jotmind/schemas';
import { dbAiPolicyStore } from '../ai-policy/store.js';
import { dbProposalStore } from '../proposals/store.js';
import { runImport } from '../imports/runner.js';
import { dbEmbeddingStore } from '../embeddings/store.js';
import { dbEmbeddingTargetSource } from '../embeddings/targets.js';
import { resolveEmbeddingProviderFromEnv } from '../embeddings/provider.js';
import { runEmbeddingIndex } from '../embeddings/indexer.js';
import { ageProjector } from '../graph/age-projector.js';
import {
  dbProjectionStatusStore,
  dbProjectionStore,
  rebuildProjection,
} from '../graph/projector.js';
import type { JobHandlerRegistry } from './worker.js';

/**
 * Registry of job handlers keyed by job `type`. Later stories register their
 * handlers here (US-018 AI proposals, imports/exports, and the AGE projection
 * worker). The built-in `noop` handler exists so the worker can be smoke-tested
 * end-to-end.
 *
 * Handlers are self-contained: they resolve their dependencies from the default
 * DB-backed stores + env config, so they work identically in the in-process
 * worker and the separate-process worker (`worker-process.ts`).
 */
export const defaultJobHandlers: JobHandlerRegistry = {
  noop: (job) => Promise.resolve({ ok: true, jobId: job.id }),

  // Vector embedding indexing (US-021). Generates and stores pgvector
  // embeddings for a Knowledge Base's canonical records, enforcing the layered
  // AI policy (incl. the separate remote-embeddings consent).
  [EMBEDDING_INDEX_JOB_TYPE]: async (job) => {
    const payload = embeddingIndexJobPayloadSchema.parse(job.payload ?? {});
    const result = await runEmbeddingIndex(
      {
        embeddingStore: dbEmbeddingStore,
        targetSource: dbEmbeddingTargetSource,
        aiPolicyStore: dbAiPolicyStore,
        resolveProvider: resolveEmbeddingProviderFromEnv,
      },
      {
        knowledgeBaseId: payload.knowledgeBaseId,
        ...(payload.targetTypes ? { targetTypes: payload.targetTypes } : {}),
        requestedBy: payload.requestedBy ?? null,
      },
    );
    return { ...result };
  },

  // Reviewable data import (US-031). Parses imported text/Markdown/CSV into
  // candidate graph changes and stores them as a single pending proposal — it
  // never mutates canonical records directly. Self-contained so it runs
  // identically in the in-process and separate-process workers.
  [IMPORT_JOB_TYPE]: async (job) => {
    const payload = importJobPayloadSchema.parse(job.payload ?? {});
    const result = await runImport({ proposalStore: dbProposalStore }, payload);
    return { ...result };
  },

  // AGE graph projection rebuild/repair (US-026). Regenerates the derived AGE
  // projection from the canonical relational tables, driving the projection
  // status through rebuilding -> synchronized (or failed). Self-contained so it
  // runs identically in the in-process and separate-process workers.
  [GRAPH_REBUILD_JOB_TYPE]: async (job) => {
    const payload = graphRebuildJobPayloadSchema.parse(job.payload ?? {});
    const result = await rebuildProjection({
      store: dbProjectionStore,
      statusStore: dbProjectionStatusStore,
      projector: ageProjector,
      jobId: job.id,
      ...(payload.knowledgeBaseId ? { knowledgeBaseId: payload.knowledgeBaseId } : {}),
    });
    return { ...result };
  },
};
