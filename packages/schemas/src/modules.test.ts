import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MODULES,
  builtinModuleListSchema,
  findBuiltinModule,
  installModuleResultSchema,
  installModuleSchema,
  moduleStatusSchema,
} from './modules.js';
import { findBuiltinRulePack } from './rules.js';
import { validateEntityProperties } from './schema-defs.js';

describe('BUILTIN_MODULES', () => {
  it('is a valid, non-empty catalog', () => {
    expect(BUILTIN_MODULES.length).toBeGreaterThan(0);
    expect(() => builtinModuleListSchema.parse(BUILTIN_MODULES)).not.toThrow();
  });

  it('ships the personal-relationship Module with Person, Event, and Place (AC1)', () => {
    const mod = findBuiltinModule('personal-relationship');
    expect(mod).toBeDefined();
    const types = mod!.entityTypes.map((e) => e.name);
    expect(types).toContain('Person');
    expect(types).toContain('Event');
    expect(types).toContain('Place');
  });

  it('Person supports birthday uncertainty, contact/social fields, and relationship strength (AC2)', () => {
    const mod = findBuiltinModule('personal-relationship')!;
    const person = mod.entityTypes.find((e) => e.name === 'Person')!;
    const fields = Object.keys(person.propertySchema);
    expect(fields).toEqual(
      expect.arrayContaining([
        'birthday',
        'birthdayPrecision',
        'email',
        'phone',
        'social',
        'relationshipStrength',
      ]),
    );
    // No field is required, so a minimal Person (name only) still validates.
    expect(validateEntityProperties(person.propertySchema, {}).valid).toBe(true);
    // relationshipStrength is numeric.
    expect(
      validateEntityProperties(person.propertySchema, { relationshipStrength: 'high' }).valid,
    ).toBe(false);
  });

  it('records event-participation relationship claims (AC3)', () => {
    const mod = findBuiltinModule('personal-relationship')!;
    const predicates = mod.claimPredicates.map((p) => p.name);
    expect(predicates).toEqual(
      expect.arrayContaining(['attended', 'met', 'introduced', 'interacted_with', 'mentioned']),
    );
  });

  it('supports location-aware recall via a Person→Place predicate (AC4)', () => {
    const mod = findBuiltinModule('personal-relationship')!;
    const livesIn = mod.claimPredicates.find((p) => p.name === 'lives_in')!;
    const place = livesIn.spec.argumentRoles.find((r) => r.name === 'place')!;
    expect(place.entityTypes).toContain('Place');
  });

  it('references rule packs that exist in the rule catalog', () => {
    for (const mod of BUILTIN_MODULES) {
      for (const ref of mod.rulePacks) {
        expect(findBuiltinRulePack(ref.moduleId, ref.packId)).toBeDefined();
      }
    }
  });

  it('moduleStatus extends a Module with installed flags', () => {
    const mod = BUILTIN_MODULES[0]!;
    const status = moduleStatusSchema.parse({
      ...mod,
      installedEntityTypes: ['Person'],
      installedClaimPredicates: [],
      fullyInstalled: false,
    });
    expect(status.installedEntityTypes).toEqual(['Person']);
  });
});

describe('install schemas', () => {
  it('validates an install request', () => {
    expect(installModuleSchema.parse({ moduleId: 'personal-relationship' }).moduleId).toBe(
      'personal-relationship',
    );
    expect(installModuleSchema.safeParse({}).success).toBe(false);
  });

  it('validates an install result', () => {
    const result = installModuleResultSchema.parse({
      moduleId: 'personal-relationship',
      items: [
        { kind: 'entity_type', name: 'Person', status: 'installed' },
        { kind: 'claim_predicate', name: 'attended', status: 'skipped', reason: 'already exists' },
        { kind: 'rule_pack', name: 'event-participation', status: 'installed' },
      ],
    });
    expect(result.items).toHaveLength(3);
  });

  it('findBuiltinModule returns undefined for unknown ids', () => {
    expect(findBuiltinModule('nope')).toBeUndefined();
  });
});
