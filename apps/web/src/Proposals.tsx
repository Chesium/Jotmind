import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MOCK_EXTRACTION_LABEL,
  kbRoleSatisfies,
  type CaptureResponse,
  type KnowledgeBase,
  type Proposal,
  type ProposalChange,
} from '@jotmind/schemas';
import {
  acceptProposal,
  editProposal,
  listProposals,
  quickCapture,
  rejectProposal,
} from './api.js';
import { useInvalidate, useInvalidationEffect, AI_POLICY_STALE_MESSAGE } from './invalidation.js';

/**
 * Quick-capture + AI proposal review queue (US-017/US-018). Captured text is
 * stored as a Note/Source first (never lost), then — when AI is configured and
 * permitted by policy — extraction queues candidate graph changes as pending
 * Proposals. With no AI the capture still succeeds and an unavailable state is
 * shown. Editors can review the queue: accept the whole batch or selected items
 * (which creates canonical entities/claims preserving provenance), edit the
 * structured changes, or reject (the proposal stays linked to its source).
 */
export function Proposals({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [form, setForm] = useState({ kind: 'note' as 'note' | 'source', title: '', content: '' });
  const [lastResult, setLastResult] = useState<CaptureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policyStale, setPolicyStale] = useState(false);

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
    setPolicyStale(false);
    void refresh();
  }, [refresh]);

  // Refresh the pending queue when proposals change elsewhere — e.g. an import
  // job completes and produces a pending proposal in another panel (US-040 AC3).
  useInvalidationEffect(['proposals'], () => void refresh());

  // Mark the last capture's AI-availability outcome stale when any AI policy
  // layer changes (US-045 AC4) — the next capture reflects the new policy.
  useInvalidationEffect(['aiPolicy'], () => setPolicyStale(true));

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
      setPolicyStale(false);
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
      {lastResult && policyStale && (
        <p data-testid="capture-ai-policy-stale">{AI_POLICY_STALE_MESSAGE}</p>
      )}

      <h4>Pending proposals</h4>
      {proposals.length === 0 ? (
        <p data-testid="proposals-empty">No pending proposals.</p>
      ) : (
        <ul data-testid="proposals-list">
          {proposals.map((p) => (
            <ProposalItem
              key={p.id}
              proposal={p}
              kbId={kb.id}
              csrfToken={csrfToken}
              canEdit={canEdit}
              onReviewed={refresh}
            />
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

/**
 * Render one pending proposal with its candidate changes and review controls.
 * Editors can select a subset of items (item-level accept), accept the whole
 * batch, reject the proposal, or edit its structured changes as JSON.
 */
function ProposalItem({
  proposal,
  kbId,
  csrfToken,
  canEdit,
  onReviewed,
}: {
  proposal: Proposal;
  kbId: string;
  csrfToken: string;
  canEdit: boolean;
  onReviewed: () => void | Promise<void>;
}) {
  const isDemo = proposal.metadata?.demo === true;
  const items = proposal.changes.items;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const invalidate = useInvalidate();

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function accept(itemIndexes?: number[]) {
    void run(async () => {
      await acceptProposal(kbId, proposal.id, itemIndexes ? { itemIndexes } : {}, csrfToken);
      // Accepting creates canonical entities/claims/notes/sources, so refresh
      // every sibling panel that reads graph data plus derived AI surfaces, and
      // remove this proposal from pending queues (US-039 AC1).
      invalidate([
        'proposals',
        'entities',
        'claims',
        'notes',
        'sources',
        'sourceExcerpts',
        'graphViews',
        'searchResults',
        'answers',
        'audit',
      ]);
    });
  }

  function reject() {
    void run(() => rejectProposal(kbId, proposal.id, {}, csrfToken));
  }

  function startEdit() {
    setDraft(JSON.stringify(proposal.changes, null, 2));
    setEditing(true);
    setError(null);
  }

  async function saveEdit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError('Changes must be valid JSON.');
      return;
    }
    await run(async () => {
      await editProposal(kbId, proposal.id, parsed as never, csrfToken);
      setEditing(false);
    });
  }

  return (
    <li data-testid={`proposal-${proposal.id}`} style={{ marginBottom: '0.75rem' }}>
      <div>
        <strong>{proposal.kind}</strong> — {proposal.status}
        {proposal.provider && <> · {proposal.provider}</>}
        {isDemo && <em data-testid={`proposal-demo-${proposal.id}`}> ({MOCK_EXTRACTION_LABEL})</em>}
      </div>
      {(proposal.sourceNoteId || proposal.sourceSourceId) && (
        <div data-testid={`proposal-source-${proposal.id}`} style={{ fontSize: '0.85em' }}>
          Source: {proposal.sourceNoteId ? `note ${proposal.sourceNoteId}` : ''}
          {proposal.sourceSourceId ? `source ${proposal.sourceSourceId}` : ''}
        </div>
      )}
      <ul>
        {items.map((change, i) => (
          <li key={i} data-testid={`proposal-change-${proposal.id}-${i}`}>
            {canEdit && (
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                data-testid={`proposal-select-${proposal.id}-${i}`}
                aria-label={`Select change ${i + 1}`}
              />
            )}{' '}
            {describeChange(change)}
          </li>
        ))}
      </ul>
      {error && (
        <p data-testid={`proposal-error-${proposal.id}`} style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      {canEdit && !editing && (
        <div data-testid={`proposal-actions-${proposal.id}`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => accept()}
            data-testid={`proposal-accept-${proposal.id}`}
          >
            Accept all
          </button>{' '}
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => accept([...selected].sort((a, b) => a - b))}
            data-testid={`proposal-accept-selected-${proposal.id}`}
          >
            Accept selected ({selected.size})
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            data-testid={`proposal-reject-${proposal.id}`}
          >
            Reject
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={startEdit}
            data-testid={`proposal-edit-${proposal.id}`}
          >
            Edit
          </button>
        </div>
      )}
      {canEdit && editing && (
        <div data-testid={`proposal-edit-form-${proposal.id}`}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            style={{ width: '100%', fontFamily: 'monospace' }}
            data-testid={`proposal-edit-json-${proposal.id}`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveEdit()}
            data-testid={`proposal-edit-save-${proposal.id}`}
          >
            Save changes
          </button>{' '}
          <button type="button" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function describeChange(change: ProposalChange): string {
  if (change.op === 'create_entity') {
    return `New ${change.type}: ${change.name}`;
  }
  if (change.op === 'create_note') {
    return `New note: ${change.title ?? change.content.slice(0, 60)}`;
  }
  if (change.op === 'create_source') {
    return `New source: ${change.title}`;
  }
  const args = change.arguments
    .map((a) => `${a.role}=${a.kind === 'entity' ? (a.ref ?? '?') : JSON.stringify(a.value)}`)
    .join(', ');
  return `New claim: ${change.predicate} (${args})`;
}
