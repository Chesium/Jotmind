import { useCallback, useEffect, useState } from 'react';
import {
  EMBEDDING_TARGET_TYPES,
  kbRoleSatisfies,
  type EmbeddingStatus,
  type EmbeddingTargetType,
  type KnowledgeBase,
  type ReindexEmbeddingsResponse,
} from '@jotmind/schemas';
import { getEmbeddingStatus, reindexEmbeddings } from './api.js';
import { useInvalidate, useInvalidationEffect } from './invalidation.js';

const TARGET_LABELS: Record<EmbeddingTargetType, string> = {
  entity: 'Entities',
  claim: 'Claims',
  note: 'Notes',
  source: 'Sources',
};

function formatOptional(value: string | number | null): string {
  return value === null ? 'Not available' : String(value);
}

function formatDate(value: string | null): string {
  return value === null ? 'Not indexed yet' : new Date(value).toLocaleString();
}

/**
 * Selected-KB embedding status (US-048/US-049). This is viewer-visible:
 * vector search availability comes from stored embeddings, while generation
 * availability comes from the current provider + layered AI policy. Editors can
 * enqueue durable reindex jobs without making AI calls directly in the browser.
 */
export function EmbeddingsPanel({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<EmbeddingTargetType[]>([
    ...EMBEDDING_TARGET_TYPES,
  ]);
  const [queuedJob, setQueuedJob] = useState<ReindexEmbeddingsResponse | null>(null);
  const invalidate = useInvalidate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getEmbeddingStatus(kb.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load embedding status');
    } finally {
      setLoading(false);
    }
  }, [kb.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Generation availability depends on AI policy; stored counts change when an
  // indexing job completes. Re-read the backend status when either domain moves.
  useInvalidationEffect(['aiPolicy', 'jobs'], () => void load());

  function toggleTarget(targetType: EmbeddingTargetType, checked: boolean) {
    setSelectedTargets((current) =>
      checked ? [...current, targetType] : current.filter((t) => t !== targetType),
    );
  }

  async function submitReindex() {
    if (selectedTargets.length === 0) return;
    setBusy(true);
    setError(null);
    setQueuedJob(null);
    try {
      const res = await reindexEmbeddings(kb.id, { targetTypes: selectedTargets }, csrfToken);
      setQueuedJob(res);
      invalidate(['jobs']);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not enqueue embedding reindex');
    } finally {
      setBusy(false);
    }
  }

  const remoteEmbeddingConsentBlocked =
    status?.reason?.toLowerCase().includes('remote embeddings') ?? false;

  return (
    <section aria-label="embeddings" data-testid="embeddings-panel">
      <h3>Embeddings - {kb.name}</h3>
      {error && <p data-testid="embeddings-error">{error}</p>}
      {loading && <p data-testid="embeddings-loading">Loading...</p>}
      {status && (
        <>
          <ul>
            <li data-testid="embeddings-vector-status">
              Vector search:{' '}
              <strong>{status.vectorSearchAvailable ? 'Available' : 'Unavailable'}</strong>
            </li>
            <li data-testid="embeddings-generation-status">
              Generation:{' '}
              <strong>{status.generationAvailable ? 'Available' : 'Unavailable'}</strong>
            </li>
          </ul>
          {status.reason && (
            <p data-testid="embeddings-reason" role="status">
              {status.reason}
            </p>
          )}

          <h4>Index summary</h4>
          <ul>
            <li data-testid="embeddings-total">Total embeddings: {status.total}</li>
            {EMBEDDING_TARGET_TYPES.map((targetType) => (
              <li key={targetType} data-testid={`embeddings-count-${targetType}`}>
                {TARGET_LABELS[targetType]}: {status.counts[targetType]}
              </li>
            ))}
          </ul>

          <h4>Latest embedding</h4>
          <ul>
            {status.model && <li data-testid="embeddings-model">Model: {status.model}</li>}
            {status.dimensions !== null && (
              <li data-testid="embeddings-dimensions">Dimensions: {status.dimensions}</li>
            )}
            <li data-testid="embeddings-last-indexed">
              Last indexed: {formatDate(status.lastIndexedAt)}
            </li>
            {status.providerKind && (
              <li data-testid="embeddings-provider-kind">
                Provider kind: {formatOptional(status.providerKind)}
              </li>
            )}
          </ul>

          <h4>Reindex embeddings</h4>
          {remoteEmbeddingConsentBlocked && (
            <p data-testid="embeddings-remote-consent">
              Remote embedding consent is separate from remote LLM consent.
            </p>
          )}
          {canEdit ? (
            <form
              className="stack-form compact-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReindex();
              }}
            >
              <fieldset>
                <legend>Target types</legend>
                {EMBEDDING_TARGET_TYPES.map((targetType) => (
                  <label key={targetType}>
                    <input
                      type="checkbox"
                      checked={selectedTargets.includes(targetType)}
                      data-testid={`embeddings-target-${targetType}`}
                      onChange={(e) => toggleTarget(targetType, e.target.checked)}
                    />{' '}
                    {TARGET_LABELS[targetType]}
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                disabled={busy || selectedTargets.length === 0}
                data-testid="embeddings-reindex-submit"
              >
                {busy ? 'Queueing...' : 'Reindex embeddings'}
              </button>
            </form>
          ) : (
            <p data-testid="embeddings-readonly">You need editor access to reindex embeddings.</p>
          )}
          {selectedTargets.length === 0 && canEdit && (
            <p data-testid="embeddings-target-error">Select at least one target type.</p>
          )}
          {queuedJob && (
            <p data-testid="embeddings-reindex-job" role="status">
              Reindex job {queuedJob.jobId.slice(0, 8)} queued with status{' '}
              <strong>{queuedJob.status}</strong>. Track it in the Knowledge Base job status panel.
            </p>
          )}
        </>
      )}
    </section>
  );
}
