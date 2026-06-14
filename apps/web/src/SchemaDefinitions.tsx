import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  kbRoleSatisfies,
  type CreateSchemaDefinition,
  type KnowledgeBase,
  type SchemaDefinition,
  type SchemaDefinitionKind,
} from '@jotmind/schemas';
import { createSchemaDefinition, listSchemaDefinitions } from './api.js';

const ENTITY_SCHEMA_PLACEHOLDER = `{
  "born": { "type": "number", "required": true },
  "city": { "type": "string" }
}`;

const PREDICATE_SPEC_PLACEHOLDER = `{
  "argumentRoles": [
    { "name": "subject", "required": true, "entityTypes": ["Person"] },
    { "name": "object", "required": true, "entityTypes": ["Person"] }
  ]
}`;

/**
 * Custom schema builder (US-027). Advanced users define custom entity types
 * (with a JSONB property schema) and claim predicates (with allowed argument
 * roles + compatible entity types). Definitions are Knowledge Base scoped and
 * power validation of entities/claims before save. Editors can create; viewers
 * see the list read-only.
 */
export function SchemaDefinitions({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [defs, setDefs] = useState<SchemaDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<SchemaDefinitionKind>('entity_type');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [spec, setSpec] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDefs(await listSchemaDefinitions(kb.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load schemas');
    }
  }, [kb.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: CreateSchemaDefinition = {
        kind,
        name: name.trim(),
        displayName: displayName.trim() || name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      const text = spec.trim();
      if (text) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error('The schema JSON is not valid JSON');
        }
        if (kind === 'entity_type') {
          body.propertySchema = parsed as CreateSchemaDefinition['propertySchema'];
        } else {
          body.spec = parsed as CreateSchemaDefinition['spec'];
        }
      }
      await createSchemaDefinition(kb.id, body, csrfToken);
      setName('');
      setDisplayName('');
      setDescription('');
      setSpec('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create schema');
    } finally {
      setBusy(false);
    }
  }

  const entityTypes = defs.filter((d) => d.kind === 'entity_type');
  const predicates = defs.filter((d) => d.kind === 'claim_predicate');

  return (
    <section data-testid="schema-definitions">
      <h3>Custom Schemas</h3>
      <p>
        Define custom entity types and claim predicates so entities/claims validate against your
        domain before save.
      </p>

      <div data-testid="schema-list">
        <h4>Entity types ({entityTypes.length})</h4>
        {entityTypes.length === 0 ? (
          <p data-testid="schema-entity-types-empty">No custom entity types yet.</p>
        ) : (
          <ul>
            {entityTypes.map((d) => (
              <li key={d.id} data-testid={`schema-def-${d.id}`}>
                <strong>{d.displayName}</strong> <code>{d.name}</code> — v
                {d.activeVersion?.version ?? '?'}
                {d.description ? ` · ${d.description}` : ''}
                {d.activeVersion && Object.keys(d.activeVersion.propertySchema).length > 0 && (
                  <span> · fields: {Object.keys(d.activeVersion.propertySchema).join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <h4>Claim predicates ({predicates.length})</h4>
        {predicates.length === 0 ? (
          <p data-testid="schema-predicates-empty">No custom claim predicates yet.</p>
        ) : (
          <ul>
            {predicates.map((d) => {
              const roles = (d.activeVersion?.spec as { argumentRoles?: { name: string }[] })
                ?.argumentRoles;
              return (
                <li key={d.id} data-testid={`schema-def-${d.id}`}>
                  <strong>{d.displayName}</strong> <code>{d.name}</code> — v
                  {d.activeVersion?.version ?? '?'}
                  {roles && roles.length > 0 && (
                    <span> · roles: {roles.map((r) => r.name).join(', ')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canEdit ? (
        <form onSubmit={handleSubmit} data-testid="schema-create-form">
          <h4>Create a schema</h4>
          <label>
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SchemaDefinitionKind)}
              data-testid="schema-kind"
            >
              <option value="entity_type">Entity type</option>
              <option value="claim_predicate">Claim predicate</option>
            </select>
          </label>
          <label>
            Name (conceptual type)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              data-testid="schema-name"
            />
          </label>
          <label>
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid="schema-display-name"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="schema-description"
            />
          </label>
          <label>
            {kind === 'entity_type' ? 'Property schema (JSON)' : 'Predicate spec (JSON)'}
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              rows={6}
              placeholder={
                kind === 'entity_type' ? ENTITY_SCHEMA_PLACEHOLDER : PREDICATE_SPEC_PLACEHOLDER
              }
              data-testid="schema-spec"
            />
          </label>
          <button type="submit" disabled={busy} data-testid="schema-submit">
            Create schema
          </button>
        </form>
      ) : (
        <p data-testid="schema-readonly">You need editor access to define custom schemas.</p>
      )}

      {error && <p data-testid="schema-error">{error}</p>}
    </section>
  );
}
