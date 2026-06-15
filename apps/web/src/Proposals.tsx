import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MOCK_EXTRACTION_LABEL,
  kbRoleSatisfies,
  proposalChangesSchema,
  type CaptureResponse,
  type KnowledgeBase,
  type Proposal,
  type ProposalChange,
  type ProposalChanges,
} from '@jotmind/schemas';
import {
  RemoteAiConfirmationRequiredError,
  acceptProposal,
  editProposal,
  listProposals,
  quickCapture,
  rejectProposal,
} from './api.js';
import { useInvalidate, useInvalidationEffect, AI_POLICY_STALE_MESSAGE } from './invalidation.js';
import { confirmRemoteAiCall } from './remoteConfirmation.js';

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
    const input = {
      kind: form.kind,
      title: form.title.trim() || undefined,
      content: form.content.trim(),
    };
    try {
      let result: CaptureResponse;
      try {
        result = await quickCapture(kb.id, input, csrfToken);
      } catch (err) {
        if (!(err instanceof RemoteAiConfirmationRequiredError)) throw err;
        if (!confirmRemoteAiCall(err.confirmation)) {
          throw new Error('Remote AI call cancelled.');
        }
        result = await quickCapture(kb.id, input, csrfToken, err.confirmation);
      }
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
  const [draftChanges, setDraftChanges] = useState<ProposalChanges>(proposal.changes);
  const [draft, setDraft] = useState('');
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const [propertyDrafts, setPropertyDrafts] = useState<Record<string, string>>({});
  const invalidate = useInvalidate();
  const visibleItems = editing ? draftChanges.items : items;

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
    const changes = cloneProposalChanges(proposal.changes);
    setDraftChanges(changes);
    setDraft(JSON.stringify(changes, null, 2));
    setPropertyDrafts(initialPropertyDrafts(changes));
    setRawJsonOpen(false);
    setEditing(true);
    setError(null);
  }

  function updateDraftItem(index: number, change: ProposalChange) {
    setDraftChanges((prev) => ({
      items: prev.items.map((item, i) => (i === index ? change : item)),
    }));
  }

  function updatePropertyDraft(index: number, value: string) {
    setPropertyDrafts((prev) => ({ ...prev, [propertyDraftKey(index)]: value }));
  }

  function toggleRawJson() {
    if (!rawJsonOpen) {
      setDraft(
        JSON.stringify(applyPropertyDrafts(draftChanges, propertyDrafts) ?? draftChanges, null, 2),
      );
    }
    setRawJsonOpen((open) => !open);
  }

  async function saveEdit() {
    let candidate: unknown;
    if (rawJsonOpen) {
      try {
        candidate = JSON.parse(draft);
      } catch {
        setError('Changes must be valid JSON.');
        return;
      }
    } else {
      candidate = applyPropertyDrafts(draftChanges, propertyDrafts);
      if (!candidate) {
        setError('Properties must be valid JSON objects.');
        return;
      }
    }

    const parsed = proposalChangesSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      setError(`Invalid proposal changes: ${path}${issue?.message ?? 'Check the edited fields.'}`);
      return;
    }
    await run(async () => {
      await editProposal(kbId, proposal.id, parsed.data, csrfToken);
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
        {visibleItems.map((change, i) => (
          <li key={i} data-testid={`proposal-change-${proposal.id}-${i}`}>
            {canEdit && !editing && (
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
          <fieldset>
            <legend>Structured changes</legend>
            {draftChanges.items.length === 0 ? (
              <p>No proposal items.</p>
            ) : (
              draftChanges.items.map((change, i) => (
                <ProposalChangeEditor
                  key={i}
                  proposalId={proposal.id}
                  index={i}
                  change={change}
                  propertyDraft={propertyDrafts[propertyDraftKey(i)] ?? '{}'}
                  onChange={(next) => updateDraftItem(i, next)}
                  onPropertyDraftChange={(value) => updatePropertyDraft(i, value)}
                />
              ))
            )}
          </fieldset>
          <button
            type="button"
            disabled={busy}
            onClick={toggleRawJson}
            data-testid={`proposal-edit-advanced-${proposal.id}`}
          >
            {rawJsonOpen ? 'Hide advanced JSON' : 'Advanced JSON'}
          </button>
          {rawJsonOpen && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              style={{ width: '100%', fontFamily: 'monospace' }}
              data-testid={`proposal-edit-json-${proposal.id}`}
            />
          )}
          <div
            style={{ marginTop: '0.5rem' }}
            data-testid={`proposal-edit-controls-${proposal.id}`}
          >
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
        </div>
      )}
    </li>
  );
}

function ProposalChangeEditor({
  proposalId,
  index,
  change,
  propertyDraft,
  onChange,
  onPropertyDraftChange,
}: {
  proposalId: string;
  index: number;
  change: ProposalChange;
  propertyDraft: string;
  onChange: (change: ProposalChange) => void;
  onPropertyDraftChange: (value: string) => void;
}) {
  const prefix = `proposal-edit-${proposalId}-${index}`;
  return (
    <fieldset data-testid={`${prefix}-structured`} style={{ marginTop: '0.75rem' }}>
      <legend>{change.op.replace('create_', 'Create ')}</legend>
      {change.op === 'create_entity' && (
        <>
          <label>
            Ref{' '}
            <input
              value={change.ref}
              onChange={(e) => onChange({ ...change, ref: e.target.value })}
              data-testid={`${prefix}-entity-ref`}
            />
          </label>{' '}
          <label>
            Type{' '}
            <input
              value={change.type}
              onChange={(e) => onChange({ ...change, type: e.target.value })}
              data-testid={`${prefix}-entity-type`}
            />
          </label>{' '}
          <label>
            Name{' '}
            <input
              value={change.name}
              onChange={(e) => onChange({ ...change, name: e.target.value })}
              data-testid={`${prefix}-entity-name`}
            />
          </label>
          <div>
            <label>
              Aliases{' '}
              <input
                value={(change.aliases ?? []).join(', ')}
                onChange={(e) => onChange({ ...change, aliases: splitCsv(e.target.value) })}
                data-testid={`${prefix}-entity-aliases`}
              />
            </label>
          </div>
          <div>
            <label>
              Tags{' '}
              <input
                value={(change.tags ?? []).join(', ')}
                onChange={(e) => onChange({ ...change, tags: splitCsv(e.target.value) })}
                data-testid={`${prefix}-entity-tags`}
              />
            </label>
          </div>
          <div>
            <label>
              Description{' '}
              <textarea
                value={change.description ?? ''}
                onChange={(e) =>
                  onChange({ ...change, description: optionalString(e.target.value) })
                }
                data-testid={`${prefix}-entity-description`}
              />
            </label>
          </div>
          <PropertiesTextarea
            testId={`${prefix}-entity-properties`}
            value={propertyDraft}
            onChange={onPropertyDraftChange}
          />
        </>
      )}
      {change.op === 'create_claim' && (
        <>
          <label>
            Predicate{' '}
            <input
              value={change.predicate}
              onChange={(e) => onChange({ ...change, predicate: e.target.value })}
              data-testid={`${prefix}-claim-predicate`}
            />
          </label>{' '}
          <label>
            Confidence{' '}
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={change.confidence ?? ''}
              onChange={(e) =>
                onChange({
                  ...change,
                  confidence: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              data-testid={`${prefix}-claim-confidence`}
            />
          </label>
          <div>
            <label>
              Valid start{' '}
              <input
                value={change.validStart ?? ''}
                placeholder="2020-01-01T00:00:00.000Z"
                onChange={(e) =>
                  onChange({ ...change, validStart: optionalString(e.target.value) })
                }
                data-testid={`${prefix}-claim-valid-start`}
              />
            </label>{' '}
            <label>
              Valid end{' '}
              <input
                value={change.validEnd ?? ''}
                placeholder="2020-12-31T00:00:00.000Z"
                onChange={(e) => onChange({ ...change, validEnd: optionalString(e.target.value) })}
                data-testid={`${prefix}-claim-valid-end`}
              />
            </label>
          </div>
          <div>
            <label>
              Description{' '}
              <textarea
                value={change.description ?? ''}
                onChange={(e) =>
                  onChange({ ...change, description: optionalString(e.target.value) })
                }
                data-testid={`${prefix}-claim-description`}
              />
            </label>
          </div>
          <fieldset>
            <legend>Arguments</legend>
            {change.arguments.map((arg, argIndex) => (
              <div key={argIndex} data-testid={`${prefix}-claim-arg-${argIndex}`}>
                <input
                  value={arg.role}
                  placeholder="role"
                  onChange={(e) =>
                    onChange({
                      ...change,
                      arguments: change.arguments.map((a, i) =>
                        i === argIndex ? { ...a, role: e.target.value } : a,
                      ),
                    })
                  }
                  data-testid={`${prefix}-claim-arg-role-${argIndex}`}
                />{' '}
                <select
                  value={arg.kind}
                  onChange={(e) => {
                    const nextArg =
                      e.target.value === 'literal'
                        ? { role: arg.role, kind: 'literal' as const, value: '' }
                        : { role: arg.role, kind: 'entity' as const, ref: '' };
                    onChange({
                      ...change,
                      arguments: change.arguments.map((a, i) => (i === argIndex ? nextArg : a)),
                    });
                  }}
                  data-testid={`${prefix}-claim-arg-kind-${argIndex}`}
                >
                  <option value="entity">Entity</option>
                  <option value="literal">Literal</option>
                </select>{' '}
                {arg.kind === 'literal' ? (
                  <input
                    value={String(arg.value ?? '')}
                    placeholder="literal value"
                    onChange={(e) =>
                      onChange({
                        ...change,
                        arguments: change.arguments.map((a, i) =>
                          i === argIndex ? { ...a, value: e.target.value } : a,
                        ),
                      })
                    }
                    data-testid={`${prefix}-claim-arg-value-${argIndex}`}
                  />
                ) : (
                  <input
                    value={arg.ref ?? ''}
                    placeholder="entity ref or id"
                    onChange={(e) =>
                      onChange({
                        ...change,
                        arguments: change.arguments.map((a, i) =>
                          i === argIndex ? { ...a, ref: e.target.value } : a,
                        ),
                      })
                    }
                    data-testid={`${prefix}-claim-arg-ref-${argIndex}`}
                  />
                )}{' '}
                <button
                  type="button"
                  disabled={change.arguments.length <= 1}
                  onClick={() =>
                    onChange({
                      ...change,
                      arguments: change.arguments.filter((_, i) => i !== argIndex),
                    })
                  }
                  data-testid={`${prefix}-claim-arg-remove-${argIndex}`}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...change,
                  arguments: [
                    ...change.arguments,
                    { role: 'object', kind: 'entity' as const, ref: '' },
                  ],
                })
              }
              data-testid={`${prefix}-claim-arg-add`}
            >
              Add argument
            </button>
          </fieldset>
          <PropertiesTextarea
            testId={`${prefix}-claim-properties`}
            value={propertyDraft}
            onChange={onPropertyDraftChange}
          />
        </>
      )}
      {change.op === 'create_note' && (
        <>
          <label>
            Title{' '}
            <input
              value={change.title ?? ''}
              onChange={(e) => onChange({ ...change, title: optionalString(e.target.value) })}
              data-testid={`${prefix}-note-title`}
            />
          </label>
          <div>
            <label>
              Content{' '}
              <textarea
                value={change.content}
                onChange={(e) => onChange({ ...change, content: e.target.value })}
                data-testid={`${prefix}-note-content`}
              />
            </label>
          </div>
          <PropertiesTextarea
            testId={`${prefix}-note-properties`}
            value={propertyDraft}
            onChange={onPropertyDraftChange}
          />
        </>
      )}
      {change.op === 'create_source' && (
        <>
          <label>
            Title{' '}
            <input
              value={change.title}
              onChange={(e) => onChange({ ...change, title: e.target.value })}
              data-testid={`${prefix}-source-title`}
            />
          </label>{' '}
          <label>
            Type{' '}
            <input
              value={change.sourceType ?? ''}
              onChange={(e) => onChange({ ...change, sourceType: optionalString(e.target.value) })}
              data-testid={`${prefix}-source-type`}
            />
          </label>
          <div>
            <label>
              URI{' '}
              <input
                value={change.uri ?? ''}
                onChange={(e) => onChange({ ...change, uri: optionalString(e.target.value) })}
                data-testid={`${prefix}-source-uri`}
              />
            </label>
          </div>
          <div>
            <label>
              Content{' '}
              <textarea
                value={change.content ?? ''}
                onChange={(e) => onChange({ ...change, content: optionalString(e.target.value) })}
                data-testid={`${prefix}-source-content`}
              />
            </label>
          </div>
          <PropertiesTextarea
            testId={`${prefix}-source-properties`}
            value={propertyDraft}
            onChange={onPropertyDraftChange}
          />
        </>
      )}
    </fieldset>
  );
}

function PropertiesTextarea({
  testId,
  value,
  onChange,
}: {
  testId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label>
        Properties JSON{' '}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'monospace' }}
          data-testid={testId}
        />
      </label>
    </div>
  );
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function splitCsv(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function propertyDraftKey(index: number): string {
  return String(index);
}

function cloneProposalChanges(changes: ProposalChanges): ProposalChanges {
  return proposalChangesSchema.parse(JSON.parse(JSON.stringify(changes)));
}

function initialPropertyDrafts(changes: ProposalChanges): Record<string, string> {
  return Object.fromEntries(
    changes.items.map((change, index) => [
      propertyDraftKey(index),
      JSON.stringify(change.properties ?? {}, null, 2),
    ]),
  );
}

function parseProperties(value: string): Record<string, unknown> | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function withProperties(change: ProposalChange, properties: Record<string, unknown> | undefined) {
  const next = { ...change };
  if (properties === undefined) delete next.properties;
  else next.properties = properties;
  return next;
}

function applyPropertyDrafts(
  changes: ProposalChanges,
  drafts: Record<string, string>,
): ProposalChanges | null {
  const items: ProposalChange[] = [];
  for (const [index, change] of changes.items.entries()) {
    const parsed = parseProperties(drafts[propertyDraftKey(index)] ?? '{}');
    if (parsed === null) return null;
    items.push(withProperties(change, parsed) as ProposalChange);
  }
  return { items };
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
