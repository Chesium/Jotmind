import { describe, expect, it } from 'vitest';
import {
  acceptInferredResultResultSchema,
  acceptInferredResultSchema,
  BUILTIN_RULE_MODULES,
  builtinRuleModuleListSchema,
  clampRecursionCap,
  findBuiltinRulePack,
  INFERRED_CLAIM_ORIGIN,
  installRulePackSchema,
  parseRule,
  RULE_RECURSION_CAP_DEFAULT,
  RULE_RECURSION_CAP_MAX,
  RULE_RECURSION_CAP_MIN,
  updateRuleStatusSchema,
} from './rules.js';

describe('built-in rule packs (US-022)', () => {
  it('catalog validates against the schema', () => {
    expect(() => builtinRuleModuleListSchema.parse(BUILTIN_RULE_MODULES)).not.toThrow();
  });

  it('ships the personal-relationship Module with an event-participation pack', () => {
    const found = findBuiltinRulePack('personal-relationship', 'event-participation');
    expect(found).toBeTruthy();
    expect(found!.pack.category).toBe('event-participation');
    expect(found!.pack.rules.length).toBeGreaterThanOrEqual(1);
  });

  it('ships the reading-character-map Module with a family-relationship pack', () => {
    const found = findBuiltinRulePack('reading-character-map', 'family-relationship');
    expect(found).toBeTruthy();
    expect(found!.pack.category).toBe('family-relationship');
    expect(found!.pack.rules.length).toBeGreaterThanOrEqual(1);
  });

  it('every built-in pack is versioned with at least one rule', () => {
    for (const mod of BUILTIN_RULE_MODULES) {
      expect(mod.packs.length).toBeGreaterThanOrEqual(1);
      for (const pack of mod.packs) {
        expect(pack.version).toBeGreaterThan(0);
        expect(pack.rules.length).toBeGreaterThanOrEqual(1);
        for (const rule of pack.rules) {
          expect(rule.ruleText).toContain('<-');
        }
      }
    }
  });

  it('returns undefined for unknown module/pack ids', () => {
    expect(findBuiltinRulePack('nope', 'event-participation')).toBeUndefined();
    expect(findBuiltinRulePack('personal-relationship', 'nope')).toBeUndefined();
  });

  it('install request requires module and pack ids', () => {
    expect(installRulePackSchema.safeParse({ moduleId: 'a', packId: 'b' }).success).toBe(true);
    expect(installRulePackSchema.safeParse({ moduleId: '', packId: 'b' }).success).toBe(false);
    expect(installRulePackSchema.safeParse({ moduleId: 'a' }).success).toBe(false);
  });

  it('status update only accepts enabled/disabled', () => {
    expect(updateRuleStatusSchema.safeParse({ status: 'enabled' }).success).toBe(true);
    expect(updateRuleStatusSchema.safeParse({ status: 'disabled' }).success).toBe(true);
    expect(updateRuleStatusSchema.safeParse({ status: 'draft' }).success).toBe(false);
  });
});

