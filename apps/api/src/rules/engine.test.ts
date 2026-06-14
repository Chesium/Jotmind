import { describe, expect, it } from 'vitest';
import { parseRule } from '@jotmind/schemas';
import { executeRule, type RuleFacts } from './engine.js';

function compile(text: string, recursionCap?: number) {
  const parsed = parseRule(text, recursionCap === undefined ? undefined : { recursionCap });
  if (!parsed.valid || !parsed.rule) {
    throw new Error(`rule did not compile: ${parsed.errors.join('; ')}`);
  }
  return parsed.rule;
}

// Fixture: Ada and Babbage both attended event EV1; Lovelace attended EV2.
const ADA = '00000000-0000-0000-0000-0000000000a1';
const BAB = '00000000-0000-0000-0000-0000000000b2';
const LOV = '00000000-0000-0000-0000-0000000000c3';
const EV1 = '00000000-0000-0000-0000-0000000000e1';
const EV2 = '00000000-0000-0000-0000-0000000000e2';
const C1 = '00000000-0000-0000-0000-0000000000f1';
const C2 = '00000000-0000-0000-0000-0000000000f2';
const C3 = '00000000-0000-0000-0000-0000000000f3';

function attendanceFacts(): RuleFacts {
  return {
    entities: [
      { id: ADA, type: 'Person', name: 'Ada' },
      { id: BAB, type: 'Person', name: 'Babbage' },
      { id: LOV, type: 'Person', name: 'Lovelace' },
      { id: EV1, type: 'Event', name: 'Event One' },
      { id: EV2, type: 'Event', name: 'Event Two' },
    ],
    claims: [
      { id: C1, predicate: 'attended' },
      { id: C2, predicate: 'attended' },
      { id: C3, predicate: 'attended' },
    ],
    args: [
      { id: 'a1', claimId: C1, role: 'person', entityId: ADA },
      { id: 'a2', claimId: C1, role: 'event', entityId: EV1 },
      { id: 'a3', claimId: C2, role: 'person', entityId: BAB },
      { id: 'a4', claimId: C2, role: 'event', entityId: EV1 },
      { id: 'a5', claimId: C3, role: 'person', entityId: LOV },
      { id: 'a6', claimId: C3, role: 'event', entityId: EV2 },
    ],
  };
}

const ACQUAINTED =
  'acquainted(?a, ?b) <- claim(?e1, "attended"), arg(?e1, "person", ?a), arg(?e1, "event", ?ev), claim(?e2, "attended"), arg(?e2, "person", ?b), arg(?e2, "event", ?ev).';

describe('rule execution engine (US-024)', () => {
  it('derives head tuples from a conjunctive (non-recursive) rule', () => {
    const result = executeRule(compile(ACQUAINTED), attendanceFacts());
    const pairs = result.results.map((t) => [t.values[0], t.values[1]]);
    // Ada & Babbage both attended EV1 -> all combinations among {Ada, Babbage}.
    expect(pairs).toContainEqual([ADA, BAB]);
    expect(pairs).toContainEqual([BAB, ADA]);
    expect(pairs).toContainEqual([ADA, ADA]);
    // Lovelace attended a different event -> never paired with the others.
    expect(pairs).not.toContainEqual([ADA, LOV]);
    expect(pairs).not.toContainEqual([LOV, ADA]);
    expect(result.limitExceeded).toBe(false);
  });

  it('records the source claims and arguments used in each tuple (AC6)', () => {
    const result = executeRule(compile(ACQUAINTED), attendanceFacts());
    const adaBab = result.results.find((t) => t.values[0] === ADA && t.values[1] === BAB);
    expect(adaBab).toBeTruthy();
    // Derived from both attendance claims and their arguments + the entities.
    expect(adaBab!.claimIds.sort()).toEqual([C1, C2].sort());
    expect(adaBab!.argumentIds).toEqual(expect.arrayContaining(['a1', 'a2', 'a3', 'a4']));
    expect(adaBab!.entityIds).toEqual(expect.arrayContaining([ADA, BAB, EV1]));
  });

  it('matches literal terms against the right predicate only', () => {
    const base = attendanceFacts();
    // A "knows" claim must NOT match the body's `claim(?e, "attended")` literal.
    const facts = { ...base, claims: [...base.claims, { id: 'cx', predicate: 'knows' }] };
    const result = executeRule(compile(ACQUAINTED), facts);
    expect(result.results.every((t) => !t.claimIds.includes('cx'))).toBe(true);
  });

  it('returns no results when no facts match', () => {
    const empty: RuleFacts = { entities: [], claims: [], args: [] };
    const result = executeRule(compile(ACQUAINTED), empty);
    expect(result.results).toHaveLength(0);
    expect(result.limitExceeded).toBe(false);
  });

  it('binds head literals with a null variable name slot', () => {
    // A head with a literal term: tag(?p, "person") for every Person entity.
    const rule = compile('tagged(?p, "person") <- entity(?p, "Person", ?n).');
    const result = executeRule(rule, attendanceFacts());
    expect(result.results.length).toBe(3); // Ada, Babbage, Lovelace
    expect(result.results.every((t) => t.values[1] === 'person')).toBe(true);
  });

  it('terminates safely on a self-recursive rule (no derivable base => inert)', () => {
    // A single linear-recursive rule has no base disjunct, so it cannot
    // bootstrap and derives nothing. It must still terminate (one pass) without
    // exceeding the cap (AC2/AC8).
    const rule = compile(
      'reach(?a, ?b) <- reach(?a, ?x), claim(?c, "linked"), arg(?c, "from", ?x), arg(?c, "to", ?b).',
      8,
    );
    const facts: RuleFacts = {
      entities: [{ id: 'p1', type: 'Person', name: 'P1' }],
      claims: [{ id: 'c1', predicate: 'linked' }],
      args: [
        { id: 'r1', claimId: 'c1', role: 'from', entityId: 'p1' },
        { id: 'r2', claimId: 'c1', role: 'to', entityId: 'p1' },
      ],
    };
    const result = executeRule(rule, facts);
    expect(result.results).toHaveLength(0);
    expect(result.iterations).toBeLessThanOrEqual(8);
    expect(result.limitExceeded).toBe(false);
  });

  it('bounds iterations by the recursion cap (AC2)', () => {
    // Non-recursive rules reach a fixpoint in a single productive pass; the
    // bounded loop never runs more iterations than the cap.
    const rule = compile(
      'p(?a, ?b) <- claim(?c, "attended"), arg(?c, "person", ?a), arg(?c, "event", ?b).',
      3,
    );
    const result = executeRule(rule, attendanceFacts());
    expect(result.iterations).toBeLessThanOrEqual(3);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.limitExceeded).toBe(false);
  });
});
