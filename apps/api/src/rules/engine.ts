import { type CompiledRule, type RuleBodyAtom, type RuleTerm } from '@jotmind/schemas';

/**
 * Rule execution engine (US-024). A pure, in-memory evaluator for the restricted
 * Datalog dialect parsed by `parseRule` (US-023). It NEVER touches the database,
 * filesystem, network, or `eval` — it only walks the compiled AST over a set of
 * facts supplied by the caller (the DB-backed `RuleRunStore.loadFacts` already
 * injects the hidden `deleted_at IS NULL` + current-valid-time predicates so the
 * facts handed here are exactly the live, currently-valid records, AC3/AC4).
 *
 * Evaluation is a bottom-up, semi-naïve fixpoint bounded by the rule's recursion
 * cap (AC2). Each derived head tuple carries a trace of the source claims,
 * arguments, and entities used to derive it (AC6).
 */

/** Facts about a Knowledge Base, already soft-delete + valid-time filtered. */
export interface RuleFacts {
  entities: ReadonlyArray<{ id: string; type: string; name: string }>;
  claims: ReadonlyArray<{ id: string; predicate: string }>;
  args: ReadonlyArray<{ id: string; claimId: string; role: string; entityId: string }>;
}

/** A resolved head tuple inferred by a rule, with its derivation trace. */
export interface InferredTuple {
  /** Resolved values for each head term, in head-argument order. */
  values: string[];
  claimIds: string[];
  entityIds: string[];
  argumentIds: string[];
}

export interface RuleExecutionResult {
  results: InferredTuple[];
  iterations: number;
  limitExceeded: boolean;
}

interface PartialMatch {
  bindings: Map<string, string>;
  claimIds: Set<string>;
  entityIds: Set<string>;
  argumentIds: Set<string>;
}

/** A candidate fact row for an atom: ordered field values + the trace it adds. */
interface Candidate {
  values: string[];
  claimIds?: readonly string[];
  entityIds?: readonly string[];
  argumentIds?: readonly string[];
}

function emptyMatch(): PartialMatch {
  return {
    bindings: new Map(),
    claimIds: new Set(),
    entityIds: new Set(),
    argumentIds: new Set(),
  };
}

/** Try to unify an atom's terms against a candidate's ordered values. */
function unify(terms: RuleTerm[], values: string[], base: PartialMatch): PartialMatch | null {
  if (terms.length !== values.length) return null;
  const bindings = new Map(base.bindings);
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i] as RuleTerm;
    const value = values[i] as string;
    if (term.kind === 'literal') {
      if (term.value !== value) return null;
    } else {
      const current = bindings.get(term.name);
      if (current !== undefined) {
        if (current !== value) return null;
      } else {
        bindings.set(term.name, value);
      }
    }
  }
  return {
    bindings,
    claimIds: new Set(base.claimIds),
    entityIds: new Set(base.entityIds),
    argumentIds: new Set(base.argumentIds),
  };
}

/** Candidate fact rows for a (positive) atom, including the head relation. */
function candidatesFor(
  atom: RuleBodyAtom,
  facts: RuleFacts,
  headPredicate: string,
  derived: InferredTuple[],
): Candidate[] {
  if (atom.predicate === 'entity') {
    return facts.entities.map((e) => ({ values: [e.id, e.type, e.name], entityIds: [e.id] }));
  }
  if (atom.predicate === 'claim') {
    return facts.claims.map((c) => ({ values: [c.id, c.predicate], claimIds: [c.id] }));
  }
  if (atom.predicate === 'arg') {
    return facts.args.map((a) => ({
      values: [a.claimId, a.role, a.entityId],
      claimIds: [a.claimId],
      argumentIds: [a.id],
      entityIds: [a.entityId],
    }));
  }
  if (atom.predicate === headPredicate) {
    // Recursive reference: match against already-derived head tuples, carrying
    // each tuple's own trace forward.
    return derived.map((t) => ({
      values: t.values,
      claimIds: t.claimIds,
      entityIds: t.entityIds,
      argumentIds: t.argumentIds,
    }));
  }
  return [];
}