describe('restricted Datalog rule parser (US-023)', () => {
  it('parses the canonical example with explicit variables (AC1/AC2)', () => {
    const r = parseRule(
      'knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).',
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.rule).toBeTruthy();
    expect(r.rule!.head.predicate).toBe('knows');
    expect(r.rule!.head.args).toEqual([
      { kind: 'var', name: 'a' },
      { kind: 'var', name: 'b' },
    ]);
    expect(r.rule!.body).toHaveLength(3);
    expect(r.rule!.body[0]).toMatchObject({ predicate: 'claim', negated: false });
    expect(r.rule!.recursive).toBe(false);
  });

  it('accepts all three built-in low-level predicates with correct arity (AC2)', () => {
    const r = parseRule('p(?id) <- entity(?id, ?t, ?n), claim(?cid, "x"), arg(?cid, "r", ?id).');
    expect(r.valid).toBe(true);
  });

  it('rejects wrong built-in arity', () => {
    const r = parseRule('p(?a) <- entity(?a, ?b).');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('takes 3 arguments');
  });

  it('enforces range-restriction safety: head var must be in a positive atom (AC3)', () => {
    const r = parseRule('knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a).');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('range restriction');
    expect(r.errors.join(' ')).toContain('?b');
  });

  it('rejects skolem / function terms (AC4)', () => {
    const r = parseRule('p(?a) <- entity(?a, f(?a), ?n).');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('Skolem/function terms');
  });

  it('rejects blank nodes and anonymous/existential variables (AC4)', () => {
    expect(parseRule('p(?a) <- claim(?a, _:x).').valid).toBe(false);
    expect(parseRule('p(?a) <- claim(?a, ?_).').valid).toBe(false);
    const ex = parseRule('p(?a) <- exists(?a), claim(?a, "x").');
    expect(ex.valid).toBe(false);
    expect(ex.errors.join(' ')).toContain('Existential');
  });

  it('rejects a head that redefines a built-in predicate (AC4)', () => {
    const r = parseRule('entity(?a, ?t, ?n) <- claim(?a, "x").');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('redefine the built-in predicate');
  });

  it('rejects unknown predicates (only built-ins or self-recursion allowed, AC7/AC8)', () => {
    const r = parseRule('p(?a) <- mystery(?a).');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('Unknown predicate');
  });

  it('allows bounded direct recursion and reports it with a cap (AC8)', () => {
    const r = parseRule(
      'ancestor(?a, ?b) <- claim(?c, "parent_of"), arg(?c, "parent", ?a), arg(?c, "child", ?b).\n',
    );
    expect(r.valid).toBe(true);
    const rec = parseRule(
      'reach(?a, ?b) <- claim(?c, "parent_of"), arg(?c, "parent", ?a), arg(?c, "child", ?b), reach(?b, ?a).',
      { recursionCap: 8 },
    );
    expect(rec.valid).toBe(true);
    expect(rec.recursive).toBe(true);
    expect(rec.recursionCap).toBe(8);
    expect(rec.rule!.recursionCap).toBe(8);
  });

  it('clamps the recursion cap to the configured bounds', () => {
    expect(clampRecursionCap(undefined)).toBe(RULE_RECURSION_CAP_DEFAULT);
    expect(clampRecursionCap(0)).toBe(RULE_RECURSION_CAP_MIN);
    expect(clampRecursionCap(1000)).toBe(RULE_RECURSION_CAP_MAX);
    const r = parseRule('p(?a) <- claim(?a, "x").', { recursionCap: 9999 });
    expect(r.errors.join(' ')).toContain('recursionCap must be');
  });

  it('requires a non-empty body and a trailing dot', () => {
    expect(parseRule('p(?a) <- .').valid).toBe(false);
    expect(parseRule('p(?a) <- claim(?a, "x")').valid).toBe(false);
  });

  it('supports restricted negation but rejects unsafe negation (AC7)', () => {
    const safe = parseRule('lonely(?a) <- entity(?a, "Person", ?n), not arg(?c, "person", ?a).');
    // ?c is only in a negated atom and ?a is positive; negation var ?c is unsafe
    expect(safe.valid).toBe(false);
    expect(safe.errors.join(' ')).toContain('Unsafe negation');
  });
});

describe('accept inferred result schemas (US-025)', () => {
  it('accepts an empty body and an optional confirmation note', () => {
    expect(acceptInferredResultSchema.parse({})).toEqual({});
    expect(acceptInferredResultSchema.parse({ confirmationNote: 'ok' })).toEqual({
      confirmationNote: 'ok',
    });
  });

  it('rejects an over-long confirmation note', () => {
    const result = acceptInferredResultSchema.safeParse({ confirmationNote: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('uses a distinguishable provenance origin (AC3)', () => {
    expect(INFERRED_CLAIM_ORIGIN).toBe('inferred');
  });

  it('validates the accept result shape', () => {
    const result = acceptInferredResultResultSchema.parse({
      claimId: '00000000-0000-0000-0000-0000000000c1',
      result: {
        id: '00000000-0000-0000-0000-0000000000d1',
        knowledgeBaseId: '00000000-0000-0000-0000-0000000000e1',
        ruleRunId: '00000000-0000-0000-0000-0000000000f1',
        ruleId: null,
        ruleName: 'acquainted',
        predicate: 'acquainted',
        label: 'inferred',
        arguments: [
          { name: 'a', value: '00000000-0000-0000-0000-0000000000a1', entityName: 'Ada' },
        ],
        trace: { claimIds: [], entityIds: [], argumentIds: [] },
        createdAt: new Date().toISOString(),
      },
    });
    expect(result.claimId).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(result.result.label).toBe('inferred');
  });
});
