import { useCallback, useEffect, useState } from 'react';
import { kbRoleSatisfies, type KnowledgeBase, type ModuleStatus } from '@jotmind/schemas';
import { installModule, listModules } from './api.js';
import { useInvalidate, useInvalidationEffect } from './invalidation.js';

/**
 * Built-in domain Modules (US-029). A Module bundles default entity-type and
 * claim-predicate schemas (US-027) plus inference rule packs (US-022) so a
 * Knowledge Base gets a useful, domain-shaped graph in one click. Editors can
 * install a Module (idempotent — existing content is skipped); viewers see the
 * catalog read-only.
 */
export function Modules({ kb, csrfToken }: { kb: KnowledgeBase; csrfToken: string }) {
  const canEdit = kbRoleSatisfies(kb.role, 'editor');
  const invalidate = useInvalidate();
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setModules(await listModules(kb.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load modules');
    }
  }, [kb.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh installed/skipped status when modules change elsewhere (US-042 AC4).
  useInvalidationEffect(['modules'], () => void refresh());

  async function install(moduleId: string) {
    setBusy(true);
    setError(null);
    try {
      await installModule(kb.id, moduleId, csrfToken);
      await refresh();
      // Installing a Module creates schema definitions + installs rule packs via
      // the canonical write paths, so refresh the sibling schema/rule panels and
      // the audit log without a page reload or KB reselect (US-042 AC1/AC2/AC3).
      invalidate(['modules', 'schemas', 'rules', 'audit']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not install module');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="modules" data-testid="modules">
      <h3>Modules</h3>
      <p>
        Install a built-in domain Module to add default entity types, relationship claims, and
        inference rules to this Knowledge Base.
      </p>
      {modules.length === 0 ? (
        <p data-testid="modules-empty">No Modules available.</p>
      ) : (
        <ul data-testid="modules-list">
          {modules.map((mod) => (
            <li key={mod.id} data-testid={`modules-module-${mod.id}`}>
              <strong>{mod.name}</strong>{' '}
              {mod.fullyInstalled && (
                <span data-testid={`modules-installed-${mod.id}`}>✓ installed</span>
              )}
              <p>{mod.description}</p>
              <p>
                <small>
                  Entity types: {mod.entityTypes.map((e) => e.name).join(', ')}. Relationship
                  claims: {mod.claimPredicates.map((p) => p.name).join(', ')}.
                </small>
              </p>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  data-testid={`modules-install-${mod.id}`}
                  onClick={() => void install(mod.id)}
                >
                  {mod.fullyInstalled ? 'Reinstall / repair' : 'Install Module'}
                </button>
              )}
              {!canEdit && <span data-testid={`modules-readonly-${mod.id}`}>(read-only)</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p data-testid="modules-error">{error}</p>}
    </section>
  );
}
