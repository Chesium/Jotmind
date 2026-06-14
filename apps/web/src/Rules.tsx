import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  kbRoleSatisfies,
  type BuiltinRuleModule,
  type KnowledgeBase,
  type RuleDefinition,
  type RuleRunResult,
  type RuleValidationResult,
} from '@jotmind/schemas';
import {
  createRule,
  installRulePack,
  listBuiltinRulePacks,
  listRules,
  runRule,
  setRuleStatus,
  validateRule,
} from './api.js';

const EXAMPLE_RULE =
  'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).';

/**
 * Built-in rule packs (US-022). Showcase Modules ship versioned, installable
 * bundles of inference rules. Editors can install a pack into the Knowledge
 * Base (rules install disabled) and enable/disable each rule (auditable).
 * Viewers see installed rules read-only. Rule authoring (US-023) and execution
 * (US-024) build on these definitions.
 */
export function Rules({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const [modules, setModules] = useState<BuiltinRuleModule[]>([]);
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // US-023 custom rule authoring.
  const [name, setName] = useState('');
  const [ruleText, setRuleText] = useState(EXAMPLE_RULE);
  const [recursionCap, setRecursionCap] = useState('');
  const [validation, setValidation] = useState<RuleValidationResult | null>(null);

  // US-024 rule execution: the most recent run's results, keyed by rule id.
  const [lastRun, setLastRun] = useState<RuleRunResult | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [packs, installed] = await Promise.all([listBuiltinRulePacks(kb.id), listRules(kb.id)]);
      setModules(packs);
      setRules(installed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rules');
    }
  }, [kb.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function install(moduleId: string, packId: string) {
    setBusy(true);
    setError(null);
    try {
      await installRulePack(kb.id, { moduleId, packId }, csrfToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not install rule pack');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: RuleDefinition) {
    setBusy(true);
    setError(null);
    try {
      await setRuleStatus(
        kb.id,
        rule.id,
        rule.status === 'enabled' ? 'disabled' : 'enabled',
        csrfToken,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change rule status');
    } finally {
      setBusy(false);
    }
  }

  async function run(rule: RuleDefinition) {
    setBusy(true);
    setError(null);
    setLastRun(null);
    try {
      setLastRun(await runRule(kb.id, rule.id, csrfToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run rule');
    } finally {
      setBusy(false);
    }
  }

  const capNumber = () => {
    const n = Number.parseInt(recursionCap, 10);
    return Number.isInteger(n) ? n : undefined;
  };

  async function validate() {
    setError(null);
    try {
      setValidation(await validateRule(kb.id, ruleText, capNumber()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate rule');
    }
  }

  async function author(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRule(kb.id, { name, ruleText, recursionCap: capNumber() }, csrfToken);
      setName('');
      setRuleText(EXAMPLE_RULE);
      setRecursionCap('');
      setValidation(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="rules" data-testid="rules">
      <h3>Rule Packs</h3>

      <h4>Built-in Modules</h4>
      {modules.length === 0 ? (
        <p data-testid="rules-packs-empty">No built-in rule packs available.</p>
      ) : (
        <ul data-testid="rules-packs">
          {modules.map((mod) => (
            <li key={mod.id} data-testid={`rules-module-${mod.id}`}>
              <strong>{mod.name}</strong>
              <p>{mod.description}</p>
              <ul>
                {mod.packs.map((pack) => (
                  <li key={pack.id} data-testid={`rules-pack-${mod.id}-${pack.id}`}>
                    {pack.name} (v{pack.version}) — {pack.description}{' '}
                    <span>
                      {pack.rules.length} rule{pack.rules.length === 1 ? '' : 's'}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void install(mod.id, pack.id)}
                        data-testid={`rules-install-${mod.id}-${pack.id}`}
                      >
                        Install
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <h4>Author a Custom Rule</h4>
          <form onSubmit={author} data-testid="rules-author-form">
            <p>
              <label>
                Name{' '}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  data-testid="rules-author-name"
                />
              </label>
            </p>
            <p>
              <label>
                Rule (restricted Datalog)
                <br />
                <textarea
                  value={ruleText}
                  onChange={(e) => setRuleText(e.target.value)}
                  rows={3}
                  cols={70}
                  required
                  data-testid="rules-author-text"
                />
              </label>
            </p>
            <p>
              <label>
                Recursion cap (optional){' '}
                <input
                  type="number"
                  value={recursionCap}
                  onChange={(e) => setRecursionCap(e.target.value)}
                  min={1}
                  max={64}
                  data-testid="rules-author-cap"
                />
              </label>
            </p>
            <p>
              <button
                type="button"
                onClick={() => void validate()}
                data-testid="rules-author-validate"
              >
                Validate
              </button>{' '}
              <button type="submit" disabled={busy} data-testid="rules-author-submit">
                Save as draft
              </button>
            </p>
          </form>
          {validation && (
            <p
              data-testid="rules-author-validation"
              style={{ color: validation.valid ? 'green' : 'crimson' }}
            >
              {validation.valid ? (
                <span data-testid="rules-author-valid">
                  Valid{validation.recursive ? ` (recursive, cap ${validation.recursionCap})` : ''}.
                </span>
              ) : (
                <span data-testid="rules-author-invalid">
                  Invalid:
                  <ul>
                    {validation.errors.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </span>
              )}
            </p>
          )}
        </>
      )}

      <h4>Installed Rules</h4>
      {rules.length === 0 ? (
        <p data-testid="rules-installed-empty">No rules installed yet.</p>
      ) : (
        <ul data-testid="rules-installed">
          {rules.map((rule) => (
            <li key={rule.id} data-testid={`rules-rule-${rule.id}`}>
              <strong>{rule.name}</strong> (v{rule.version}){' '}
              <span data-testid={`rules-rule-status-${rule.id}`}>[{rule.status}]</span>{' '}
              <span data-testid={`rules-rule-valid-${rule.id}`}>
                {rule.valid ? '✓ valid' : '✗ invalid'}
              </span>
              {rule.moduleId && <span> · {rule.moduleId}</span>}
              {rule.description && <p>{rule.description}</p>}
              <code>{rule.ruleText}</code>
              {!rule.valid && rule.validationErrors.length > 0 && (
                <ul data-testid={`rules-rule-errors-${rule.id}`}>
                  {rule.validationErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(rule)}
                    data-testid={`rules-toggle-${rule.id}`}
                  >
                    {rule.status === 'enabled' ? 'Disable' : 'Enable'}
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busy || rule.status !== 'enabled' || !rule.valid}
                    onClick={() => void run(rule)}
                    data-testid={`rules-run-${rule.id}`}
                  >
                    Run
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {lastRun && (
        <div data-testid="rules-run-result">
          <h4>Last Rule Run — {lastRun.run.ruleName}</h4>
          <p data-testid="rules-run-status">
            Status: <strong>{lastRun.run.status}</strong> · {lastRun.run.resultCount} inferred
            result(s) · {lastRun.run.iterations} iteration(s)
            {lastRun.run.limitExceeded && ' · iteration cap reached'}
          </p>
          {lastRun.run.error && <p data-testid="rules-run-error">Error: {lastRun.run.error}</p>}
          {lastRun.results.length === 0 ? (
            <p data-testid="rules-run-empty">No inferred results.</p>
          ) : (
            <ul data-testid="rules-run-results">
              {lastRun.results.map((result) => (
                <li key={result.id} data-testid={`rules-run-result-${result.id}`}>
                  <span data-testid={`rules-run-label-${result.id}`}>[{result.label}]</span>{' '}
                  <strong>{result.predicate}</strong>(
                  {result.arguments.map((arg) => arg.entityName ?? arg.value).join(', ')})
                  <small data-testid={`rules-run-trace-${result.id}`}>
                    {' '}
                    — derived from {result.trace.claimIds.length} claim(s),{' '}
                    {result.trace.argumentIds.length} argument(s)
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!canEdit && <p>You have read-only access to rules in this Knowledge Base.</p>}
      {error && <p data-testid="rules-error">{error}</p>}
    </section>
  );
}
