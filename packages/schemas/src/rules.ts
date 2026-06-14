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
  /** Whether the rule text parses/validates (US-023). Invalid rules cannot be enabled. */
  valid: z.boolean(),
  /** Human-readable validation errors (empty when `valid`). */
  validationErrors: z.array(z.string()),
  /** Configurable bounded-recursion depth/iteration cap (US-023 AC8). */
  recursionCap: z.number().int().positive(),
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

// ---------------------------------------------------------------------------
// US-023: restricted Datalog-like rule authoring — parser, compiler, validator
// ---------------------------------------------------------------------------
//
// Rules are a tiny, *restricted* Datalog dialect parsed into a structured AST.
// They are NEVER eval'd as code: there is no filesystem, network, process,
// arbitrary JavaScript, or provider-API access (AC7) — the parser only ever
// produces data. Execution (US-024) walks the AST against stored Knowledge Base
// data with bounded iteration.
//
// Canonical text syntax (AC1):
//   knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).
//
// Low-level/built-in predicates (AC2):
//   entity(?id, ?type, ?name)   — an entity row
//   claim(?id, ?predicate)      — a claim row
//   arg(?claimId, ?role, ?entityId) — a role-labelled claim argument

/** Built-in low-level predicates and their fixed arity (US-023 AC2). */
export const RULE_BUILTIN_PREDICATES: Readonly<Record<string, number>> = {
  entity: 3,
  claim: 2,
  arg: 3,
};

/** Bounded-recursion depth/iteration cap bounds (US-023 AC8). */
export const RULE_RECURSION_CAP_MIN = 1;
export const RULE_RECURSION_CAP_MAX = 64;
export const RULE_RECURSION_CAP_DEFAULT = 16;

export function clampRecursionCap(cap: number | undefined): number {
  if (cap === undefined || !Number.isInteger(cap)) return RULE_RECURSION_CAP_DEFAULT;
  return Math.min(RULE_RECURSION_CAP_MAX, Math.max(RULE_RECURSION_CAP_MIN, cap));
}

/** A term is either an explicit `?variable` or a quoted string literal (AC1). */
export const ruleTermSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('var'), name: z.string().min(1) }),
  z.object({ kind: z.literal('literal'), value: z.string() }),
]);
export type RuleTerm = z.infer<typeof ruleTermSchema>;

export const ruleAtomSchema = z.object({
  predicate: z.string().min(1),
  args: z.array(ruleTermSchema),
});
export type RuleAtom = z.infer<typeof ruleAtomSchema>;

export const ruleBodyAtomSchema = ruleAtomSchema.extend({ negated: z.boolean() });
export type RuleBodyAtom = z.infer<typeof ruleBodyAtomSchema>;

/** Compiled rule AST stored in `rule_definitions.compiled` for execution (US-024). */
export const compiledRuleSchema = z.object({
  head: ruleAtomSchema,
  body: z.array(ruleBodyAtomSchema),
  /** True when the body references the head predicate (direct recursion). */
  recursive: z.boolean(),
  /** Effective bounded depth/iteration cap (AC8). */
  recursionCap: z.number().int().positive(),
});
export type CompiledRule = z.infer<typeof compiledRuleSchema>;

export interface RuleParseResult {
  valid: boolean;
  errors: string[];
  recursive: boolean;
  recursionCap: number;
  rule: CompiledRule | null;
}

type TokKind = 'ident' | 'var' | 'string' | 'lparen' | 'rparen' | 'comma' | 'arrow' | 'dot' | 'not';
interface Tok {
  kind: TokKind;
  value: string;
  pos: number;
}

const DISALLOWED_KEYWORDS = new Set(['exists', 'forall', 'some', 'any', 'there']);

