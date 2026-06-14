/**
 * Selected-KB invalidation bus (US-035).
 *
 * A single, lightweight, domain-keyed pub/sub mechanism so that sibling panels
 * scoped to the currently selected Knowledge Base can refresh consistently after
 * a mutation in another panel. A mutating panel publishes one or more invalidation
 * domains via {@link useInvalidate}; any panel that depends on those domains
 * subscribes via {@link useInvalidationEffect} and re-runs its own loader.
 *
 * Design notes:
 * - This bus deliberately does NOT own or cache data. Each panel keeps its
 *   existing panel-local fetch/refresh logic; the bus only signals "this domain
 *   changed, reload if you care". That keeps every panel working in isolation
 *   (e.g. in unit tests) even when no provider is mounted — the default context
 *   value is a no-op bus, so subscribing/publishing are safe no-ops.
 * - The provider is mounted once per selected KB (keyed on kb.id), so listeners
 *   from a previous KB are torn down automatically on KB switch.
 * - Prefer this bus over ad hoc parent refs between individual sibling panels.
 *   If a localized parent ref is unavoidable, document it inline (AC3).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/**
 * The set of selected-KB data domains a mutation can invalidate. Every domain a
 * sibling panel reads or writes must be represented here (US-035 AC2).
 */
export type InvalidationDomain =
  | 'entities'
  | 'claims'
  | 'notes'
  | 'sources'
  | 'sourceExcerpts'
  | 'graphViews'
  | 'proposals'
  | 'jobs'
  | 'audit'
  | 'schemas'
  | 'rules'
  | 'modules'
  | 'aiPolicy'
  | 'searchResults'
  | 'commandResults'
  | 'answers';

/** Canonical list of all invalidation domains (handy for tests / bulk refresh). */
export const INVALIDATION_DOMAINS: readonly InvalidationDomain[] = [
  'entities',
  'claims',
  'notes',
  'sources',
  'sourceExcerpts',
  'graphViews',
  'proposals',
  'jobs',
  'audit',
  'schemas',
  'rules',
  'modules',
  'aiPolicy',
  'searchResults',
  'commandResults',
  'answers',
];

/**
 * Domains whose mutation can change Search / Command / Answer result freshness
 * (US-043). Covers the canonical graph records those results are derived from
 * (entities, claims, notes, sources, source excerpts) plus the result-specific
 * domains published by proposal-accept and inferred-claim acceptance. Exported
 * as a stable module-level constant so the `useInvalidationEffect` subscription
 * key stays stable across renders.
 */
export const RESULT_STALE_DOMAINS: InvalidationDomain[] = [
  'entities',
  'claims',
  'notes',
  'sources',
  'sourceExcerpts',
  'searchResults',
  'commandResults',
  'answers',
];

/** User-facing message shown when result panels go stale (US-043 AC4). */
export const RESULT_STALE_MESSAGE = 'Graph data changed. Rerun this search for current results.';

/**
 * User-facing message shown on AI-availability surfaces (CommandBox, Answers,
 * quick capture) when an AI policy layer changes (server/user/KB) so a
 * previously shown AI-availability indicator can no longer be trusted (US-045).
 * We mark-stale rather than auto-rerun so we never make an unexpected AI call
 * (which would defeat per-request consent) and never disturb the user's draft.
 */
export const AI_POLICY_STALE_MESSAGE = 'AI policy changed. Rerun for current AI availability.';

type Listener = () => void;

export interface InvalidationBus {
  /** Publish an invalidation for one or more domains; notifies all subscribers. */
  invalidate: (domains: InvalidationDomain | InvalidationDomain[]) => void;
  /**
   * Subscribe a listener to one or more domains. The listener fires once per
   * `invalidate` call that overlaps the subscribed domains (deduped per call).
   * Returns an unsubscribe function.
   */
  subscribe: (domains: InvalidationDomain[], listener: Listener) => () => void;
}

function toArray(domains: InvalidationDomain | InvalidationDomain[]): InvalidationDomain[] {
  return Array.isArray(domains) ? domains : [domains];
}

/**
 * Create a standalone bus instance. Exposed for tests and for the provider; app
 * code should use {@link InvalidationProvider} + the hooks rather than calling
 * this directly.
 */
export function createInvalidationBus(): InvalidationBus {
  const listeners = new Map<InvalidationDomain, Set<Listener>>();

  return {
    invalidate(domains) {
      const fired = new Set<Listener>();
      for (const domain of toArray(domains)) {
        const set = listeners.get(domain);
        if (!set) continue;
        for (const listener of set) {
          // Dedupe so a listener subscribed to multiple invalidated domains
          // only fires once per invalidate() call.
          if (fired.has(listener)) continue;
          fired.add(listener);
          listener();
        }
      }
    },
    subscribe(domains, listener) {
      for (const domain of domains) {
        let set = listeners.get(domain);
        if (!set) {
          set = new Set();
          listeners.set(domain, set);
        }
        set.add(listener);
      }
      return () => {
        for (const domain of domains) {
          listeners.get(domain)?.delete(listener);
        }
      };
    },
  };
}

/** Default no-op bus: lets panels render in isolation without a provider. */
const NOOP_BUS: InvalidationBus = {
  invalidate: () => {},
  subscribe: () => () => {},
};

const InvalidationContext = createContext<InvalidationBus>(NOOP_BUS);

/**
 * Provides a selected-KB invalidation bus to its subtree. Mount once per selected
 * KB (key on kb.id) so listeners reset on KB switch.
 */
export function InvalidationProvider({ children }: { children: ReactNode }) {
  // One stable bus per provider mount.
  const bus = useMemo(() => createInvalidationBus(), []);
  return <InvalidationContext.Provider value={bus}>{children}</InvalidationContext.Provider>;
}

/**
 * Returns a stable `invalidate(domains)` publisher. Call after a successful
 * mutation to signal dependent sibling panels to refresh.
 */
export function useInvalidate(): InvalidationBus['invalidate'] {
  const bus = useContext(InvalidationContext);
  return useCallback(
    (domains: InvalidationDomain | InvalidationDomain[]) => bus.invalidate(domains),
    [bus],
  );
}

/**
 * Subscribe a panel's reload callback to the given domains. The latest callback
 * is always used (no need to memoize it), and the subscription is rebuilt only
 * when the set of domains changes.
 */
export function useInvalidationEffect(
  domains: InvalidationDomain[],
  onInvalidate: () => void,
): void {
  const bus = useContext(InvalidationContext);
  const callbackRef = useRef(onInvalidate);
  callbackRef.current = onInvalidate;

  // Stable key so an inline array literal doesn't resubscribe every render.
  // We intentionally depend on `key` (not the array identity) and read the
  // domains/callback through closure + ref so the subscription only rebuilds
  // when the set of domains actually changes.
  const key = domains.join(',');
  const domainsRef = useRef(domains);
  domainsRef.current = domains;

  useEffect(() => {
    const unsubscribe = bus.subscribe(domainsRef.current, () => callbackRef.current());
    return unsubscribe;
  }, [bus, key]);
}
