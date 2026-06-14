import type postgres from 'postgres';
import { getSqlClient } from '../db/client.js';

/**
 * Apache AGE access layer (US-026).
 *
 * AGE is a *derived* projection of the canonical relational tables. It is fed
 * from `graph_outbox` and can be fully rebuilt from the relational source of
 * truth, so AGE never holds canonical data and an AGE failure can never corrupt
 * canonical records.
 *
 * IMPORTANT session semantics: every AGE statement must run on a connection
 * that has executed `LOAD 'age'` and `SET search_path = ag_catalog, ...`. With
 * postgres-js connection pooling each query may land on a different physical
 * connection, so ALL AGE work is wrapped in a single `begin()` block (which
 * pins one connection) via {@link withAge}.
 *
 * Cypher parameters: AGE requires the third `cypher()` argument to be a real
 * bind parameter inferred as `agtype` (a literal or a cast expression is
 * rejected). postgres-js sends interpolated values as bind parameters, so user
 * text (names/predicates/roles) is passed through the parameter map and never
 * concatenated into the Cypher body — keeping the projector injection-safe.
 */

export const AGE_GRAPH_NAME = 'jotmind_graph';

type Sql = ReturnType<typeof getSqlClient>;

export interface AgeSession {
  /**
   * Run a Cypher statement against the JotMind graph.
   * @param body Cypher between the implicit `$$ ... $$` delimiters. Use `$name`
   *   placeholders for any user-supplied values and pass them via `params`.
   * @param columns The `AS (...)` column list (e.g. `'v agtype'`).
   * @param params Values bound into the Cypher `$name` placeholders.
   */
  cypher(body: string, columns: string, params?: Record<string, unknown>): Promise<postgres.Row[]>;
}

function buildSession(tx: Sql): AgeSession {
  return {
    async cypher(body, columns, params) {
      const hasParams = params !== undefined;
      const paramsArg = hasParams ? ', $1' : '';
      const query =
        `SELECT * FROM ag_catalog.cypher('${AGE_GRAPH_NAME}', $cypher$ ${body} $cypher$${paramsArg}) ` +
        `AS (${columns})`;
      const values = hasParams ? [JSON.stringify(params)] : [];
      return tx.unsafe(query, values);
    },
  };
}

let graphEnsured = false;

/** Idempotently create the AGE graph (and reset the in-process cache hint). */
async function ensureAgeGraph(tx: Sql): Promise<void> {
  const existing = await tx`SELECT 1 FROM ag_catalog.ag_graph WHERE name = ${AGE_GRAPH_NAME}`;
  if (existing.length === 0) {
    await tx`SELECT ag_catalog.create_graph(${AGE_GRAPH_NAME})`;
  }
  graphEnsured = true;
}

/**
 * Run `fn` in an AGE-enabled session: a single pooled connection with `age`
 * loaded, the catalog on the search path, and the JotMind graph guaranteed to
 * exist. All AGE reads/writes must go through this helper.
 */
export async function withAge<T>(fn: (age: AgeSession) => Promise<T>): Promise<T> {
  const client = getSqlClient();
  return client.begin(async (tx) => {
    await tx`LOAD 'age'`;
    await tx`SET LOCAL search_path = ag_catalog, "$user", public`;
    await ensureAgeGraph(tx as unknown as Sql);
    return fn(buildSession(tx as unknown as Sql));
  }) as Promise<T>;
}

/** For tests: forget that the graph was ensured (it is re-checked anyway). */
export function resetAgeGraphCache(): void {
  graphEnsured = false;
}

export function isAgeGraphEnsured(): boolean {
  return graphEnsured;
}
