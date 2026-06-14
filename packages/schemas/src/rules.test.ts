import { describe, expect, it } from 'vitest';
import {
  BUILTIN_RULE_MODULES,
  builtinRuleModuleListSchema,
  findBuiltinRulePack,
  installRulePackSchema,
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