/** Extend the current matches with a positive atom (a join step). */
function extendPositive(
  atom: RuleBodyAtom,
  facts: RuleFacts,
  headPredicate: string,
  derived: InferredTuple[],
  matches: PartialMatch[],
): PartialMatch[] {
  const candidates = candidatesFor(atom, facts, headPredicate, derived);
  const out: PartialMatch[] = [];
  for (const match of matches) {
    for (const cand of candidates) {
      const next = unify(atom.args, cand.values, match);
      if (!next) continue;
      cand.claimIds?.forEach((id) => next.claimIds.add(id));
      cand.entityIds?.forEach((id) => next.entityIds.add(id));
      cand.argumentIds?.forEach((id) => next.argumentIds.add(id));
      out.push(next);
    }
  }
  return out;
}

/** Filter matches by a negated atom (stratified negation; adds no trace). */
function filterNegated(
  atom: RuleBodyAtom,
  facts: RuleFacts,
  headPredicate: string,
  derived: InferredTuple[],
  matches: PartialMatch[],
): PartialMatch[] {
  const candidates = candidatesFor(atom, facts, headPredicate, derived);
  return matches.filter(
    (match) => !candidates.some((cand) => unify(atom.args, cand.values, match) !== null),
  );
}

/** Evaluate the rule body once against the facts + currently-derived tuples. */
function evalBody(rule: CompiledRule, facts: RuleFacts, derived: InferredTuple[]): PartialMatch[] {
  // Process positive atoms first so negated-atom variables are already bound
  // (the parser guarantees range restriction, US-023).
  const positives = rule.body.filter((a) => !a.negated);
  const negatives = rule.body.filter((a) => a.negated);

  let matches: PartialMatch[] = [emptyMatch()];
  for (const atom of positives) {
    matches = extendPositive(atom, facts, rule.head.predicate, derived, matches);
    if (matches.length === 0) return matches;
  }
  for (const atom of negatives) {
    matches = filterNegated(atom, facts, rule.head.predicate, derived, matches);
    if (matches.length === 0) return matches;
  }
  return matches;
}

/** Resolve a match into the head tuple it derives. */
function toTuple(rule: CompiledRule, match: PartialMatch): InferredTuple | null {
  const values: string[] = [];
  for (const term of rule.head.args) {
    if (term.kind === 'literal') {
      values.push(term.value);
    } else {
      const bound = match.bindings.get(term.name);
      if (bound === undefined) return null; // range restriction guarantees this won't happen
      values.push(bound);
    }
  }
  return {
    values,
    claimIds: [...match.claimIds].sort(),
    entityIds: [...match.entityIds].sort(),
    argumentIds: [...match.argumentIds].sort(),
  };
}

function tupleKey(values: string[]): string {
  return JSON.stringify(values);
}

/**
 * Execute a compiled rule against the supplied facts. Bounded by the rule's
 * `recursionCap` iterations; if new tuples are still being derived when the cap
 * is reached, `limitExceeded` is set so the caller can report it safely (AC2).
 */
export function executeRule(rule: CompiledRule, facts: RuleFacts): RuleExecutionResult {
  const cap = rule.recursionCap;
  const derived: InferredTuple[] = [];
  const seen = new Set<string>();
  let iterations = 0;

  for (let i = 0; i < cap; i++) {
    iterations = i + 1;
    const matches = evalBody(rule, facts, derived);
    let added = 0;
    for (const match of matches) {
      const tuple = toTuple(rule, match);
      if (!tuple) continue;
      const key = tupleKey(tuple.values);
      if (seen.has(key)) continue;
      seen.add(key);
      derived.push(tuple);
      added++;
    }
    if (added === 0) {
      // Fixpoint reached within the cap.
      return { results: derived, iterations, limitExceeded: false };
    }
  }

  // Cap reached. Determine whether more tuples would still be derived (limit
  // exceeded) without actually adding them.
  const extra = evalBody(rule, facts, derived);
  let limitExceeded = false;
  for (const match of extra) {
    const tuple = toTuple(rule, match);
    if (!tuple) continue;
    if (!seen.has(tupleKey(tuple.values))) {
      limitExceeded = true;
      break;
    }
  }
  return { results: derived, iterations, limitExceeded };
}
