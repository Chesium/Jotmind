import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  kbRoleSatisfies,
  type Claim,
  type Entity,
  type KnowledgeBase,
  type Note,
  type Source,
  type SourceExcerptView,
} from '@jotmind/schemas';
import {
  listClaims,
  listEntities,
  listNotes,
  listSourceExcerpts,
  listSources,
  updateEntity,
} from './api.js';

/**
 * Multiple views over the same Knowledge Base graph (US-013): a network view of
 * entities and claim-derived relationships, a chronological timeline, a
 * sortable/filterable table, a detail view, and a source/note view. All views
 * share one selection so clicking entities, claims, tags, or citations
 * navigates to the relevant detail/source context.
 */

const VIEW_MODES = ['network', 'timeline', 'table', 'sources'] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const VIEW_LABELS: Record<ViewMode, string> = {
  network: 'Network',
  timeline: 'Timeline',
  table: 'Table',
  sources: 'Sources & Notes',
};

/** A graph record the detail panel can focus on. */
type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'claim'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'source'; id: string };

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** The "best" date for a record on the timeline, preferring explicit dates. */
function claimDate(claim: Claim): string {
  return claim.validStart ?? claim.createdAt;
}

export function GraphViews({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [excerpts, setExcerpts] = useState<SourceExcerptView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('network');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const canEdit = kbRoleSatisfies(kb.role, 'editor');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [e, c, n, s, x] = await Promise.all([
        listEntities(kb.id),
        listClaims(kb.id),
        listNotes(kb.id),
        listSources(kb.id),
        listSourceExcerpts(kb.id),
      ]);
      setEntities(e);
      setClaims(c);
      setNotes(n);
      setSources(s);
      setExcerpts(x);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load graph views');
    }
  }, [kb.id]);

  useEffect(() => {
    void refresh();
    setSelected(null);
    setTagFilter(null);
  }, [refresh]);

  const entityById = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.id, e);
    return map;
  }, [entities]);

  /** Navigate to a record's detail/source context. */
  function navigate(target: Selection) {
    setSelected(target);
    if (target.kind === 'note' || target.kind === 'source') setMode('sources');
  }

  /** Navigate to the table view filtered by a tag. */
  function navigateTag(tag: string) {
    setTagFilter(tag);
    setMode('table');
  }

  return (
    <section aria-label="graph-views" data-testid="graph-views">
      <h3>Graph views — {kb.name}</h3>
      <div role="tablist" aria-label="graph-view-modes">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            data-testid={`view-tab-${m}`}
          >
            {VIEW_LABELS[m]}
          </button>
        ))}
      </div>

      {error && <p data-testid="graph-views-error">{error}</p>}

      {mode === 'network' && (
        <NetworkView entities={entities} claims={claims} onSelect={navigate} />
      )}
      {mode === 'timeline' && (
        <TimelineView
          entities={entities}
          claims={claims}
          notes={notes}
          entityById={entityById}
          onSelect={navigate}
        />
      )}
      {mode === 'table' && (
        <TableView
          entities={entities}
          claims={claims}
          entityById={entityById}
          tagFilter={tagFilter}
          onClearTagFilter={() => setTagFilter(null)}
          onSelect={navigate}
          onSelectTag={navigateTag}
        />
      )}
      {mode === 'sources' && (
        <SourcesView
          notes={notes}
          sources={sources}
          excerpts={excerpts}
          selected={selected}
          onSelect={navigate}
        />
      )}

      {selected && (selected.kind === 'entity' || selected.kind === 'claim') && (
        <DetailView
          selected={selected}
          entities={entities}
          claims={claims}
          excerpts={excerpts}
          entityById={entityById}
          canEdit={canEdit}
          csrfToken={csrfToken}
          kbId={kb.id}
          onSelect={navigate}
          onSelectTag={navigateTag}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      )}
    </section>
  );
}

// --- Network view ----------------------------------------------------------

/**
 * A lightweight SVG network: entities are nodes laid out on a circle, claims
 * draw edges between their entity arguments (labeled by predicate). No graph
 * library — a circular layout keeps it dependency-free.
 */
