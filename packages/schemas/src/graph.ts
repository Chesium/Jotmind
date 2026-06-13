import { z } from 'zod';

/**
 * Canonical graph data model (US-005). The relational PostgreSQL tables are the
 * source of truth; Apache AGE is a derived projection (US-006). These Zod
 * schemas describe the shared shapes and provide the **validation hooks** that
 * gate JSONB custom properties before they are written.
 */

/**
 * Built-in entity types available without defining a custom schema (US-008).
 * Custom entity types (US-027) are stored as additional `schema_definitions`.
 */
export const BUILTIN_ENTITY_TYPES = ['Person', 'Event', 'Concept', 'Place', 'Character'] as const;
export type BuiltinEntityType = (typeof BUILTIN_ENTITY_TYPES)[number];

/** Kinds of schema definition: an entity type or a claim predicate. */
export const SCHEMA_DEFINITION_KINDS = ['entity_type', 'claim_predicate'] as const;
export const schemaDefinitionKindSchema = z.enum(SCHEMA_DEFINITION_KINDS);
export type SchemaDefinitionKind = z.infer<typeof schemaDefinitionKindSchema>;

/** Lifecycle status of a proposal in the AI/import review queue (US-018). */
export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'dismissed'] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

/** Lifecycle status of an inference rule (US-023/US-024). */
export const RULE_STATUSES = ['draft', 'enabled', 'disabled'] as const;
export const ruleStatusSchema = z.enum(RULE_STATUSES);
export type RuleStatus = z.infer<typeof ruleStatusSchema>;

/** Status of a durable job (US-007). */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Projection state of a `graph_outbox` event (US-006). */
export const OUTBOX_STATUSES = ['pending', 'processed', 'failed'] as const;
export const outboxStatusSchema = z.enum(OUTBOX_STATUSES);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;

// ---------------------------------------------------------------------------
// Custom-property validation hooks (US-005 AC3)
//
// Custom properties live in JSONB columns (`entities.properties`,
// `claims.properties`, ...). A schema version carries a `propertySchema` that
// describes the allowed/required fields. `validateCustomProperties` is the hook
// that callers run before writing canonical records; US-027 surfaces it in the
// custom-schema UI/API. The shape is intentionally small (a flat field map);
// richer JSON-Schema support can be layered on later without changing callers.
// ---------------------------------------------------------------------------

/** Allowed primitive types for a custom property field. */
export const PROPERTY_FIELD_TYPES = ['string', 'number', 'boolean', 'date'] as const;
export const propertyFieldTypeSchema = z.enum(PROPERTY_FIELD_TYPES);
export type PropertyFieldType = z.infer<typeof propertyFieldTypeSchema>;

/** Definition of a single custom property field. */
export const propertyFieldSchema = z.object({
  type: propertyFieldTypeSchema,
  required: z.boolean().optional(),
  description: z.string().optional(),
});
export type PropertyField = z.infer<typeof propertyFieldSchema>;

/**
 * A property schema is a flat map of field name → field definition. Stored in
 * `schema_versions.property_schema` and used to validate JSONB custom
 * properties. An empty schema accepts any properties.
 */
export const propertySchemaSchema = z.record(propertyFieldSchema);
export type PropertySchema = z.infer<typeof propertySchemaSchema>;

/** A single validation problem found in a custom-properties payload. */
export interface PropertyValidationIssue {
  field: string;
  message: string;
}

/** Result of validating custom properties against a property schema. */
export interface PropertyValidationResult {
  valid: boolean;
  issues: PropertyValidationIssue[];
}

function matchesFieldType(value: unknown, type: PropertyFieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      // Accept ISO-8601 date/datetime strings.
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }
}

/**
 * Validation hook for JSONB custom properties (US-005 AC3). Validates a
 * `properties` payload against a `propertySchema`:
 *   - required fields must be present and non-null,
 *   - present fields must match their declared type,
 *   - unknown fields not in the schema are reported as issues.
 * An empty schema accepts any payload. Returns all issues rather than throwing
 * so callers can surface them in forms/APIs.
 */
export function validateCustomProperties(
  propertySchema: PropertySchema,
  properties: Record<string, unknown>,
): PropertyValidationResult {
  const issues: PropertyValidationIssue[] = [];
  const fields = Object.keys(propertySchema);

  for (const field of fields) {
    const def = propertySchema[field];
    if (!def) continue;
    const value = properties[field];
    const present = value !== undefined && value !== null;

    if (!present) {
      if (def.required) {
        issues.push({ field, message: `"${field}" is required` });
      }
      continue;
    }

    if (!matchesFieldType(value, def.type)) {
      issues.push({ field, message: `"${field}" must be a ${def.type}` });
    }
  }

  if (fields.length > 0) {
    for (const key of Object.keys(properties)) {
      if (!(key in propertySchema)) {
        issues.push({ field: key, message: `"${key}" is not allowed by the schema` });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
