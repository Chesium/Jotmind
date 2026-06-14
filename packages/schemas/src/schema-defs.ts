import { z } from 'zod';
import {
  propertySchemaSchema,
  schemaDefinitionKindSchema,
  type PropertySchema,
  type SchemaDefinitionKind,
  validateCustomProperties,
} from './graph.js';

// ---------------------------------------------------------------------------
// Custom schema definitions (US-027)
//
// An advanced user can define custom *entity types* (e.g. "Person") and *claim
// predicates* (e.g. "knows") so JotMind can adapt to new domains. A schema
// definition is the stable conceptual type (its `name`); concrete validation
// rules live in a versioned `schemaVersion`. Entity types carry a flat
// `propertySchema` (validated against JSONB custom properties); claim predicates
// carry a `spec` describing allowed argument roles + compatible entity types.
//
// Definitions are Knowledge Base scoped and round-trip through the portable JSON
// export. Stored graph records reference the `schemaVersionId` they validated
// against (US-027 AC5); breaking schema evolution is US-028.
// ---------------------------------------------------------------------------

// `SCHEMA_DEFINITION_KINDS` / `schemaDefinitionKindSchema` / `SchemaDefinitionKind`
// are defined in graph.js (US-005); reuse them here.

/**
 * One allowed argument role of a claim predicate (US-027 AC2). `entityTypes`
 * (when non-empty) restricts which conceptual entity types may fill the role;
 * an empty/absent list accepts any entity type. `allowLiteral` permits a literal
 * (non-entity) argument for the role.
 */
export const schemaArgumentRoleSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional(),
  entityTypes: z.array(z.string().min(1)).optional(),
  allowLiteral: z.boolean().optional(),
});
export type SchemaArgumentRole = z.infer<typeof schemaArgumentRoleSchema>;

/** The `spec` of a claim-predicate schema version: its allowed argument roles. */
export const predicateSpecSchema = z.object({
  argumentRoles: z.array(schemaArgumentRoleSchema).default([]),
});
export type PredicateSpec = z.infer<typeof predicateSpecSchema>;

/** A concrete, versioned schema (the validation rules for a definition). */
export const schemaVersionSchema = z.object({
  id: z.string(),
  schemaDefinitionId: z.string(),
  knowledgeBaseId: z.string(),
  version: z.number().int().positive(),
  propertySchema: propertySchemaSchema,
  spec: z.record(z.unknown()),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SchemaVersion = z.infer<typeof schemaVersionSchema>;

/** A custom schema definition together with its currently active version. */
export const schemaDefinitionSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  kind: schemaDefinitionKindSchema,
  name: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeVersion: schemaVersionSchema.nullable(),
});
export type SchemaDefinition = z.infer<typeof schemaDefinitionSchema>;

export const schemaDefinitionListSchema = z.array(schemaDefinitionSchema);

/**
 * Create a custom schema definition + its initial (v1, active) version. Supply
 * `propertySchema` for an entity type and/or `spec` for a claim predicate; both
 * default to empty (no constraints). `name` is the stable conceptual type used
 * across versions for cross-version search/reasoning (US-028).
 */
export const createSchemaDefinitionSchema = z.object({
  kind: schemaDefinitionKindSchema,
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  propertySchema: propertySchemaSchema.optional(),
  spec: predicateSpecSchema.optional(),
});
export type CreateSchemaDefinition = z.infer<typeof createSchemaDefinitionSchema>;

/** Portable JSON export of a Knowledge Base's custom schemas (US-027 AC4). */
export const schemaExportSchema = z.object({
  knowledgeBaseId: z.string(),
  exportedAt: z.string(),
  schemaDefinitions: schemaDefinitionListSchema,
});
export type SchemaExport = z.infer<typeof schemaExportSchema>;

// ---------------------------------------------------------------------------
// Validation hooks (US-027 AC3) — shared so the API (save gating) and web
// (live preview) run the SAME logic, mirroring validateCustomProperties.
// ---------------------------------------------------------------------------

/** A claim argument as seen by predicate validation (with its entity type). */
export interface ClaimArgumentForValidation {
  role: string;
  argumentKind: 'entity' | 'literal';
  /** The conceptual type of the referenced entity (entity args only). */
  entityType?: string | null;
}

export interface SchemaValidationIssue {
  field: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaValidationIssue[];
}

/**
 * Validate a claim's arguments against a claim-predicate `spec` (US-027 AC2/AC3):
 *   - every `required` role must be present,
 *   - a literal argument is only allowed for a role that sets `allowLiteral`,
 *   - an entity argument's type must be in the role's `entityTypes` (when the
 *     role restricts types),
 *   - arguments whose role is not declared by the spec are reported.
 * An empty `argumentRoles` accepts any arguments. Returns all issues so callers
 * can surface them in forms/APIs.
 */
