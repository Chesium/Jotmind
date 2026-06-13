import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BUILTIN_ENTITY_TYPES,
  kbRoleSatisfies,
  type AccountRole,
  type AuthState,
  type Claim,
  type ClaimArgumentKind,
  type CreateClaimArgument,
  type Entity,
  type KnowledgeBase,
  type Note,
  type SearchResponse,
  type Source,
  type SourceExcerptView,
} from '@jotmind/schemas';
import {
  createAccount,
  createClaim,
  createEntity,
  createKnowledgeBase,
  createNote,
  createSource,
  createSourceExcerpt,
  deleteClaim,
  deleteEntity,
  deleteNote,
  deleteSource,
  deleteSourceExcerpt,
  getEntityImpact,
  getMe,
  getSetupStatus,
  listClaims,
  listEntities,
  listKnowledgeBases,
  listNotes,
  listSourceExcerpts,
  listSources,
  login,
  logout,
  mergeEntity,
  search,
  setupAdmin,
  updateClaim,
  updateEntity,
} from './api.js';
import { GraphViews } from './GraphViews.js';

type Phase = 'loading' | 'setup' | 'login' | 'authed';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me) {
          setAuth(me);
          setPhase('authed');
          return;
        }
        const status = await getSetupStatus();
        if (cancelled) return;
        setPhase(status.setupRequired ? 'setup' : 'login');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>JotMind</h1>
      <p>Privacy-first, self-hostable graph knowledge app.</p>
      {error && (
        <p role="alert" data-testid="app-error">
          {error}
        </p>
      )}
      {phase === 'loading' && <p data-testid="auth-loading">Loading…</p>}
      {phase === 'setup' && (
        <SetupForm
          onDone={(state) => {
            setAuth(state);
            setPhase('authed');
          }}
        />
      )}
      {phase === 'login' && (
        <LoginForm
          onDone={(state) => {
            setAuth(state);
            setPhase('authed');
          }}
        />
      )}
      {phase === 'authed' && auth && (
        <AuthedHome
          auth={auth}
          onLogout={() => {
            setAuth(null);
            setPhase('login');
          }}
        />
      )}
    </main>
  );
}

