import { z } from 'zod';
import {
  propertySchemaSchema,
  schemaDefinitionKindSchema,
  type PropertySchema,
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
