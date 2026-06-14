import { z } from 'zod';
import { ruleStatusSchema } from './graph.js';

/**
 * Built-in rule packs (US-022). Showcase Modules ship versioned, installable
 * bundles of restricted Datalog-like inference rules so reasoning is useful
 * without authoring rules from scratch (US-023 adds custom authoring; US-024
 * runs them). Installing a pack creates `rule_definitions` rows inside a
 * Knowledge Base; rules install disabled and are auditable when enabled/disabled.
 *
 * `ruleStatusSchema` / `RULE_STATUSES` are defined in `graph.js` (US-005).
 */

/**
 * Public shape of an installed rule definition. `moduleId`/`packId` are present
 * for rules installed from a built-in pack (null for hand-authored rules from
 * US-023).
 */
export const ruleDefinitionSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  ruleText: z.string(),
  status: ruleStatusSchema,
  version: z.number().int().positive(),
  moduleId: z.string().nullable(),
  packId: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

export const ruleDefinitionListSchema = z.array(ruleDefinitionSchema);

/** A single built-in rule within a pack. */
export const builtinRuleSchema = z.object({
  /** Stable key within the pack (used for install idempotency). */
  key: z.string().min(1),
  /** Conceptual rule name -> `rule_definitions.name`. */
  name: z.string().min(1),
  description: z.string().min(1),
  /** Canonical Prolog-like rule text (parsed/compiled in US-023/024). */
  ruleText: z.string().min(1),
});
export type BuiltinRule = z.infer<typeof builtinRuleSchema>;

/** A versioned, installable bundle of related rules. */
export const builtinRulePackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.number().int().positive(),
  /** Inference category, e.g. `event-participation`, `family-relationship`. */
  category: z.string().min(1),
  rules: z.array(builtinRuleSchema).min(1),
});
export type BuiltinRulePack = z.infer<typeof builtinRulePackSchema>;

/** A built-in Module bundle grouping one or more rule packs (US-022). */
export const builtinRuleModuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  packs: z.array(builtinRulePackSchema).min(1),
});
export type BuiltinRuleModule = z.infer<typeof builtinRuleModuleSchema>;

export const builtinRuleModuleListSchema = z.array(builtinRuleModuleSchema);

/**
 * The catalog of built-in showcase Modules and their rule packs. Read-only
 * static content shared by API and web. Each Module bundles at least one
 * inference rule pack (US-022 AC1/AC2).
 */
export const BUILTIN_RULE_MODULES: readonly BuiltinRuleModule[] = [
  {
    id: 'personal-relationship',
    name: 'Personal Relationship',
    description:
      'Social context for people, events, and groups. Infers acquaintance and shared-group relationships from event-participation claims.',
    packs: [
      {
        id: 'event-participation',
        name: 'Event Participation',
        description:
          'Infers social connections from people attending the same events or belonging to the same groups.',
        version: 1,
        category: 'event-participation',
        rules: [
          {
            key: 'acquainted-via-event',
            name: 'acquainted_via_event',
            description: 'Two people who attended the same event are inferred to be acquainted.',
            ruleText:
              'acquainted(?a, ?b) <- claim(?e1, "attended"), arg(?e1, "person", ?a), arg(?e1, "event", ?ev), claim(?e2, "attended"), arg(?e2, "person", ?b), arg(?e2, "event", ?ev).',
          },
          {
            key: 'co-member-via-group',
            name: 'co_member_via_group',
            description:
              'Two people who belong to the same social group are inferred to be co-members.',
            ruleText:
              'co_member(?a, ?b) <- claim(?m1, "member_of"), arg(?m1, "person", ?a), arg(?m1, "group", ?g), claim(?m2, "member_of"), arg(?m2, "person", ?b), arg(?m2, "group", ?g).',
          },
        ],
      },
    ],
  },
  {
    id: 'reading-character-map',
    name: 'Reading / Character Map',
    description:
      'Track characters, relationships, and plot events. Infers family relationships from parentage claims for character maps.',
    packs: [
      {
        id: 'family-relationship',
        name: 'Family Relationships',
        description:
          'Infers sibling and grandparent relationships from parent-of claims between characters.',
        version: 1,
        category: 'family-relationship',
        rules: [
          {
            key: 'sibling-via-parent',
            name: 'sibling',
            description: 'Two characters who share a parent are inferred to be siblings.',
            ruleText:
              'sibling(?a, ?b) <- claim(?c1, "parent_of"), arg(?c1, "parent", ?p), arg(?c1, "child", ?a), claim(?c2, "parent_of"), arg(?c2, "parent", ?p), arg(?c2, "child", ?b).',
          },
          {
            key: 'grandparent-via-parent',
            name: 'grandparent',
            description: 'A parent of a parent is inferred to be a grandparent.',
            ruleText:
              'grandparent(?g, ?c) <- claim(?p1, "parent_of"), arg(?p1, "parent", ?g), arg(?p1, "child", ?x), claim(?p2, "parent_of"), arg(?p2, "parent", ?x), arg(?p2, "child", ?c).',
          },
        ],
      },
    ],
  },
];

/** Look up a built-in pack by Module + pack id. */
export function findBuiltinRulePack(
  moduleId: string,
  packId: string,
): { module: BuiltinRuleModule; pack: BuiltinRulePack } | undefined {
  const module = BUILTIN_RULE_MODULES.find((m) => m.id === moduleId);
  if (!module) return undefined;
  const pack = module.packs.find((p) => p.id === packId);
  if (!pack) return undefined;
  return { module, pack };
}

/** Request body to install a built-in rule pack into a Knowledge Base. */
export const installRulePackSchema = z.object({
  moduleId: z.string().min(1),
  packId: z.string().min(1),
});
export type InstallRulePackRequest = z.infer<typeof installRulePackSchema>;

/** Request body to enable/disable an installed rule (auditable, AC4). */
export const updateRuleStatusSchema = z.object({
  status: z.enum(['enabled', 'disabled']),
});
export type UpdateRuleStatusRequest = z.infer<typeof updateRuleStatusSchema>;

/** A rule from a pack that was not installed (already present). */
export const skippedRuleSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  reason: z.string(),
});
export type SkippedRule = z.infer<typeof skippedRuleSchema>;

/** Result of installing a rule pack: newly created rows + skipped duplicates. */
export const installRulePackResultSchema = z.object({
  installed: ruleDefinitionListSchema,
  skipped: z.array(skippedRuleSchema),
});
export type InstallRulePackResult = z.infer<typeof installRulePackResultSchema>;