function NetworkView({
  entities,
  claims,
  onSelect,
}: {
  entities: Entity[];
  claims: Claim[];
  onSelect: (target: Selection) => void;
}) {
  const size = 420;
  const radius = 170;
  const center = size / 2;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const n = Math.max(entities.length, 1);
    entities.forEach((e, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      map.set(e.id, {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
      });
    });
    return map;
  }, [entities, center]);

  const edges = useMemo(() => {
    const result: { id: string; predicate: string; from: string; to: string }[] = [];
    for (const claim of claims) {
      const entArgs = claim.arguments.filter((a) => a.argumentKind === 'entity' && a.entityId);
      for (let i = 0; i < entArgs.length - 1; i++) {
        const from = entArgs[i]?.entityId;
        const to = entArgs[i + 1]?.entityId;
        if (from && to && positions.has(from) && positions.has(to)) {
          result.push({ id: `${claim.id}-${String(i)}`, predicate: claim.predicate, from, to });
        }
      }
    }
    return result;
  }, [claims, positions]);

  if (entities.length === 0) {
    return <p data-testid="network-empty">No entities to display in the network.</p>;
  }

  return (
    <div data-testid="network-view">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        role="img"
        aria-label="entity network"
      >
        {edges.map((edge) => {
          const a = positions.get(edge.from);
          const b = positions.get(edge.to);
          if (!a || !b) return null;
          return (
            <g key={edge.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#999" strokeWidth={1} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={9} fill="#666">
                {edge.predicate}
              </text>
            </g>
          );
        })}
        {entities.map((e) => {
          const p = positions.get(e.id);
          if (!p) return null;
          return (
            <g
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect({ kind: 'entity', id: e.id })}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') onSelect({ kind: 'entity', id: e.id });
              }}
              data-testid={`network-node-${e.id}`}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={p.x} cy={p.y} r={6} fill="#3b82f6" />
              <text x={p.x + 8} y={p.y + 3} fontSize={11}>
                {e.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Timeline view ---------------------------------------------------------

interface TimelineItem {
  key: string;
  date: string;
  kind: 'claim' | 'note' | 'event';
  label: string;
  detail: string;
  select: Selection;
}

/**
 * A chronological card view of dated notes, claims, and events (Event-typed
 * entities). Records are sorted by their best available date, newest first.
 */
function TimelineView({
  entities,
  claims,
  notes,
  entityById,
  onSelect,
}: {
  entities: Entity[];
  claims: Claim[];
  notes: Note[];
  entityById: Map<string, Entity>;
  onSelect: (target: Selection) => void;
}) {
  const items = useMemo(() => {
    const result: TimelineItem[] = [];
    for (const claim of claims) {
      const subjects = claim.arguments
        .filter((a) => a.argumentKind === 'entity' && a.entityId)
        .map((a) => entityById.get(a.entityId as string)?.name ?? 'unknown')
        .join(', ');
      result.push({
        key: `claim-${claim.id}`,
        date: claimDate(claim),
        kind: 'claim',
        label: claim.predicate,
        detail: subjects || claim.description || '',
        select: { kind: 'claim', id: claim.id },
      });
    }
    for (const note of notes) {
      result.push({
        key: `note-${note.id}`,
        date: note.createdAt,
        kind: 'note',
        label: note.title ?? 'Note',
        detail: note.content.slice(0, 80),
        select: { kind: 'note', id: note.id },
      });
    }
    for (const entity of entities) {
      if (entity.type !== 'Event') continue;
      result.push({
        key: `event-${entity.id}`,
        date: entity.createdAt,
        kind: 'event',
        label: entity.name,
        detail: entity.description ?? '',
        select: { kind: 'entity', id: entity.id },
      });
    }
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }, [entities, claims, notes, entityById]);

  if (items.length === 0) {
    return <p data-testid="timeline-empty">No dated records yet.</p>;
  }

  return (
    <ul data-testid="timeline-view">
      {items.map((item) => (
        <li key={item.key} data-testid={`timeline-item-${item.key}`}>
          <button type="button" onClick={() => onSelect(item.select)}>
            <strong>{formatDate(item.date)}</strong> [{item.kind}] {item.label}
            {item.detail && <> — {item.detail}</>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Table view ------------------------------------------------------------

type TableKind = 'entity' | 'claim';

/**
 * A sortable, filterable table of entities or claims. Column headers toggle the
 * sort; a text box filters rows; clicking a row opens its detail and clicking a
 * tag filters the entity table by that tag.
 */
function TableView({
  entities,
  claims,
  entityById,
  tagFilter,
  onClearTagFilter,
  onSelect,
  onSelectTag,
}: {
  entities: Entity[];
  claims: Claim[];
  entityById: Map<string, Entity>;
  tagFilter: string | null;
  onClearTagFilter: () => void;
  onSelect: (target: Selection) => void;
  onSelectTag: (tag: string) => void;
}) {
  const [kind, setKind] = useState<TableKind>(tagFilter ? 'entity' : 'entity');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');

  // A tag filter always targets entities.
  useEffect(() => {
    if (tagFilter) setKind('entity');
  }, [tagFilter]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const claimSubjects = useCallback(
    (claim: Claim): string =>
      claim.arguments
        .filter((a) => a.argumentKind === 'entity' && a.entityId)
        .map((a) => entityById.get(a.entityId as string)?.name ?? 'unknown')
        .join(', '),
    [entityById],
  );

  const entityRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    let rows = entities;
    if (tagFilter) rows = rows.filter((e) => e.tags.includes(tagFilter));
    if (term) {
      rows = rows.filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.type.toLowerCase().includes(term) ||
          e.tags.some((t) => t.toLowerCase().includes(term)),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const av = sortKey === 'type' ? a.type : sortKey === 'created' ? a.createdAt : a.name;
      const bv = sortKey === 'type' ? b.type : sortKey === 'created' ? b.createdAt : b.name;
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return sorted;
  }, [entities, filter, tagFilter, sortKey, sortAsc]);

  const claimRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    let rows = claims;
    if (term) {
      rows = rows.filter(
        (c) =>
          c.predicate.toLowerCase().includes(term) || claimSubjects(c).toLowerCase().includes(term),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let av: string;
      let bv: string;
      if (sortKey === 'confidence') {
        av = String(a.confidence ?? 0);
        bv = String(b.confidence ?? 0);
      } else if (sortKey === 'created') {
        av = a.createdAt;
        bv = b.createdAt;
      } else {
        av = a.predicate;
        bv = b.predicate;
      }
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return sorted;
  }, [claims, filter, sortKey, sortAsc, claimSubjects]);

  return (
    <div data-testid="table-view">
      <div>
        <button
          type="button"
          aria-pressed={kind === 'entity'}
          onClick={() => {
            setKind('entity');
            setSortKey('name');
          }}
          data-testid="table-kind-entity"
        >
          Entities
        </button>
        <button
          type="button"
          aria-pressed={kind === 'claim'}
          onClick={() => {
            setKind('claim');
            setSortKey('predicate');
          }}
          data-testid="table-kind-claim"
        >
          Claims
        </button>
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="table-filter"
        />
        {tagFilter && (
          <span data-testid="table-tag-filter">
            Tag: {tagFilter}{' '}
            <button type="button" onClick={onClearTagFilter} data-testid="table-tag-clear">
              clear
            </button>
          </span>
        )}
      </div>

      {kind === 'entity' ? (
        entityRows.length === 0 ? (
          <p data-testid="table-empty">No entities match.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort('name')}>
                    Name
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('type')}>
                    Type
                  </button>
                </th>
                <th>Tags</th>
                <th>
                  <button type="button" onClick={() => toggleSort('created')}>
                    Created
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {entityRows.map((e) => (
                <tr key={e.id} data-testid={`table-row-${e.id}`}>
                  <td>
                    <button type="button" onClick={() => onSelect({ kind: 'entity', id: e.id })}>
                      {e.name}
                    </button>
                  </td>
                  <td>{e.type}</td>
                  <td>
                    {e.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onSelectTag(t)}
                        data-testid={`table-tag-${e.id}-${t}`}
                      >
                        #{t}
                      </button>
                    ))}
                  </td>
                  <td>{formatDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : claimRows.length === 0 ? (
        <p data-testid="table-empty">No claims match.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggleSort('predicate')}>
                  Predicate
                </button>
              </th>
              <th>Subjects</th>
              <th>
                <button type="button" onClick={() => toggleSort('confidence')}>
                  Confidence
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('created')}>
                  Created
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {claimRows.map((c) => (
              <tr key={c.id} data-testid={`table-row-${c.id}`}>
                <td>
                  <button type="button" onClick={() => onSelect({ kind: 'claim', id: c.id })}>
                    {c.predicate}
                  </button>
                </td>
                <td>{claimSubjects(c)}</td>
                <td>{c.confidence ?? '—'}</td>
                <td>{formatDate(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --- Detail view -----------------------------------------------------------

/**
 * A detail panel for a selected entity or claim. Shows related claims, sources,
 * and citations, allows editing entity metadata, and links navigate to the
 * related record's detail/source context.
 */
function DetailView({
  selected,
  entities,
  claims,
  excerpts,
  entityById,
  canEdit,
  csrfToken,
  kbId,
  onSelect,
  onSelectTag,
  onClose,
  onChanged,
}: {
  selected: { kind: 'entity'; id: string } | { kind: 'claim'; id: string };
  entities: Entity[];
  claims: Claim[];
  excerpts: SourceExcerptView[];
  entityById: Map<string, Entity>;
  canEdit: boolean;
  csrfToken: string;
  kbId: string;
  onSelect: (target: Selection) => void;
  onSelectTag: (tag: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (selected.kind === 'entity') {
    const entity = entities.find((e) => e.id === selected.id);
    if (!entity) return <p data-testid="detail-missing">Record not found.</p>;
    const related = claims.filter((c) =>
      c.arguments.some((a) => a.argumentKind === 'entity' && a.entityId === entity.id),
    );
    return (
      <EntityDetail
        entity={entity}
        related={related}
        excerpts={excerpts}
        entityById={entityById}
        canEdit={canEdit}
        csrfToken={csrfToken}
        kbId={kbId}
        onSelect={onSelect}
        onSelectTag={onSelectTag}
        onClose={onClose}
        onChanged={onChanged}
      />
    );
  }

  const claim = claims.find((c) => c.id === selected.id);
  if (!claim) return <p data-testid="detail-missing">Record not found.</p>;
  const citations = excerpts.filter((x) => x.claimId === claim.id);
  return (
    <section aria-label="claim-detail" data-testid="detail-view">
      <h4>
        Claim: {claim.predicate}{' '}
        <button type="button" onClick={onClose} data-testid="detail-close">
          close
        </button>
      </h4>
      {claim.description && <p>{claim.description}</p>}
      <p>
        Confidence: {claim.confidence ?? '—'} · Valid: {formatDate(claim.validStart)} →{' '}
        {formatDate(claim.validEnd)}
      </p>
      <h5>Arguments</h5>
      <ul data-testid="detail-arguments">
        {claim.arguments.map((a) => (
          <li key={a.id}>
            {a.role}:{' '}
            {a.argumentKind === 'entity' && a.entityId ? (
              <button
                type="button"
                onClick={() => onSelect({ kind: 'entity', id: a.entityId as string })}
              >
                {entityById.get(a.entityId)?.name ?? 'unknown entity'}
              </button>
            ) : (
              <em>{JSON.stringify(a.value)}</em>
            )}
          </li>
        ))}
      </ul>
      <CitationList citations={citations} onSelect={onSelect} />
    </section>
  );
}

function EntityDetail({
  entity,
  related,
  excerpts,
  entityById,
  canEdit,
  csrfToken,
  kbId,
  onSelect,
  onSelectTag,
  onClose,
  onChanged,
}: {
  entity: Entity;
  related: Claim[];
  excerpts: SourceExcerptView[];
  entityById: Map<string, Entity>;
  canEdit: boolean;
  csrfToken: string;
  kbId: string;
  onSelect: (target: Selection) => void;
  onSelectTag: (tag: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(entity.description ?? '');
  const [tags, setTags] = useState(entity.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the edit form whenever the focused entity changes.
  useEffect(() => {
    setEditing(false);
    setDescription(entity.description ?? '');
    setTags(entity.tags.join(', '));
  }, [entity.id, entity.description, entity.tags]);

  const relatedCitations = excerpts.filter((x) => related.some((c) => c.id === x.claimId));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateEntity(
        kbId,
        entity.id,
        {
          description: description.trim() ? description.trim() : null,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
        csrfToken,
      );
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="entity-detail" data-testid="detail-view">
      <h4>
        {entity.name} ({entity.type}){' '}
        <button type="button" onClick={onClose} data-testid="detail-close">
          close
        </button>
      </h4>
      {entity.aliases.length > 0 && <p>aka {entity.aliases.join(', ')}</p>}
      {entity.description && <p data-testid="detail-description">{entity.description}</p>}
      {entity.tags.length > 0 && (
        <p>
          Tags:{' '}
          {entity.tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onSelectTag(t)}
              data-testid={`detail-tag-${t}`}
            >
              #{t}
            </button>
          ))}
        </p>
      )}

      <h5>Related claims</h5>
      {related.length === 0 ? (
        <p data-testid="detail-no-claims">No related claims.</p>
      ) : (
        <ul data-testid="detail-related-claims">
          {related.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onSelect({ kind: 'claim', id: c.id })}>
                {c.predicate}
              </button>{' '}
              (
              {c.arguments
                .filter((a) => a.argumentKind === 'entity' && a.entityId)
                .map((a) => entityById.get(a.entityId as string)?.name ?? 'unknown')
                .join(', ')}
              )
            </li>
          ))}
        </ul>
      )}

      <CitationList citations={relatedCitations} onSelect={onSelect} />

      {canEdit &&
        (editing ? (
          <form onSubmit={save} aria-label="edit-metadata">
            <label>
              Description
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="detail-edit-description"
              />
            </label>
            <label>
              Tags (comma-separated)
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                data-testid="detail-edit-tags"
              />
            </label>
            <button type="submit" disabled={busy} data-testid="detail-save">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} data-testid="detail-edit">
            Edit metadata
          </button>
        ))}
      {error && <p data-testid="detail-error">{error}</p>}
    </section>
  );
}

function CitationList({
  citations,
  onSelect,
}: {
  citations: SourceExcerptView[];
  onSelect: (target: Selection) => void;
}) {
  if (citations.length === 0) {
    return (
      <>
        <h5>Sources &amp; citations</h5>
        <p data-testid="detail-no-citations">No citations.</p>
      </>
    );
  }
  return (
    <>
      <h5>Sources &amp; citations</h5>
      <ul data-testid="detail-citations">
        {citations.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() =>
                onSelect(
                  x.sourceId
                    ? { kind: 'source', id: x.sourceId }
                    : { kind: 'note', id: x.noteId as string },
                )
              }
            >
              {x.excerpt ?? 'excerpt'} ({x.sourceId ? 'source' : 'note'})
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Source / note view ----------------------------------------------------

/**
 * Displays the original captured/imported material for notes and sources, plus
 * the claims linked to each via citations. When a note/source is selected
 * elsewhere it is highlighted.
 */
function SourcesView({
  notes,
  sources,
  excerpts,
  selected,
  onSelect,
}: {
  notes: Note[];
  sources: Source[];
  excerpts: SourceExcerptView[];
  selected: Selection | null;
  onSelect: (target: Selection) => void;
}) {
  if (notes.length === 0 && sources.length === 0) {
    return <p data-testid="sources-empty">No notes or sources captured yet.</p>;
  }
  return (
    <div data-testid="sources-view">
      <h4>Notes</h4>
      {notes.length === 0 ? (
        <p>No notes.</p>
      ) : (
        <ul>
          {notes.map((note) => {
            const linked = excerpts.filter((x) => x.noteId === note.id);
            const isSel = selected?.kind === 'note' && selected.id === note.id;
            return (
              <li
                key={note.id}
                data-testid={`source-note-${note.id}`}
                aria-current={isSel ? 'true' : undefined}
                style={isSel ? { fontWeight: 'bold' } : undefined}
              >
                <strong>{note.title ?? 'Note'}</strong>
                <blockquote>{note.content}</blockquote>
                <LinkedClaims linked={linked} onSelect={onSelect} />
              </li>
            );
          })}
        </ul>
      )}

      <h4>Sources</h4>
      {sources.length === 0 ? (
        <p>No sources.</p>
      ) : (
        <ul>
          {sources.map((source) => {
            const linked = excerpts.filter((x) => x.sourceId === source.id);
            const isSel = selected?.kind === 'source' && selected.id === source.id;
            return (
              <li
                key={source.id}
                data-testid={`source-source-${source.id}`}
                aria-current={isSel ? 'true' : undefined}
                style={isSel ? { fontWeight: 'bold' } : undefined}
              >
                <strong>{source.title ?? 'Source'}</strong>
                {source.sourceType && <> ({source.sourceType})</>}
                {source.uri && (
                  <>
                    {' '}
                    <a href={source.uri} target="_blank" rel="noreferrer">
                      {source.uri}
                    </a>
                  </>
                )}
                {source.content && <blockquote>{source.content}</blockquote>}
                <LinkedClaims linked={linked} onSelect={onSelect} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LinkedClaims({
  linked,
  onSelect,
}: {
  linked: SourceExcerptView[];
  onSelect: (target: Selection) => void;
}) {
  const withClaim = linked.filter((x) => x.claim);
  if (withClaim.length === 0) return <p>No linked claims.</p>;
  return (
    <ul>
      {withClaim.map((x) => (
        <li key={x.id}>
          {x.excerpt && <em>“{x.excerpt}” → </em>}
          <button
            type="button"
            onClick={() => onSelect({ kind: 'claim', id: x.claim?.id as string })}
          >
            {x.claim?.predicate}
          </button>
        </li>
      ))}
    </ul>
  );
}