function tokenize(input: string): { tokens: Tok[]; errors: string[] } {
  const tokens: Tok[] = [];
  const errors: string[] = [];
  const isIdentStart = (c: string) => /[A-Za-z]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma', value: c, pos: i });
      i++;
      continue;
    }
    if (c === '.') {
      tokens.push({ kind: 'dot', value: c, pos: i });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ kind: 'not', value: '!', pos: i });
      i++;
      continue;
    }
    if (c === '<' && input[i + 1] === '-') {
      tokens.push({ kind: 'arrow', value: '<-', pos: i });
      i += 2;
      continue;
    }
    if (c === ':' && input[i + 1] === '-') {
      tokens.push({ kind: 'arrow', value: ':-', pos: i });
      i += 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < n) {
        const ch = input[j] as string;
        if (ch === '\\' && j + 1 < n) {
          val += input[j + 1];
          j += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          break;
        }
        val += ch;
        j++;
      }
      if (!closed) {
        errors.push('Unterminated string literal');
        break;
      }
      tokens.push({ kind: 'string', value: val, pos: i });
      i = j + 1;
      continue;
    }
    if (c === '?') {
      let j = i + 1;
      let name = '';
      while (j < n && isIdentPart(input[j] as string)) {
        name += input[j];
        j++;
      }
      if (name === '') {
        errors.push(`Invalid variable at position ${i}`);
      } else if (name === '_' || name.startsWith('_')) {
        // anonymous / existential / blank-node-style variable (AC4)
        errors.push(`Anonymous or blank-node variable "?${name}" is not allowed`);
      } else {
        tokens.push({ kind: 'var', value: name, pos: i });
      }
      i = j;
      continue;
    }
    if (c === '_') {
      // blank node (_:label) or anonymous identifier (AC4)
      let j = i + 1;
      let rest = '';
      while (j < n && (isIdentPart(input[j] as string) || input[j] === ':')) {
        rest += input[j];
        j++;
      }
      errors.push(`Blank nodes / anonymous identifiers ("_${rest}") are not allowed`);
      i = j;
      continue;
    }
    if (c === '\u2203' || c === '\u2200') {
      errors.push(`Quantifier "${c}" is not allowed`);
      i++;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      let name = '';
      while (j < n && isIdentPart(input[j] as string)) {
        name += input[j];
        j++;
      }
      const lower = name.toLowerCase();
      if (lower === 'not') {
        tokens.push({ kind: 'not', value: 'not', pos: i });
      } else if (DISALLOWED_KEYWORDS.has(lower)) {
        errors.push(`Existential/quantifier token "${name}" is not allowed`);
      } else {
        tokens.push({ kind: 'ident', value: name, pos: i });
      }
      i = j;
      continue;
    }
    errors.push(`Unexpected character "${c}" at position ${i}`);
    i++;
  }
  return { tokens, errors };
}

/**
 * Parse + validate a restricted Datalog-like rule (US-023). Returns the
 * compiled AST plus any validation errors. Validation enforces:
 *  - syntax (AC1) and built-in predicate arity (AC2)
 *  - range-restriction safety: every head variable appears in a positive,
 *    non-negated body atom (AC3); negated-atom variables must also be bound by a
 *    positive atom (restricted negation, AC7)
 *  - rejection of existential tokens, skolem/function terms, and blank nodes,
 *    and of heads that would introduce entities not present in the body (AC4)
 *  - bounded recursion only (built-in predicates or the rule's own head), with a
 *    configurable cap (AC8)
 *
 * It NEVER executes anything — it only produces data (AC7).
 */
