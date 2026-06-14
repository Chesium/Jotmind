import { useCallback, useEffect, useState } from 'react';
import {
  kbRoleSatisfies,
  type BuiltinRuleModule,
  type KnowledgeBase,
  type RuleDefinition,
} from '@jotmind/schemas';
import { installRulePack, listBuiltinRulePacks, listRules, setRuleStatus } from './api.js';

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

      <h4>Installed Rules</h4>
      {rules.length === 0 ? (
        <p data-testid="rules-installed-empty">No rules installed yet.</p>
      ) : (
        <ul data-testid="rules-installed">
          {rules.map((rule) => (
            <li key={rule.id} data-testid={`rules-rule-${rule.id}`}>
              <strong>{rule.name}</strong> (v{rule.version}){' '}
              <span data-testid={`rules-rule-status-${rule.id}`}>[{rule.status}]</span>
              {rule.moduleId && <span> · {rule.moduleId}</span>}
              {rule.description && <p>{rule.description}</p>}
              <code>{rule.ruleText}</code>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(rule)}
                  data-testid={`rules-toggle-${rule.id}`}
                >
                  {rule.status === 'enabled' ? 'Disable' : 'Enable'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canEdit && <p>You have read-only access to rules in this Knowledge Base.</p>}
      {error && <p data-testid="rules-error">{error}</p>}
    </section>
  );
}