function SetupForm({ onDone }: { onDone: (state: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await setupAdmin(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="first-run-setup">
      <h2>First-run setup</h2>
      <p>Create the initial administrator account.</p>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <button type="submit" disabled={busy} data-testid="setup-submit">
          Create admin
        </button>
      </form>
      {error && <p data-testid="setup-error">{error}</p>}
    </section>
  );
}

function LoginForm({ onDone }: { onDone: (state: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="login">
      <h2>Sign in</h2>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <button type="submit" disabled={busy} data-testid="login-submit">
          Sign in
        </button>
      </form>
      {error && <p data-testid="login-error">{error}</p>}
    </section>
  );
}

function AuthedHome({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function doLogout() {
    setError(null);
    try {
      await logout(auth.csrfToken);
      onLogout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    }
  }

  return (
    <section aria-label="account">
      <p data-testid="current-user">
        Signed in as {auth.user.email} ({auth.user.role})
      </p>
      <button type="button" onClick={() => void doLogout()} data-testid="logout">
        Sign out
      </button>
      <KnowledgeBases csrfToken={auth.csrfToken} />
      {auth.user.role === 'admin' && <AccountCreator csrfToken={auth.csrfToken} />}
      {error && <p data-testid="logout-error">{error}</p>}
    </section>
  );
}

function KnowledgeBases({ csrfToken }: { csrfToken: string }) {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedKb = items.find((kb) => kb.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await listKnowledgeBases());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Knowledge Bases');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const kb = await createKnowledgeBase(
        { name, description: description || undefined },
        csrfToken,
      );
      setName('');
      setDescription('');
      setSelectedId(kb.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Knowledge Base');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="knowledge-bases">
      <h2>Knowledge Bases</h2>
      {items.length === 0 ? (
        <p data-testid="kb-empty">No Knowledge Bases yet. Create one to get started.</p>
      ) : (
        <ul data-testid="kb-list">
          {items.map((kb) => (
            <li key={kb.id}>
              <button
                type="button"
                aria-pressed={selectedId === kb.id}
                onClick={() => setSelectedId(kb.id)}
                data-testid={`kb-select-${kb.id}`}
              >
                {kb.name} ({kb.role}){selectedId === kb.id ? ' — selected' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="kb-name"
          />
        </label>
        <label>
          Description
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="kb-description"
          />
        </label>
        <button type="submit" disabled={busy} data-testid="kb-create-submit">
          Create Knowledge Base
        </button>
      </form>
      {error && <p data-testid="kb-error">{error}</p>}
      {selectedKb && <GraphViews kb={selectedKb} csrfToken={csrfToken} />}
      {selectedKb && <Search kb={selectedKb} />}
      {selectedKb && <Entities kb={selectedKb} csrfToken={csrfToken} />}
      {selectedKb && <Claims kb={selectedKb} csrfToken={csrfToken} />}
      {selectedKb && <Capture kb={selectedKb} csrfToken={csrfToken} />}
    </section>
  );
}

const SEARCH_KINDS = ['entity', 'claim', 'note', 'source'] as const;

/**
 * Manual search & filters (US-012). Works without any AI provider. Surfaces a
 * notice when vector/semantic search is unavailable (no embeddings) so token
 * search stays usable.
 */
function Search({ kb }: { kb: KnowledgeBase }) {
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<Record<string, boolean>>({});
  const [type, setType] = useState('');
  const [predicate, setPredicate] = useState('');
  const [tag, setTag] = useState('');
  const [confidenceMin, setConfidenceMin] = useState('');
  const [confidenceMax, setConfidenceMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasProvenance, setHasProvenance] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toIso(date: string): string | undefined {
    if (!date) return undefined;
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const selectedKinds = SEARCH_KINDS.filter((k) => kinds[k]);
      const result = await search(kb.id, {
        q: q.trim() || undefined,
        kinds: selectedKinds.length > 0 ? selectedKinds.join(',') : undefined,
        type: type.trim() || undefined,
        predicate: predicate.trim() || undefined,
        tag: tag.trim() || undefined,
        confidenceMin: confidenceMin ? Number(confidenceMin) : undefined,
        confidenceMax: confidenceMax ? Number(confidenceMax) : undefined,
        dateFrom: toIso(dateFrom),
        dateTo: toIso(dateTo),
        hasProvenance: hasProvenance ? true : undefined,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResponse(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="search">
      <h3>Search &amp; filters</h3>
      <form onSubmit={runSearch}>
        <label>
          Query
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Token search (entities, claims, notes, sources)"
            data-testid="search-query"
          />
        </label>
        <fieldset data-testid="search-kinds">
          <legend>Kinds</legend>
          {SEARCH_KINDS.map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={kinds[k] ?? false}
                onChange={(e) => setKinds((prev) => ({ ...prev, [k]: e.target.checked }))}
                data-testid={`search-kind-${k}`}
              />
              {k}
            </label>
          ))}
        </fieldset>
        <label>
          Entity type
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Person, Place"
            data-testid="search-type"
          />
        </label>
        <label>
          Claim predicate
          <input
            type="text"
            value={predicate}
            onChange={(e) => setPredicate(e.target.value)}
            data-testid="search-predicate"
          />
        </label>
        <label>
          Tag
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            data-testid="search-tag"
          />
        </label>
        <label>
          Confidence min
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={confidenceMin}
            onChange={(e) => setConfidenceMin(e.target.value)}
            data-testid="search-confidence-min"
          />
        </label>
        <label>
          Confidence max
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={confidenceMax}
            onChange={(e) => setConfidenceMax(e.target.value)}
            data-testid="search-confidence-max"
          />
        </label>
        <label>
          Created from
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="search-date-from"
          />
        </label>
        <label>
          Created to
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="search-date-to"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={hasProvenance}
            onChange={(e) => setHasProvenance(e.target.checked)}
            data-testid="search-has-provenance"
          />
          Only claims with provenance
        </label>
        <button type="submit" disabled={busy} data-testid="search-submit">
          Search
        </button>
      </form>
      {error && <p data-testid="search-error">{error}</p>}
      {response && (
        <div data-testid="search-results">
          {!response.vectorSearch.available && (
            <p data-testid="search-vector-unavailable">
              Semantic (vector) search unavailable: {response.vectorSearch.reason}
            </p>
          )}
          <p data-testid="search-count">{response.results.length} result(s)</p>
          <ul>
            {response.results.map((r) => (
              <li key={`${r.kind}:${r.id}`} data-testid={`search-result-${r.kind}`}>
                <strong>[{r.kind}]</strong> {r.title}
                {r.type && ` — ${r.type}`}
                {r.confidence !== null && ` (confidence ${String(r.confidence)})`}
                {r.snippet && <div>{r.snippet}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const EMPTY_ENTITY_FORM = {
  type: BUILTIN_ENTITY_TYPES[0] as string,
  name: '',
  aliases: '',
  description: '',
  tags: '',
  properties: '',
};

type EntityFormState = typeof EMPTY_ENTITY_FORM;

function entityToForm(entity: Entity): EntityFormState {
  return {
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases.join(', '),
    description: entity.description ?? '',
    tags: entity.tags.join(', '),
    properties:
      Object.keys(entity.properties).length > 0 ? JSON.stringify(entity.properties, null, 2) : '',
  };
}

/** Parse a comma-separated input into a trimmed, non-empty string list. */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function Entities({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [items, setItems] = useState<Entity[]>([]);
  const [form, setForm] = useState<EntityFormState>(EMPTY_ENTITY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await listEntities(kb.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load entities');
    }
  }, [kb.id]);

  useEffect(() => {
    setForm(EMPTY_ENTITY_FORM);
    setEditingId(null);
    void refresh();
  }, [refresh]);

  function buildPayload(): {
    type: string;
    name: string;
    aliases: string[];
    description?: string;
    tags: string[];
    properties: Record<string, unknown>;
  } {
    let properties: Record<string, unknown> = {};
    const trimmed = form.properties.trim();
    if (trimmed.length > 0) {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Custom properties must be a JSON object');
      }
      properties = parsed as Record<string, unknown>;
    }
    return {
      type: form.type,
      name: form.name,
      aliases: parseList(form.aliases),
      description: form.description.trim() || undefined,
      tags: parseList(form.tags),
      properties,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (editingId) {
        await updateEntity(
          kb.id,
          editingId,
          { ...payload, description: payload.description ?? null },
          csrfToken,
        );
      } else {
        await createEntity(kb.id, payload, csrfToken);
      }
      setForm(EMPTY_ENTITY_FORM);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save entity');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(entity: Entity) {
    setEditingId(entity.id);
    setForm(entityToForm(entity));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_ENTITY_FORM);
  }

  async function handleDelete(entity: Entity) {
    setError(null);
    try {
      const impact = await getEntityImpact(kb.id, entity.id);
      const detail =
        impact.claims.length > 0
          ? `It is referenced by ${String(impact.claims.length)} claim(s): ${impact.claims
              .map((c) => c.predicate)
              .join(', ')}. They will remain but point at a deleted entity.`
          : 'No claims reference it.';
      if (!window.confirm(`Delete "${entity.name}"? ${detail}`)) return;
      await deleteEntity(kb.id, entity.id, csrfToken);
      if (editingId === entity.id) cancelEdit();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete entity');
    }
  }

  async function handleMerge(source: Entity) {
    setError(null);
    const targetId = mergeTargets[source.id];
    if (!targetId) {
      setError('Select an entity to merge into.');
      return;
    }
    const target = items.find((e) => e.id === targetId);
    try {
      const impact = await getEntityImpact(kb.id, source.id);
      const detail =
        impact.claims.length > 0
          ? ` ${String(impact.claims.length)} claim(s) will be retargeted to the survivor.`
          : '';
      if (
        !window.confirm(
          `Merge "${source.name}" into "${target?.name ?? 'selected entity'}"? ` +
            `"${source.name}" will be archived and its aliases/properties folded into the survivor.${detail}`,
        )
      ) {
        return;
      }
      await mergeEntity(kb.id, source.id, targetId, csrfToken);
      if (editingId === source.id) cancelEdit();
      setMergeTargets((m) => {
        const next = { ...m };
        delete next[source.id];
        return next;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge entity');
    }
  }

  return (
    <section aria-label="entities" data-testid="entities">
      <h3>Entities in {kb.name}</h3>
      {items.length === 0 ? (
        <p data-testid="entities-empty">No entities yet.</p>
      ) : (
        <ul data-testid="entities-list">
          {items.map((entity) => (
            <li key={entity.id} data-testid={`entity-${entity.id}`}>
              <strong>{entity.name}</strong> ({entity.type})
              {entity.aliases.length > 0 && <> — aka {entity.aliases.join(', ')}</>}
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(entity)}
                    data-testid={`entity-edit-${entity.id}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(entity)}
                    data-testid={`entity-delete-${entity.id}`}
                  >
                    Delete
                  </button>
                  <label>
                    Merge into
                    <select
                      value={mergeTargets[entity.id] ?? ''}
                      onChange={(e) =>
                        setMergeTargets((m) => ({ ...m, [entity.id]: e.target.value }))
                      }
                      data-testid={`entity-merge-target-${entity.id}`}
                    >
                      <option value="">Select survivor…</option>
                      {items
                        .filter((other) => other.id !== entity.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleMerge(entity)}
                    data-testid={`entity-merge-${entity.id}`}
                  >
                    Merge
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={submit} aria-label={editingId ? 'edit-entity' : 'create-entity'}>
          <h4>{editingId ? 'Edit entity' : 'Add entity'}</h4>
          <label>
            Type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              data-testid="entity-type"
            >
              {BUILTIN_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="entity-name"
            />
          </label>
          <label>
            Aliases (comma-separated)
            <input
              type="text"
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              data-testid="entity-aliases"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              data-testid="entity-description"
            />
          </label>
          <label>
            Tags/groups (comma-separated)
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              data-testid="entity-tags"
            />
          </label>
          <label>
            Custom properties (JSON)
            <textarea
              value={form.properties}
              onChange={(e) => setForm({ ...form, properties: e.target.value })}
              data-testid="entity-properties"
            />
          </label>
          <button type="submit" disabled={busy} data-testid="entity-submit">
            {editingId ? 'Save changes' : 'Add entity'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} data-testid="entity-cancel">
              Cancel
            </button>
          )}
        </form>
      ) : (
        <p data-testid="entities-readonly">You have read-only access to this Knowledge Base.</p>
      )}
      {error && <p data-testid="entities-error">{error}</p>}
    </section>
  );
}

interface ClaimArgumentForm {
  role: string;
  argumentKind: ClaimArgumentKind;
  entityId: string;
  value: string;
}

function newArgumentForm(): ClaimArgumentForm {
  return { role: '', argumentKind: 'entity', entityId: '', value: '' };
}

interface ClaimFormState {
  predicate: string;
  description: string;
  confidence: string;
  validStart: string;
  validEnd: string;
  arguments: ClaimArgumentForm[];
}

function emptyClaimForm(): ClaimFormState {
  return {
    predicate: '',
    description: '',
    confidence: '',
    validStart: '',
    validEnd: '',
    arguments: [newArgumentForm()],
  };
}

function claimToForm(claim: Claim): ClaimFormState {
  return {
    predicate: claim.predicate,
    description: claim.description ?? '',
    confidence: claim.confidence === null ? '' : String(claim.confidence),
    validStart: claim.validStart ? claim.validStart.slice(0, 10) : '',
    validEnd: claim.validEnd ? claim.validEnd.slice(0, 10) : '',
    arguments:
      claim.arguments.length > 0
        ? claim.arguments.map((arg) => ({
            role: arg.role,
            argumentKind: arg.argumentKind,
            entityId: arg.entityId ?? '',
            value:
              arg.argumentKind === 'literal' && arg.value !== undefined && arg.value !== null
                ? typeof arg.value === 'string'
                  ? arg.value
                  : JSON.stringify(arg.value)
                : '',
          }))
        : [newArgumentForm()],
  };
}

/** Look up an entity's display name for rendering claim arguments. */
function entityLabel(entities: Entity[], id: string | null): string {
  if (!id) return '(unknown)';
  return entities.find((e) => e.id === id)?.name ?? '(unknown)';
}

function Claims({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [items, setItems] = useState<Claim[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [form, setForm] = useState<ClaimFormState>(emptyClaimForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [claims, ents] = await Promise.all([listClaims(kb.id), listEntities(kb.id)]);
      setItems(claims);
      setEntities(ents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load claims');
    }
  }, [kb.id]);

  useEffect(() => {
    setForm(emptyClaimForm());
    setEditingId(null);
    void refresh();
  }, [refresh]);

  function setArgument(index: number, patch: Partial<ClaimArgumentForm>) {
    setForm((f) => ({
      ...f,
      arguments: f.arguments.map((arg, i) => (i === index ? { ...arg, ...patch } : arg)),
    }));
  }

  function addArgument() {
    setForm((f) => ({ ...f, arguments: [...f.arguments, newArgumentForm()] }));
  }

  function removeArgument(index: number) {
    setForm((f) => ({
      ...f,
      arguments: f.arguments.length > 1 ? f.arguments.filter((_, i) => i !== index) : f.arguments,
    }));
  }

  function buildArguments(): CreateClaimArgument[] {
    return form.arguments.map((arg) => {
      const role = arg.role.trim();
      if (arg.argumentKind === 'entity') {
        return { role, argumentKind: 'entity' as const, entityId: arg.entityId };
      }
      // Try to parse the literal as JSON, falling back to the raw string.
      let value: unknown = arg.value;
      try {
        value = JSON.parse(arg.value);
      } catch {
        value = arg.value;
      }
      return { role, argumentKind: 'literal' as const, value };
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const confidence = form.confidence.trim() === '' ? undefined : Number(form.confidence);
      const payload = {
        predicate: form.predicate.trim(),
        description: form.description.trim() || undefined,
        confidence,
        validStart: form.validStart ? new Date(form.validStart).toISOString() : undefined,
        validEnd: form.validEnd ? new Date(form.validEnd).toISOString() : undefined,
        arguments: buildArguments(),
      };
      if (editingId) {
        await updateClaim(
          kb.id,
          editingId,
          {
            ...payload,
            description: payload.description ?? null,
            confidence: payload.confidence ?? null,
            validStart: payload.validStart ?? null,
            validEnd: payload.validEnd ?? null,
          },
          csrfToken,
        );
      } else {
        await createClaim(kb.id, payload, csrfToken);
      }
      setForm(emptyClaimForm());
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save claim');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(claim: Claim) {
    setEditingId(claim.id);
    setForm(claimToForm(claim));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyClaimForm());
  }

  async function handleDelete(claim: Claim) {
    setError(null);
    if (!window.confirm(`Delete claim "${claim.predicate}"? This cannot be easily undone.`)) {
      return;
    }
    try {
      await deleteClaim(kb.id, claim.id, csrfToken);
      if (editingId === claim.id) cancelEdit();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete claim');
    }
  }

  return (
    <section aria-label="claims" data-testid="claims">
      <h3>Claims in {kb.name}</h3>
      {items.length === 0 ? (
        <p data-testid="claims-empty">No claims yet.</p>
      ) : (
        <ul data-testid="claims-list">
          {items.map((claim) => (
            <li key={claim.id} data-testid={`claim-${claim.id}`}>
              <strong>{claim.predicate}</strong>
              {claim.confidence !== null && <> (confidence {claim.confidence})</>}
              <ul>
                {claim.arguments.map((arg) => (
                  <li key={arg.id}>
                    {arg.role}:{' '}
                    {arg.argumentKind === 'entity'
                      ? entityLabel(entities, arg.entityId)
                      : `"${String(arg.value)}"`}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(claim)}
                    data-testid={`claim-edit-${claim.id}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(claim)}
                    data-testid={`claim-delete-${claim.id}`}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={submit} aria-label={editingId ? 'edit-claim' : 'create-claim'}>
          <h4>{editingId ? 'Edit claim' : 'Add claim'}</h4>
          <label>
            Predicate
            <input
              type="text"
              value={form.predicate}
              onChange={(e) => setForm({ ...form, predicate: e.target.value })}
              required
              data-testid="claim-predicate"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              data-testid="claim-description"
            />
          </label>
          <label>
            Confidence (0–1)
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={form.confidence}
              onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              data-testid="claim-confidence"
            />
          </label>
          <label>
            Valid from
            <input
              type="date"
              value={form.validStart}
              onChange={(e) => setForm({ ...form, validStart: e.target.value })}
              data-testid="claim-valid-start"
            />
          </label>
          <label>
            Valid to
            <input
              type="date"
              value={form.validEnd}
              onChange={(e) => setForm({ ...form, validEnd: e.target.value })}
              data-testid="claim-valid-end"
            />
          </label>
          <fieldset>
            <legend>Arguments</legend>
            {form.arguments.map((arg, index) => (
              <div key={index} data-testid={`claim-argument-${String(index)}`}>
                <label>
                  Role
                  <input
                    type="text"
                    value={arg.role}
                    onChange={(e) => setArgument(index, { role: e.target.value })}
                    required
                    data-testid={`claim-arg-role-${String(index)}`}
                  />
                </label>
                <label>
                  Kind
                  <select
                    value={arg.argumentKind}
                    onChange={(e) =>
                      setArgument(index, { argumentKind: e.target.value as ClaimArgumentKind })
                    }
                    data-testid={`claim-arg-kind-${String(index)}`}
                  >
                    <option value="entity">entity</option>
                    <option value="literal">literal</option>
                  </select>
                </label>
                {arg.argumentKind === 'entity' ? (
                  <label>
                    Entity
                    <select
                      value={arg.entityId}
                      onChange={(e) => setArgument(index, { entityId: e.target.value })}
                      required
                      data-testid={`claim-arg-entity-${String(index)}`}
                    >
                      <option value="">Select an entity…</option>
                      {entities.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.name} ({entity.type})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Value
                    <input
                      type="text"
                      value={arg.value}
                      onChange={(e) => setArgument(index, { value: e.target.value })}
                      data-testid={`claim-arg-value-${String(index)}`}
                    />
                  </label>
                )}
                {form.arguments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeArgument(index)}
                    data-testid={`claim-arg-remove-${String(index)}`}
                  >
                    Remove argument
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addArgument} data-testid="claim-add-argument">
              Add argument
            </button>
          </fieldset>
          <button type="submit" disabled={busy} data-testid="claim-submit">
            {editingId ? 'Save changes' : 'Add claim'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} data-testid="claim-cancel">
              Cancel
            </button>
          )}
        </form>
      ) : (
        <p data-testid="claims-readonly">You have read-only access to this Knowledge Base.</p>
      )}
      {error && <p data-testid="claims-error">{error}</p>}
    </section>
  );
}

/**
 * Notes & Sources capture (US-011). Lets editors store freeform notes and
 * imported/captured sources, cite spans/excerpts of them, and link those
 * citations to claims. Note/source views show the original content and the
 * linked claims (via excerpts). No AI provider is required.
 */
function Capture({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [notes, setNotes] = useState<Note[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [excerpts, setExcerpts] = useState<SourceExcerptView[]>([]);
  const [noteForm, setNoteForm] = useState({ title: '', content: '' });
  const [sourceForm, setSourceForm] = useState({
    title: '',
    sourceType: '',
    uri: '',
    content: '',
    metadata: '',
  });
  // Per-item citation drafts keyed by note/source id.
  const [citations, setCitations] = useState<Record<string, { excerpt: string; claimId: string }>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [n, s, c, e] = await Promise.all([
        listNotes(kb.id),
        listSources(kb.id),
        listClaims(kb.id),
        listSourceExcerpts(kb.id),
      ]);
      setNotes(n);
      setSources(s);
      setClaims(c);
      setExcerpts(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notes/sources');
    }
  }, [kb.id]);

  useEffect(() => {
    setNoteForm({ title: '', content: '' });
    setSourceForm({ title: '', sourceType: '', uri: '', content: '', metadata: '' });
    setCitations({});
    void refresh();
  }, [refresh]);

  function claimLabel(id: string | null): string {
    if (!id) return '';
    const claim = claims.find((c) => c.id === id);
    return claim ? claim.predicate : id;
  }

  function getCitation(id: string): { excerpt: string; claimId: string } {
    return citations[id] ?? { excerpt: '', claimId: '' };
  }

  async function submitNote(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createNote(
        kb.id,
        { title: noteForm.title.trim() || undefined, content: noteForm.content },
        csrfToken,
      );
      setNoteForm({ title: '', content: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  }

  async function submitSource(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let metadata: Record<string, unknown> | undefined;
      const trimmed = sourceForm.metadata.trim();
      if (trimmed.length > 0) {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Metadata must be a JSON object');
        }
        metadata = parsed as Record<string, unknown>;
      }
      await createSource(
        kb.id,
        {
          title: sourceForm.title,
          sourceType: sourceForm.sourceType.trim() || undefined,
          uri: sourceForm.uri.trim() || undefined,
          content: sourceForm.content.trim() || undefined,
          metadata,
        },
        csrfToken,
      );
      setSourceForm({ title: '', sourceType: '', uri: '', content: '', metadata: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save source');
    } finally {
      setBusy(false);
    }
  }

  async function addCitation(origin: 'note' | 'source', id: string) {
    setError(null);
    const draft = getCitation(id);
    if (!draft.excerpt.trim()) {
      setError('Enter excerpt text to cite.');
      return;
    }
    try {
      await createSourceExcerpt(
        kb.id,
        {
          ...(origin === 'note' ? { noteId: id } : { sourceId: id }),
          excerpt: draft.excerpt.trim(),
          claimId: draft.claimId || undefined,
        },
        csrfToken,
      );
      setCitations((m) => ({ ...m, [id]: { excerpt: '', claimId: '' } }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add citation');
    }
  }

  async function removeNote(note: Note) {
    setError(null);
    if (!window.confirm(`Delete this note? Its citations will be removed.`)) return;
    try {
      await deleteNote(kb.id, note.id, csrfToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete note');
    }
  }

  async function removeSource(source: Source) {
    setError(null);
    if (!window.confirm(`Delete "${source.title ?? 'source'}"? Its citations will be removed.`)) {
      return;
    }
    try {
      await deleteSource(kb.id, source.id, csrfToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete source');
    }
  }

  async function removeExcerpt(excerptId: string) {
    setError(null);
    try {
      await deleteSourceExcerpt(kb.id, excerptId, csrfToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete citation');
    }
  }

  function renderCitations(originExcerpts: SourceExcerptView[]) {
    if (originExcerpts.length === 0) {
      return <p data-testid="no-citations">No citations yet.</p>;
    }
    return (
      <ul>
        {originExcerpts.map((ex) => (
          <li key={ex.id} data-testid={`excerpt-${ex.id}`}>
            <em>“{ex.excerpt ?? `[span ${String(ex.spanStart)}–${String(ex.spanEnd)}]`}”</em>
            {ex.claim ? (
              <>
                {' '}
                → claim: <strong>{claimLabel(ex.claim.id) || ex.claim.predicate}</strong>
              </>
            ) : (
              <> (no linked claim)</>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => void removeExcerpt(ex.id)}
                data-testid={`excerpt-delete-${ex.id}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  function renderCitationForm(origin: 'note' | 'source', id: string) {
    if (!canEdit) return null;
    const draft = getCitation(id);
    return (
      <div>
        <input
          type="text"
          placeholder="Excerpt text to cite"
          value={draft.excerpt}
          onChange={(e) =>
            setCitations((m) => ({ ...m, [id]: { ...draft, excerpt: e.target.value } }))
          }
          data-testid={`citation-excerpt-${id}`}
        />
        <select
          value={draft.claimId}
          onChange={(e) =>
            setCitations((m) => ({ ...m, [id]: { ...draft, claimId: e.target.value } }))
          }
          data-testid={`citation-claim-${id}`}
        >
          <option value="">Link a claim (optional)…</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.predicate}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void addCitation(origin, id)}
          data-testid={`citation-add-${id}`}
        >
          Add citation
        </button>
      </div>
    );
  }

  return (
    <section aria-label="capture" data-testid="capture">
      <h3>Notes & Sources in {kb.name}</h3>

      <h4>Notes</h4>
      {notes.length === 0 ? (
        <p data-testid="notes-empty">No notes yet.</p>
      ) : (
        <ul data-testid="notes-list">
          {notes.map((note) => (
            <li key={note.id} data-testid={`note-${note.id}`}>
              {note.title && <strong>{note.title}: </strong>}
              <span>{note.content}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void removeNote(note)}
                  data-testid={`note-delete-${note.id}`}
                >
                  Delete
                </button>
              )}
              <div data-testid={`note-citations-${note.id}`}>
                {renderCitations(excerpts.filter((ex) => ex.noteId === note.id))}
              </div>
              {renderCitationForm('note', note.id)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submitNote} aria-label="create-note">
          <label>
            Title (optional)
            <input
              type="text"
              value={noteForm.title}
              onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })}
              data-testid="note-title"
            />
          </label>
          <label>
            Content
            <textarea
              value={noteForm.content}
              onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })}
              required
              data-testid="note-content"
            />
          </label>
          <button type="submit" disabled={busy} data-testid="note-submit">
            Add note
          </button>
        </form>
      )}

      <h4>Sources</h4>
      {sources.length === 0 ? (
        <p data-testid="sources-empty">No sources yet.</p>
      ) : (
        <ul data-testid="sources-list">
          {sources.map((source) => (
            <li key={source.id} data-testid={`source-${source.id}`}>
              <strong>{source.title}</strong>
              {source.sourceType && <> ({source.sourceType})</>}
              {source.uri && <> — {source.uri}</>}
              {source.content && <p>{source.content}</p>}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void removeSource(source)}
                  data-testid={`source-delete-${source.id}`}
                >
                  Delete
                </button>
              )}
              <div data-testid={`source-citations-${source.id}`}>
                {renderCitations(excerpts.filter((ex) => ex.sourceId === source.id))}
              </div>
              {renderCitationForm('source', source.id)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submitSource} aria-label="create-source">
          <label>
            Title
            <input
              type="text"
              value={sourceForm.title}
              onChange={(e) => setSourceForm({ ...sourceForm, title: e.target.value })}
              required
              data-testid="source-title"
            />
          </label>
          <label>
            Type
            <input
              type="text"
              value={sourceForm.sourceType}
              onChange={(e) => setSourceForm({ ...sourceForm, sourceType: e.target.value })}
              data-testid="source-type"
            />
          </label>
          <label>
            URI/locator
            <input
              type="text"
              value={sourceForm.uri}
              onChange={(e) => setSourceForm({ ...sourceForm, uri: e.target.value })}
              data-testid="source-uri"
            />
          </label>
          <label>
            Captured content (optional)
            <textarea
              value={sourceForm.content}
              onChange={(e) => setSourceForm({ ...sourceForm, content: e.target.value })}
              data-testid="source-content"
            />
          </label>
          <label>
            Structured metadata (JSON, optional)
            <textarea
              value={sourceForm.metadata}
              onChange={(e) => setSourceForm({ ...sourceForm, metadata: e.target.value })}
              data-testid="source-metadata"
            />
          </label>
          <button type="submit" disabled={busy} data-testid="source-submit">
            Add source
          </button>
        </form>
      )}

      {!canEdit && (
        <p data-testid="capture-readonly">You have read-only access to this Knowledge Base.</p>
      )}
      {error && <p data-testid="capture-error">{error}</p>}
    </section>
  );
}

function AccountCreator({ csrfToken }: { csrfToken: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const user = await createAccount({ email, password, role }, csrfToken);
      setMessage(`Created account ${user.email}`);
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="create-account">
      <h2>Create account</h2>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
            data-testid="role-select"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={busy} data-testid="create-account-submit">
          Create account
        </button>
      </form>
      {message && <p data-testid="create-account-message">{message}</p>}
      {error && <p data-testid="create-account-error">{error}</p>}
    </section>
  );
}

function CredentialFields({
  email,
  password,
  onEmail,
  onPassword,
}: {
  email: string;
  password: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
}) {
  return (
    <>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
    </>
  );
}