export function validatePredicateArguments(
  spec: PredicateSpec,
  args: ClaimArgumentForValidation[],
): SchemaValidationResult {
  const issues: SchemaValidationIssue[] = [];
  const roles = spec.argumentRoles ?? [];
  if (roles.length === 0) return { valid: true, issues };

  const roleByName = new Map(roles.map((r) => [r.name, r]));

  for (const role of roles) {
    if (role.required && !args.some((a) => a.role === role.name)) {
      issues.push({ field: role.name, message: `Argument role "${role.name}" is required` });
    }
  }

  for (const arg of args) {
    const role = roleByName.get(arg.role);
    if (!role) {
      issues.push({ field: arg.role, message: `Argument role "${arg.role}" is not allowed` });
      continue;
    }
    if (arg.argumentKind === 'literal') {
      if (!role.allowLiteral) {
        issues.push({
          field: arg.role,
          message: `Argument role "${arg.role}" does not allow a literal value`,
        });
      }
      continue;
    }
    // Entity argument: check compatible entity types if the role restricts them.
    if (role.entityTypes && role.entityTypes.length > 0) {
      if (!arg.entityType || !role.entityTypes.includes(arg.entityType)) {
        issues.push({
          field: arg.role,
          message: `Argument role "${arg.role}" must reference one of: ${role.entityTypes.join(', ')}`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Re-export so callers validating an entity type use the same entry point. */
export function validateEntityProperties(
  propertySchema: PropertySchema,
  properties: Record<string, unknown>,
): SchemaValidationResult {
  const result = validateCustomProperties(propertySchema, properties);
  return { valid: result.valid, issues: result.issues };
}

// ---------------------------------------------------------------------------
// Schema version evolution (US-028)
//
// Editing a schema is classified as either a *compatible* change (update
// labels/descriptions or LOOSEN validation — applied in place to the active
// version, existing data untouched, AC1) or a *breaking* change (TIGHTEN
// validation — creates and activates a new schema version so existing data can
// remain valid under its referenced old version, AC2/AC3). Cross-version search
// and reasoning key off the conceptual string `name`/predicate, not
// `schemaVersionId` (AC4), and JSONB fields absent from older versions are
// treated as `null` rather than throwing (AC5). Validation warnings for
// old/mismatched data are surfaced via the validation report (AC6).
// ---------------------------------------------------------------------------

export const SCHEMA_CHANGE_TYPES = ['compatible', 'breaking'] as const;
export const schemaChangeTypeSchema = z.enum(SCHEMA_CHANGE_TYPES);
export type SchemaChangeType = z.infer<typeof schemaChangeTypeSchema>;

/** Classification of a proposed schema edit (US-028). */
export const schemaChangeClassificationSchema = z.object({
  changeType: schemaChangeTypeSchema,
  /** Human-readable reasons describing the notable changes. */
  reasons: z.array(z.string()),
});
export type SchemaChangeClassification = z.infer<typeof schemaChangeClassificationSchema>;

/**
 * Update a schema definition (US-028). Supply any subset:
 *   - `displayName` / `description`: metadata only (always compatible),
 *   - `propertySchema` (entity types) and/or `spec` (claim predicates): new
 *     validation rules — classified compatible (loosen) vs breaking (tighten).
 * At least one field must be present.
 */
export const updateSchemaDefinitionSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    propertySchema: propertySchemaSchema.optional(),
    spec: predicateSpecSchema.optional(),
  })
  .refine(
    (d) =>
      d.displayName !== undefined ||
      d.description !== undefined ||
      d.propertySchema !== undefined ||
      d.spec !== undefined,
    { message: 'No changes supplied' },
  );
export type UpdateSchemaDefinition = z.infer<typeof updateSchemaDefinitionSchema>;

/** Result of an update: the new definition state + how the change was classified. */
export const updateSchemaResultSchema = schemaChangeClassificationSchema.extend({
  definition: schemaDefinitionSchema,
});
export type UpdateSchemaResult = z.infer<typeof updateSchemaResultSchema>;

/**
 * Classify a change to an entity-type `propertySchema` (US-028). Loosening is
 * compatible (existing data stays valid); tightening is breaking.
 *   - BREAKING: adding a required field, making a field required, changing a
 *     field's type, or removing a field (existing records may carry it).
 *   - COMPATIBLE: adding an optional field, making a field optional, or no
 *     validation change.
 */
export function classifyPropertySchemaChange(
  current: PropertySchema,
  next: PropertySchema,
): SchemaChangeClassification {
  const breaking: string[] = [];
  const compatible: string[] = [];

  for (const name of Object.keys(next)) {
    if (!(name in current)) {
      if (next[name]?.required) breaking.push(`Added required field "${name}"`);
      else compatible.push(`Added optional field "${name}"`);
    }
  }
  for (const name of Object.keys(current)) {
    const c = current[name];
    const n = next[name];
    if (!n) {
      breaking.push(`Removed field "${name}"`);
      continue;
    }
    if (c && c.type !== n.type) breaking.push(`Changed type of "${name}" (${c.type} → ${n.type})`);
    if (c && !c.required && n.required) breaking.push(`Made field "${name}" required`);
    if (c && c.required && !n.required) compatible.push(`Made field "${name}" optional`);
  }

  return breaking.length > 0
    ? { changeType: 'breaking', reasons: breaking }
    : { changeType: 'compatible', reasons: compatible };
}

/**
 * Classify a change to a claim-predicate `spec` (US-028).
 *   - BREAKING: adding a required role, making a role required, removing a role,
 *     narrowing a role's allowed entity types, or disallowing a previously
 *     allowed literal.
 *   - COMPATIBLE: adding an optional role, making a role optional, widening
 *     allowed entity types, or newly allowing a literal.
 */
export function classifyPredicateSpecChange(
  current: PredicateSpec,
  next: PredicateSpec,
): SchemaChangeClassification {
  const breaking: string[] = [];
  const compatible: string[] = [];
  const currentRoles = new Map((current.argumentRoles ?? []).map((r) => [r.name, r]));
  const nextRoles = new Map((next.argumentRoles ?? []).map((r) => [r.name, r]));

  for (const [name, role] of nextRoles) {
    if (!currentRoles.has(name)) {
      if (role.required) breaking.push(`Added required role "${name}"`);
      else compatible.push(`Added optional role "${name}"`);
    }
  }
  for (const [name, c] of currentRoles) {
    const n = nextRoles.get(name);
    if (!n) {
      breaking.push(`Removed role "${name}"`);
      continue;
    }
    if (!c.required && n.required) breaking.push(`Made role "${name}" required`);
    if (c.required && !n.required) compatible.push(`Made role "${name}" optional`);

    const cTypes = c.entityTypes ?? [];
    const nTypes = n.entityTypes ?? [];
    if (nTypes.length === 0) {
      if (cTypes.length > 0) compatible.push(`Allowed any entity type for role "${name}"`);
    } else if (cTypes.length === 0) {
      breaking.push(`Restricted entity types for role "${name}"`);
    } else {
      const removed = cTypes.filter((t) => !nTypes.includes(t));
      const added = nTypes.filter((t) => !cTypes.includes(t));
      if (removed.length > 0) breaking.push(`Removed entity types for role "${name}"`);
      else if (added.length > 0) compatible.push(`Added entity types for role "${name}"`);
    }

    const cLit = Boolean(c.allowLiteral);
    const nLit = Boolean(n.allowLiteral);
    if (cLit && !nLit) breaking.push(`Disallowed literal value for role "${name}"`);
    if (!cLit && nLit) compatible.push(`Allowed literal value for role "${name}"`);
  }

  return breaking.length > 0
    ? { changeType: 'breaking', reasons: breaking }
    : { changeType: 'compatible', reasons: compatible };
}

/** Classify a schema edit by kind (US-028). */
export function classifySchemaChange(
  kind: SchemaDefinitionKind,
  current: { propertySchema: PropertySchema; spec: PredicateSpec },
  next: { propertySchema: PropertySchema; spec: PredicateSpec },
): SchemaChangeClassification {
  return kind === 'entity_type'
    ? classifyPropertySchemaChange(current.propertySchema, next.propertySchema)
    : classifyPredicateSpecChange(current.spec, next.spec);
}

// ---------------------------------------------------------------------------
// Validation report (US-028 AC6) — surface old/mismatched data.
// ---------------------------------------------------------------------------

/** One existing record that does not validate against the active schema version. */
export const schemaRecordWarningSchema = z.object({
  recordId: z.string(),
  label: z.string(),
  /** The schema version the record was stamped with (null = none/unconstrained). */
  schemaVersionId: z.string().nullable(),
  /** Whether the record references the currently active version. */
  onActiveVersion: z.boolean(),
  issues: z.array(z.object({ field: z.string(), message: z.string() })),
});
export type SchemaRecordWarning = z.infer<typeof schemaRecordWarningSchema>;

/** Validation report for a schema definition over its existing records (US-028 AC6). */
export const schemaValidationReportSchema = z.object({
  definitionId: z.string(),
  kind: schemaDefinitionKindSchema,
  name: z.string(),
  activeVersionId: z.string().nullable(),
  totalRecords: z.number().int().nonnegative(),
  invalidRecords: z.number().int().nonnegative(),
  onOldVersionRecords: z.number().int().nonnegative(),
  warnings: z.array(schemaRecordWarningSchema),
});
export type SchemaValidationReport = z.infer<typeof schemaValidationReportSchema>;
