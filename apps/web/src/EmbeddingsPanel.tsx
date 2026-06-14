import { useCallback, useEffect, useState } from 'react';
import {
  EMBEDDING_TARGET_TYPES,
  type EmbeddingStatus,
  type EmbeddingTargetType,
  type KnowledgeBase,
} from '@jotmind/schemas';
import { getEmbeddingStatus } from './api.js';
import { useInvalidationEffect } from './invalidation.js';

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
 * Selected-KB embedding status (US-048). This is read-only and viewer-visible:
 * vector search availability comes from stored embeddings, while generation
 * availability comes from the current provider + layered AI policy.
 */
export function EmbeddingsPanel({ kb }: { kb: KnowledgeBase }) {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        </>
      )}
    </section>
  );
}
