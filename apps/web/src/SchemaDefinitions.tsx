import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  kbRoleSatisfies,
  type CreateSchemaDefinition,
  type KnowledgeBase,
  type SchemaDefinition,
  type SchemaDefinitionKind,
  type SchemaValidationReport,
  type UpdateSchemaDefinition,
  type UpdateSchemaResult,
} from '@jotmind/schemas';
import {
  createSchemaDefinition,
  getSchemaValidation,
  listSchemaDefinitions,
  updateSchemaDefinition,
} from './api.js';

/**
 * One schema definition row (US-027 summary + US-028 editing). Editors can
 * rename, edit the validation rules (classified compatible vs breaking), and
 * check existing records for old/mismatched data; viewers see the summary only.
 */
function SchemaDefRow({
  kb,
  def,
  csrfToken,
  canEdit,
  onChanged,
}: {
  kb: KnowledgeBase;
  def: SchemaDefinition;
  csrfToken: string;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const isEntity = def.kind === 'entity_type';
  const currentRules = isEntity
    ? (def.activeVersion?.propertySchema ?? {})
    : (def.activeVersion?.spec ?? {});
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(def.displayName);
  const [description, setDescription] = useState(def.description ?? '');
  const [rules, setRules] = useState(() => JSON.stringify(currentRules, null, 2));
  const [result, setResult] = useState<UpdateSchemaResult | null>(null);
  const [report, setReport] = useState<SchemaValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roles = (def.activeVersion?.spec as { argumentRoles?: { name: string }[] })?.argumentRoles;
  const fields = def.activeVersion ? Object.keys(def.activeVersion.propertySchema) : [];

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const body: UpdateSchemaDefinition = {
        displayName: displayName.trim() || def.displayName,
        description: description.trim() ? description.trim() : null,
      };
      const text = rules.trim();
      if (text) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error('The schema JSON is not valid JSON');
        }
        if (isEntity) body.propertySchema = parsed as UpdateSchemaDefinition['propertySchema'];
        else body.spec = parsed as UpdateSchemaDefinition['spec'];
      }
      const res = await updateSchemaDefinition(kb.id, def.id, body, csrfToken);
      setResult(res);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update schema');
    } finally {
      setBusy(false);
    }
  }

  async function checkValidation() {
    setError(null);
    setBusy(true);
    try {
      setReport(await getSchemaValidation(kb.id, def.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load validation report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid={`schema-def-${def.id}`}>
      <strong>{def.displayName}</strong> <code>{def.name}</code> — v
      {def.activeVersion?.version ?? '?'}
      {def.description ? ` · ${def.description}` : ''}
      {isEntity && fields.length > 0 && <span> · fields: {fields.join(', ')}</span>}
      {!isEntity && roles && roles.length > 0 && (
        <span> · roles: {roles.map((r) => r.name).join(', ')}</span>
      )}{' '}
      <button
        type="button"
        onClick={() => void checkValidation()}
        disabled={busy}
        data-testid={`schema-check-${def.id}`}
      >
        Check data
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          data-testid={`schema-edit-${def.id}`}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      )}
      {report && (
        <div data-testid={`schema-report-${def.id}`}>
          {report.invalidRecords === 0 ? (
            <p>
              All {report.totalRecords} record(s) validate against the active version
              {report.onOldVersionRecords > 0
                ? ` (${report.onOldVersionRecords} reference an older version).`
                : '.'}
            </p>
          ) : (
            <>
              <p>
                {report.invalidRecords} of {report.totalRecords} record(s) have validation warnings:
              </p>
              <ul>
                {report.warnings.map((w) => (
                  <li key={w.recordId} data-testid={`schema-warning-${w.recordId}`}>
                    <strong>{w.label}</strong>
                    {!w.onActiveVersion && ' (older version)'}:{' '}
                    {w.issues.map((i) => i.message).join('; ')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {editing && canEdit && (
        <form onSubmit={handleSave} data-testid={`schema-edit-form-${def.id}`}>
          <label>
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid={`schema-edit-display-${def.id}`}
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid={`schema-edit-description-${def.id}`}
            />
          </label>
          <label>
            {isEntity ? 'Property schema (JSON)' : 'Predicate spec (JSON)'}
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={6}
              data-testid={`schema-edit-rules-${def.id}`}
            />
          </label>
          <button type="submit" disabled={busy} data-testid={`schema-save-${def.id}`}>
            Save changes
          </button>
          <p>
            Loosening validation is applied in place; tightening it creates a new version so
            existing data stays valid.
          </p>
        </form>
      )}
      {result && (
        <p data-testid={`schema-result-${def.id}`}>
          {result.changeType === 'breaking'
            ? `Breaking change — created version ${result.definition.activeVersion?.version ?? '?'}.`
            : 'Compatible change — updated in place.'}
          {result.reasons.length > 0 ? ` (${result.reasons.join('; ')})` : ''}
        </p>
      )}
      {error && <p data-testid={`schema-row-error-${def.id}`}>{error}</p>}
    </li>
  );
}

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
              <SchemaDefRow
                key={d.id}
                kb={kb}
                def={d}
                csrfToken={csrfToken}
                canEdit={canEdit}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}

        <h4>Claim predicates ({predicates.length})</h4>
        {predicates.length === 0 ? (
          <p data-testid="schema-predicates-empty">No custom claim predicates yet.</p>
        ) : (
          <ul>
            {predicates.map((d) => (
              <SchemaDefRow
                key={d.id}
                kb={kb}
                def={d}
                csrfToken={csrfToken}
                canEdit={canEdit}
                onChanged={refresh}
              />
            ))}
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