export function parseRule(text: string, opts?: { recursionCap?: number }): RuleParseResult {
  const errors: string[] = [];
  const recursionCap = clampRecursionCap(opts?.recursionCap);
  if (
    opts?.recursionCap !== undefined &&
    (!Number.isInteger(opts.recursionCap) ||
      opts.recursionCap < RULE_RECURSION_CAP_MIN ||
      opts.recursionCap > RULE_RECURSION_CAP_MAX)
  ) {
    errors.push(
      `recursionCap must be an integer between ${RULE_RECURSION_CAP_MIN} and ${RULE_RECURSION_CAP_MAX}`,
    );
  }

  const { tokens, errors: lexErrors } = tokenize(text);
  errors.push(...lexErrors);

  let pos = 0;
  const peek = (): Tok | undefined => tokens[pos];
  const advance = (): Tok | undefined => tokens[pos++];

  function parseAtom(allowNot: boolean): RuleBodyAtom | null {
    let negated = false;
    if (allowNot && peek()?.kind === 'not') {
      negated = true;
      advance();
    }
    const nameTok = peek();
    if (!nameTok || nameTok.kind !== 'ident') {
      errors.push('Expected a predicate name');
      return null;
    }
    advance();
    const predicate = nameTok.value;
    if (peek()?.kind !== 'lparen') {
      errors.push(`Expected "(" after predicate "${predicate}"`);
      return null;
    }
    advance();
    const args: RuleTerm[] = [];
    if (peek()?.kind !== 'rparen') {
      for (;;) {
        const t = peek();
        if (!t) {
          errors.push('Unexpected end of rule in argument list');
          return null;
        }
        if (t.kind === 'var') {
          args.push({ kind: 'var', name: t.value });
          advance();
        } else if (t.kind === 'string') {
          args.push({ kind: 'literal', value: t.value });
          advance();
        } else if (t.kind === 'ident') {
          if (tokens[pos + 1]?.kind === 'lparen') {
            errors.push(`Skolem/function terms are not allowed ("${t.value}(...)")`);
            advance();
            // skip the balanced parenthesised group to recover
            advance();
            let depth = 1;
            while (depth > 0 && peek()) {
              const x = advance();
              if (x?.kind === 'lparen') depth++;
              else if (x?.kind === 'rparen') depth--;
            }
          } else {
            errors.push(
              `Bare constant "${t.value}" is not allowed; use a quoted "string" or a ?variable`,
            );
            advance();
          }
        } else {
          errors.push('Invalid term in argument list');
          return null;
        }
        if (peek()?.kind === 'comma') {
          advance();
          continue;
        }
        break;
      }
    }
    if (peek()?.kind !== 'rparen') {
      errors.push(`Expected ")" to close "${predicate}"`);
      return null;
    }
    advance();
    return { predicate, args, negated };
  }

  const head = parseAtom(false);
  if (head?.negated) errors.push('The rule head cannot be negated');

  if (peek()?.kind !== 'arrow') {
    errors.push('Expected "<-" between the head and body');
  } else {
    advance();
  }

  const body: RuleBodyAtom[] = [];
  if (peek() && peek()?.kind !== 'dot') {
    for (;;) {
      const atom = parseAtom(true);
      if (atom) body.push(atom);
      else break;
      if (peek()?.kind === 'comma') {
        advance();
        continue;
      }
      break;
    }
  }

  if (peek()?.kind === 'dot') {
    advance();
  } else {
    errors.push('A rule must end with "."');
  }
  if (pos < tokens.length) errors.push('Unexpected tokens after the end of the rule');

  let recursive = false;

  if (head) {
    if (Object.prototype.hasOwnProperty.call(RULE_BUILTIN_PREDICATES, head.predicate)) {
      errors.push(`Cannot redefine the built-in predicate "${head.predicate}" in a rule head`);
    }
    if (body.length === 0) {
      errors.push('The rule body cannot be empty (a head must be derived from body atoms)');
    }

    const headArity = head.args.length;
    for (const atom of body) {
      const builtinArity = RULE_BUILTIN_PREDICATES[atom.predicate];
      if (builtinArity !== undefined) {
        if (atom.args.length !== builtinArity) {
          errors.push(
            `Built-in predicate "${atom.predicate}" takes ${builtinArity} arguments, got ${atom.args.length}`,
          );
        }
      } else if (atom.predicate === head.predicate) {
        recursive = true;
        if (atom.args.length !== headArity) {
          errors.push(
            `Recursive use of "${atom.predicate}" must take ${headArity} arguments, got ${atom.args.length}`,
          );
        }
      } else {
        errors.push(
          `Unknown predicate "${atom.predicate}"; body atoms must use entity/claim/arg or the rule's own head predicate (bounded recursion)`,
        );
      }
    }

    // Range-restriction safety (AC3): head vars must appear in a positive atom.
    const positiveVars = new Set<string>();
    for (const atom of body) {
      if (atom.negated) continue;
      for (const term of atom.args) if (term.kind === 'var') positiveVars.add(term.name);
    }
    for (const term of head.args) {
      if (term.kind === 'var' && !positiveVars.has(term.name)) {
        errors.push(
          `Unsafe rule: head variable "?${term.name}" must appear in a positive body atom (range restriction)`,
        );
      }
    }
    // Restricted negation (AC7): negated-atom vars must be bound by a positive atom.
    for (const atom of body) {
      if (!atom.negated) continue;
      for (const term of atom.args) {
        if (term.kind === 'var' && !positiveVars.has(term.name)) {
          errors.push(
            `Unsafe negation: variable "?${term.name}" in "not ${atom.predicate}(...)" must also appear in a positive body atom`,
          );
        }
      }
    }
  }

  const valid = errors.length === 0 && head !== null;
  const compiled: CompiledRule | null =
    valid && head
      ? { head: { predicate: head.predicate, args: head.args }, body, recursive, recursionCap }
      : null;

  return { valid, errors, recursive, recursionCap, rule: compiled };
}

/** Request body to author (create) a custom rule (US-023). */
export const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  ruleText: z.string().min(1),
  recursionCap: z.number().int().min(RULE_RECURSION_CAP_MIN).max(RULE_RECURSION_CAP_MAX).optional(),
});
export type CreateRuleRequest = z.infer<typeof createRuleSchema>;

/** Request body to edit an authored rule (US-023). At least one field required. */
export const updateRuleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    ruleText: z.string().min(1).optional(),
    recursionCap: z
      .number()
      .int()
      .min(RULE_RECURSION_CAP_MIN)
      .max(RULE_RECURSION_CAP_MAX)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateRuleRequest = z.infer<typeof updateRuleSchema>;

/** Request body to validate rule text without saving (US-023, live preview). */
export const validateRuleSchema = z.object({
  ruleText: z.string().min(1),
  recursionCap: z.number().int().min(RULE_RECURSION_CAP_MIN).max(RULE_RECURSION_CAP_MAX).optional(),
});
export type ValidateRuleRequest = z.infer<typeof validateRuleSchema>;

/** Result of validating rule text (US-023). */
export const ruleValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  recursive: z.boolean(),
  recursionCap: z.number().int().positive(),
});
export type RuleValidationResult = z.infer<typeof ruleValidationResultSchema>;
