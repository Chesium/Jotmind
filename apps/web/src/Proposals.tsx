import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MOCK_EXTRACTION_LABEL,
  kbRoleSatisfies,
  type CaptureResponse,
  type KnowledgeBase,
  type Proposal,
  type ProposalChange,
} from '@jotmind/schemas';
import { listProposals, quickCapture } from './api.js';

/**
 * Quick-capture + AI proposal review queue (US-017). Captured text is stored as
 * a Note/Source first (never lost), then — when AI is configured and permitted
 * by policy — extraction queues candidate graph changes as pending Proposals.
 * With no AI the capture still succeeds and an unavailable state is shown. The
 * queue here is read-only; reviewing/accepting/rejecting proposals arrives in
 * US-018.
 */
export function Proposals({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [form, setForm] = useState({ kind: 'note' as 'note' | 'source', title: '', content: '' });
  const [lastResult, setLastResult] = useState<CaptureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setProposals(await listProposals(kb.id, 'pending'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load proposals');
    }
  }, [kb.id]);

  useEffect(() => {
    setForm({ kind: 'note', title: '', content: '' });
    setLastResult(null);
    void refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.content.trim()) {
      setError('Enter some text to capture.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await quickCapture(
        kb.id,
        {
          kind: form.kind,
          title: form.title.trim() || undefined,
          content: form.content.trim(),
        },
        csrfToken,
      );
      setLastResult(result);
      setForm({ kind: form.kind, title: '', content: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture text');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="proposals" style={{ marginTop: '1.5rem' }}>
      <h3>Quick capture &amp; AI proposals</h3>
      {error && (
        <p data-testid="proposals-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      {canEdit ? (
        <form onSubmit={submit} data-testid="capture-form">
          <div>
            <label>
              Store as{' '}
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm((f) => ({ ...f, kind: e.target.value as 'note' | 'source' }))
                }
                data-testid="capture-kind"
              >
                <option value="note">Note</option>
                <option value="source">Source</option>
              </select>
            </label>
          </div>
          <div>
            <input
              type="text"
              placeholder="Title (optional)"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              data-testid="capture-title"
            />
          </div>
          <div>
            <textarea
              placeholder="Paste or type text to capture…"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              data-testid="capture-content"
              rows={4}
            />
          </div>
          <button type="submit" disabled={busy} data-testid="capture-submit">
            {busy ? 'Capturing…' : 'Capture'}
          </button>
        </form>
      ) : (
        <p data-testid="capture-readonly">
          You have read-only access; capture requires editor role.
        </p>
      )}

      {lastResult && <CaptureOutcome result={lastResult} />}

      <h4>Pending proposals</h4>
      {proposals.length === 0 ? (
        <p data-testid="proposals-empty">No pending proposals.</p>
      ) : (
        <ul data-testid="proposals-list">
          {proposals.map((p) => (
            <ProposalItem key={p.id} proposal={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Summarize the outcome of the most recent quick-capture. */
function CaptureOutcome({ result }: { result: CaptureResponse }) {
  const { extraction } = result;
  const stored = result.note ? 'note' : 'source';
  return (
    <div data-testid="capture-outcome" style={{ marginTop: '0.5rem' }}>
      <p>
        Saved as <strong>{stored}</strong>.{' '}
        {extraction.status === 'created' && (
          <span data-testid="capture-extracted">
            AI proposed {extraction.proposal?.changes.items.length ?? 0} change(s) for review.
          </span>
        )}
        {extraction.status === 'empty' && (
          <span data-testid="capture-empty">AI found nothing to propose.</span>
        )}
        {extraction.status === 'unavailable' && (
          <span data-testid="capture-unavailable">
            AI extraction unavailable: {extraction.availability.reason ?? 'not configured'}.
          </span>
        )}
        {extraction.status === 'error' && (
          <span data-testid="capture-error">AI extraction failed: {extraction.error}.</span>
        )}
      </p>
      {extraction.availability.demo && (
        <p data-testid="capture-demo-label" style={{ fontStyle: 'italic' }}>
          {extraction.availability.label ?? MOCK_EXTRACTION_LABEL}
        </p>
      )}
    </div>
  );
}

/** Render one pending proposal with its candidate changes. */
function ProposalItem({ proposal }: { proposal: Proposal }) {
  const isDemo = proposal.metadata?.demo === true;
  return (
    <li data-testid={`proposal-${proposal.id}`} style={{ marginBottom: '0.75rem' }}>
      <div>
        <strong>{proposal.kind}</strong> — {proposal.status}
        {proposal.provider && <> · {proposal.provider}</>}
        {isDemo && <em data-testid={`proposal-demo-${proposal.id}`}> ({MOCK_EXTRACTION_LABEL})</em>}
      </div>
      <ul>
        {proposal.changes.items.map((change, i) => (
          <li key={i} data-testid={`proposal-change-${proposal.id}-${i}`}>
            {describeChange(change)}
          </li>
        ))}
      </ul>
    </li>
  );
}

function describeChange(change: ProposalChange): string {
  if (change.op === 'create_entity') {
    return `New ${change.type}: ${change.name}`;
  }
  const args = change.arguments
    .map((a) => `${a.role}=${a.kind === 'entity' ? (a.ref ?? '?') : JSON.stringify(a.value)}`)
    .join(', ');
  return `New claim: ${change.predicate} (${args})`;
}
