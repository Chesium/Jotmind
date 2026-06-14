import { useEffect, useState } from 'react';
import {
  AI_POLICY_MODES,
  kbRoleSatisfies,
  type AiPolicy,
  type AiPolicyMode,
  type AiProviderClassification,
  type AiProviderKind,
  type AiProviderStatus,
  type KnowledgeBase,
  type ResolvedAiPolicy,
} from '@jotmind/schemas';
import { useInvalidate, useInvalidationEffect } from './invalidation.js';
import {
  getAiPolicyOverview,
  getAiProviderStatus,
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

/** Human-readable labels for each provider kind. */
const PROVIDER_KIND_LABELS: Record<AiProviderKind, string> = {
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI-compatible',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  mock: 'Mock',
};

/** Human-readable labels for the local/remote/demo classification. */
const PROVIDER_CLASSIFICATION_LABELS: Record<AiProviderClassification, string> = {
  local: 'Local',
  remote: 'Remote (sends data off-box)',
  demo: 'Demo (deterministic)',
};

/**
 * Read-only AI provider configuration + readiness (US-046). Shows operators
 * which provider is active and whether it is usable WITHOUT exposing any
 * secrets (the backend strips API keys, AC4). Provider configuration is managed
 * by the server environment and cannot be edited in the browser (AC3).
 */
export function AiProviderStatusPanel() {
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAiProviderStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load AI provider');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-label="ai-provider" data-testid="ai-provider">
      <h4>AI provider</h4>
      {error && <p data-testid="ai-provider-error">{error}</p>}
      {loading && <p data-testid="ai-provider-loading">Loading…</p>}
      {status && !status.configured && (
        <p data-testid="ai-provider-not-configured">
          No AI provider is configured. AI features are unavailable until a provider is set in the
          server environment.
        </p>
      )}
      {status && status.configured && (
        <ul>
          <li data-testid="ai-provider-kind">
            Provider: <strong>{PROVIDER_KIND_LABELS[status.kind ?? 'mock']}</strong>
          </li>
          {status.name && <li data-testid="ai-provider-name">Name: {status.name}</li>}
          {status.classification && (
            <li data-testid="ai-provider-classification">
              Classification: {PROVIDER_CLASSIFICATION_LABELS[status.classification]}
            </li>
          )}
          <li data-testid="ai-provider-readiness">
            Readiness:{' '}
            {status.verified ? 'Ready (verified)' : 'Configured but unverified (untested in V1)'}
          </li>
          <li data-testid="ai-provider-llm-model">LLM model: {status.llmModel ?? '—'}</li>
          <li data-testid="ai-provider-embedding-model">
            Embedding model:{' '}
            {status.embeddingsSupported === false
              ? 'Not supported by this provider'
              : (status.embeddingModel ?? '—')}
          </li>
          {status.baseUrl && <li data-testid="ai-provider-base-url">Base URL: {status.baseUrl}</li>}
          {status.demo && (
            <li data-testid="ai-provider-demo">
              <strong>Deterministic demo output</strong> — this mock provider does not produce real
              AI results.
            </li>
          )}
        </ul>
      )}
      {status && (
        <div data-testid="ai-provider-env-only">
          <p>
            Provider configuration is managed by the server environment and cannot be edited in the
            browser.
          </p>
          <p data-testid="ai-provider-setup-guidance">
            To change providers, update the server&apos;s <code>AI_PROVIDER_CONFIG</code> JSON (or
            deployment secret manager) and restart the API. The browser intentionally does not
            render provider edit fields, so API keys are never entered into a non-functional UI.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Server + user AI privacy policy settings (US-016). Rendered for any signed-in
 * user. The user layer is always editable; the server layer is editable only by
 * system admins, read-only otherwise. Shows the effective (strictest) non-KB
 * policy so users understand what is actually permitted.
 */
export function AiPolicySettings({
  isAdmin,
  csrfToken,
  onServerOrUserPolicyChanged,
}: {
  isAdmin: boolean;
  csrfToken: string;
  /**
   * Cross-boundary escape hatch (US-045 AC1/AC2): this panel renders OUTSIDE the
   * per-selected-KB <InvalidationProvider>, so it cannot publish onto that bus
   * directly. After a server/user policy save we call this so the parent can
   * invalidate the selected-KB `aiPolicy` domain — refreshing the selected-KB
   * effective policy and AI-availability surfaces without a page reload.
   */
  onServerOrUserPolicyChanged?: () => void;
}) {
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
      <AiProviderStatusPanel />
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
              onServerOrUserPolicyChanged?.();
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
              onServerOrUserPolicyChanged?.();
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
  const invalidate = useInvalidate();

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

  // Refresh the selected-KB effective policy when ANY policy layer changes —
  // a sibling KB save (below) or a server/user save folded in via the parent's
  // cross-boundary escape hatch (US-045 AC1/AC2/AC3). The effective policy
  // strictest-wins-folds server + user + KB, so all three must refresh it here.
  useInvalidationEffect(['aiPolicy'], reload);

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
              // Publish onto the selected-KB bus so this panel's own effective
              // policy (via the subscription above) AND the sibling AI-availability
              // surfaces (CommandBox/Answers/quick capture) reflect the change
              // without a page reload (US-045 AC3/AC4).
              invalidate(['aiPolicy']);
            }}
          />
        </>
      )}
    </section>
  );
}
