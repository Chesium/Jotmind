import { useEffect, useState } from 'react';
import {
  AI_POLICY_MODES,
  kbRoleSatisfies,
  type AiPolicy,
  type AiPolicyMode,
  type KnowledgeBase,
  type ResolvedAiPolicy,
} from '@jotmind/schemas';
import {
  getAiPolicyOverview,
  getKbAiPolicy,
  updateKbAiPolicy,
  updateMyAiPolicy,
  updateServerAiPolicy,
  type AiPolicyOverview,
  type KbAiPolicyView,
} from './api.js';

/** Human-readable labels for each AI policy mode. */
const MODE_LABELS: Record<AiPolicyMode, string> = {
  off: 'No AI',
  local_only: 'Local only',
  remote_per_request: 'Remote per request',
  remote_always: 'Remote always allowed',
};

function describeEffective(effective: ResolvedAiPolicy): string {
  if (effective.mode === 'off') return 'No AI is permitted.';
  if (effective.mode === 'local_only') return 'Only local AI providers are permitted.';
  const remote = effective.requiresPerRequestConfirmation
    ? 'Remote AI calls are permitted but require per-request confirmation.'
    : 'Remote AI calls are permitted without per-request confirmation.';
  const embeddings = effective.remoteEmbeddingsAllowed
    ? 'Remote embeddings are permitted.'
    : 'Remote embeddings are NOT permitted (separate consent required).';
  return `${remote} ${embeddings}`;
}

/** Editable controls for a single policy layer. */
function PolicyEditor({
  testidPrefix,
  policy,
  disabled,
  onSave,
}: {
  testidPrefix: string;
  policy: AiPolicy;
  disabled: boolean;
  onSave: (changes: { mode: AiPolicyMode; remoteEmbeddings: boolean }) => Promise<void>;
}) {
  const [mode, setMode] = useState<AiPolicyMode>(policy.mode);
  const [remoteEmbeddings, setRemoteEmbeddings] = useState(policy.remoteEmbeddings);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(policy.mode);
    setRemoteEmbeddings(policy.remoteEmbeddings);
  }, [policy.mode, policy.remoteEmbeddings]);

  const remoteSelected = mode === 'remote_per_request' || mode === 'remote_always';

  // US-029 AC5: Remote RAG context sharing (remote embeddings) requires an
  // additional prominent confirmation before it can be turned on. Remote
  // sharing stays minimal by default — turning it OFF needs no confirmation.
  function onToggleRemoteEmbeddings(checked: boolean) {
    if (checked) {
      const confirmed =
        typeof window === 'undefined' ||
        window.confirm(
          'Enable Remote RAG context sharing?\n\n' +
            'This sends your Knowledge Base content (entities, claims, notes) to a ' +
            'REMOTE embedding provider for indexing. Only enable this if you trust ' +
            'that provider with this data. You can disable it again at any time.',
        );
      if (!confirmed) return;
    }
    setRemoteEmbeddings(checked);
  }

  async function save() {
    setBusy(true);
    try {
      await onSave({ mode, remoteEmbeddings: remoteSelected ? remoteEmbeddings : false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>
        Mode{' '}
        <select
          value={mode}
          disabled={disabled || busy}
          data-testid={`${testidPrefix}-mode`}
          onChange={(e) => setMode(e.target.value as AiPolicyMode)}
        >
          {AI_POLICY_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        <input
          type="checkbox"
          checked={remoteSelected && remoteEmbeddings}
          disabled={disabled || busy || !remoteSelected}
          data-testid={`${testidPrefix}-remote-embeddings`}
          onChange={(e) => onToggleRemoteEmbeddings(e.target.checked)}
        />{' '}
        Allow remote embeddings (Remote RAG context sharing)
      </label>{' '}
      {!disabled && (
        <button
          type="button"
          disabled={busy}
          data-testid={`${testidPrefix}-save`}
          onClick={() => void save()}
        >
          Save
        </button>
      )}
    </div>
  );
}

/**
 * Server + user AI privacy policy settings (US-016). Rendered for any signed-in
 * user. The user layer is always editable; the server layer is editable only by
 * system admins, read-only otherwise. Shows the effective (strictest) non-KB
 * policy so users understand what is actually permitted.
 */
export function AiPolicySettings({ isAdmin, csrfToken }: { isAdmin: boolean; csrfToken: string }) {
  const [overview, setOverview] = useState<AiPolicyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    setLoading(true);
    setError(null);
    getAiPolicyOverview()
      .then(setOverview)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load AI policy'),
      )
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  return (
    <section aria-label="ai-policy" data-testid="ai-policy">
      <h3>AI privacy</h3>
      {error && <p data-testid="ai-policy-error">{error}</p>}
      {loading && <p data-testid="ai-policy-loading">Loading…</p>}
      {overview && (
        <>
          <p data-testid="ai-policy-effective">
            Effective policy: <strong>{MODE_LABELS[overview.effective.mode]}</strong> —{' '}
            {describeEffective(overview.effective)}
          </p>

          <h4>Server policy {isAdmin ? '' : '(read-only)'}</h4>
          <PolicyEditor
            testidPrefix="ai-policy-server"
            policy={overview.server}
            disabled={!isAdmin}
            onSave={async (changes) => {
              await updateServerAiPolicy(changes, csrfToken);
              reload();
            }}
          />

          <h4>My policy</h4>
          <PolicyEditor
            testidPrefix="ai-policy-user"
            policy={overview.user}
            disabled={false}
            onSave={async (changes) => {
              await updateMyAiPolicy(changes, csrfToken);
              reload();
            }}
          />
        </>
      )}
    </section>
  );
}

/**
 * Knowledge-Base AI privacy policy (US-016). Rendered inside a selected KB.
 * Reads are visible to any member; the KB layer is editable only by KB
 * admins/owners. Shows the effective policy folding in server + KB + user.
 */
export function KbAiPolicy({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const [view, setView] = useState<KbAiPolicyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canAdmin = kbRoleSatisfies(kb.role, 'admin');

  function reload() {
    setLoading(true);
    setError(null);
    getKbAiPolicy(kb.id)
      .then(setView)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load KB AI policy'),
      )
      .finally(() => setLoading(false));
  }

  useEffect(reload, [kb.id]);

  return (
    <section aria-label="kb-ai-policy" data-testid="kb-ai-policy">
      <h3>AI privacy — {kb.name}</h3>
      {error && <p data-testid="kb-ai-policy-error">{error}</p>}
      {loading && <p data-testid="kb-ai-policy-loading">Loading…</p>}
      {view && (
        <>
          <p data-testid="kb-ai-policy-effective">
            Effective policy: <strong>{MODE_LABELS[view.effective.mode]}</strong> —{' '}
            {describeEffective(view.effective)}
          </p>
          <h4>This Knowledge Base {canAdmin ? '' : '(read-only)'}</h4>
          <PolicyEditor
            testidPrefix="kb-ai-policy"
            policy={view.policy}
            disabled={!canAdmin}
            onSave={async (changes) => {
              await updateKbAiPolicy(kb.id, changes, csrfToken);
              reload();
            }}
          />
        </>
      )}
    </section>
  );
}
