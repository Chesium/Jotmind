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

/**
 * Canonical graph record kinds whose writes emit `graph_outbox` events and are
 * projected into Apache AGE (US-006). Notes and Sources are canonical records,
 * not entity rows, so they project as their own node kinds.
 */
export const GRAPH_TARGET_TYPES = ['entity', 'claim', 'note', 'source'] as const;
export const graphTargetTypeSchema = z.enum(GRAPH_TARGET_TYPES);
export type GraphTargetType = (typeof GRAPH_TARGET_TYPES)[number];

/** Kinds of outbox event emitted by canonical writes (US-006). */
export const GRAPH_EVENT_TYPES = ['created', 'updated', 'deleted'] as const;
export const graphEventTypeSchema = z.enum(GRAPH_EVENT_TYPES);
export type GraphEventType = (typeof GRAPH_EVENT_TYPES)[number];

/**
 * Lifecycle state of the derived AGE graph projection (US-026). The rebuild/
 * repair flow moves the projection through `rebuilding` -> `synchronized`, or
 * `rebuilding` -> `failed` on error. While `rebuilding`, AGE-dependent traversal
 * views are disabled and core pages fall back to relational PostgreSQL queries.
 */
export const GRAPH_PROJECTION_STATES = ['rebuilding', 'synchronized', 'failed'] as const;
export const graphProjectionStateSchema = z.enum(GRAPH_PROJECTION_STATES);
export type GraphProjectionState = z.infer<typeof graphProjectionStateSchema>;

/**
 * Status of the graph projection pipeline (US-006/US-026). Exposed by the API so
 * the projector identity, lifecycle `state`, and outbox backlog are observable
 * (AC7 — projection lag/failure is visible). `state` reflects the rebuild/repair
 * lifecycle; `counts` reflects the outbox backlog.
 */
export const graphProjectionStatusSchema = z.object({
  state: graphProjectionStateSchema,
  projector: z.object({
    name: z.string(),
    stubbed: z.boolean(),
  }),
  counts: z.object({
    pending: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  activeKnowledgeBaseId: z.string().uuid().nullable(),
  lastJobId: z.string().uuid().nullable(),
  lastRebuildStartedAt: z.string().datetime().nullable(),
  lastSynchronizedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type GraphProjectionStatus = z.infer<typeof graphProjectionStatusSchema>;

/** Durable-job type that rebuilds/repairs the AGE projection (US-026). */
export const GRAPH_REBUILD_JOB_TYPE = 'graph.projection.rebuild';

/** Payload carried by a {@link GRAPH_REBUILD_JOB_TYPE} job. */
export const graphRebuildJobPayloadSchema = z.object({
  /** Limit the rebuild to one Knowledge Base; omit to rebuild everything. */
  knowledgeBaseId: z.string().uuid().optional(),
  requestedBy: z.string().uuid().nullable().optional(),
});
export type GraphRebuildJobPayload = z.infer<typeof graphRebuildJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Entity shapes (US-008)
//
// Entities are typed graph nodes. Editors can create the built-in types and
// edit name/aliases/description/tags/custom properties; viewers are read-only
// (enforced by KB role middleware on the API). `properties` is free-form JSONB
// until a custom schema (US-027) constrains it via `validateCustomProperties`.
// ---------------------------------------------------------------------------

/** Public shape of an entity as returned by the API. */
export const entitySchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  type: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  properties: z.record(z.unknown()),
  schemaVersionId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Entity = z.infer<typeof entitySchema>;

/** A list of entities (as returned by `GET .../entities`). */
export const entityListSchema = z.array(entitySchema);

const aliasListSchema = z.array(z.string().trim().min(1).max(500));
const tagListSchema = z.array(z.string().trim().min(1).max(200));

/** Payload to create an entity. `type` and `name` are required. */
export const createEntitySchema = z.object({
  type: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  aliases: aliasListSchema.optional(),
  description: z.string().trim().max(5000).optional(),
  tags: tagListSchema.optional(),
  properties: z.record(z.unknown()).optional(),
});
export type CreateEntity = z.infer<typeof createEntitySchema>;

/**
 * Payload to merge one entity into another (US-010). The entity identified by
 * the route (`:entityId`) is the *source* that gets archived; `targetId` is the
 * *survivor* it merges into. They must differ (enforced server-side too).
 */
export const mergeEntitySchema = z.object({
  targetId: z.string().uuid(),
});
export type MergeEntity = z.infer<typeof mergeEntitySchema>;

/**
 * A single claim affected by deleting/merging an entity (US-010). Used to
 * explain the impact of a destructive action before it is confirmed.
 */
export const entityImpactClaimSchema = z.object({
  id: z.string().uuid(),
  predicate: z.string(),
});
export type EntityImpactClaim = z.infer<typeof entityImpactClaimSchema>;

/**
 * The impact of deleting/merging an entity: the (non-deleted) claims that
 * reference it. Surfaced in delete/merge confirmations (US-010 AC2).
 */
export const entityImpactSchema = z.object({
  claims: z.array(entityImpactClaimSchema),
});
export type EntityImpact = z.infer<typeof entityImpactSchema>;

/** Payload to edit an entity. All fields optional; at least one is required. */
export const updateEntitySchema = z
  .object({
    type: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    aliases: aliasListSchema.optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    tags: tagListSchema.optional(),
    properties: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateEntity = z.infer<typeof updateEntitySchema>;

// ---------------------------------------------------------------------------
// Claim shapes (US-009)
//
// Claims are provenance-aware graph facts. They have a `predicate`, optional
// description/confidence/valid-time range, and ONE OR MORE role-labeled
// arguments — multi-argument relations are NOT reduced to binary edges. Each
// argument is either an entity reference (`argumentKind = 'entity'`) or a
// literal value (`argumentKind = 'literal'`). Editors can create and edit
// claims (including their argument roles); viewers are read-only (enforced by
// KB role middleware on the API).
// ---------------------------------------------------------------------------

/** Kind of a claim argument: an entity reference or a literal value. */
export const CLAIM_ARGUMENT_KINDS = ['entity', 'literal'] as const;
export const claimArgumentKindSchema = z.enum(CLAIM_ARGUMENT_KINDS);
export type ClaimArgumentKind = z.infer<typeof claimArgumentKindSchema>;

/** Public shape of a claim argument as returned by the API. */
export const claimArgumentSchema = z.object({
  id: z.string().uuid(),
  role: z.string(),
  position: z.number().int().nonnegative(),
  argumentKind: claimArgumentKindSchema,
  entityId: z.string().uuid().nullable(),
  value: z.unknown(),
});
export type ClaimArgument = z.infer<typeof claimArgumentSchema>;

/** Public shape of a claim (with its arguments) as returned by the API. */
export const claimSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  predicate: z.string(),
  description: z.string().nullable(),
  confidence: z.number().nullable(),
  validStart: z.string().datetime().nullable(),
  validEnd: z.string().datetime().nullable(),
  properties: z.record(z.unknown()),
  schemaVersionId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  arguments: z.array(claimArgumentSchema),
});
export type Claim = z.infer<typeof claimSchema>;

/** A list of claims (as returned by `GET .../claims`). */
export const claimListSchema = z.array(claimSchema);

/**
 * Payload to create a single claim argument. `role` is required; an `entity`
 * argument requires `entityId` (and no `value`), a `literal` argument requires
 * `value` (and no `entityId`).
 */
export const createClaimArgumentSchema = z
  .object({
    role: z.string().trim().min(1).max(200),
    argumentKind: claimArgumentKindSchema.default('entity'),
    entityId: z.string().uuid().optional(),
    value: z.unknown().optional(),
  })
  .superRefine((arg, ctx) => {
    if (arg.argumentKind === 'entity') {
      if (!arg.entityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An entity argument requires entityId',
          path: ['entityId'],
        });
      }
      if (arg.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An entity argument must not have a literal value',
          path: ['value'],
        });
      }
    } else {
      if (arg.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A literal argument requires a value',
          path: ['value'],
        });
      }
      if (arg.entityId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A literal argument must not reference an entity',
          path: ['entityId'],
        });
      }
    }
  });
export type CreateClaimArgument = z.infer<typeof createClaimArgumentSchema>;

function validTimeOrdered(data: { validStart?: string | null; validEnd?: string | null }): boolean {
  if (!data.validStart || !data.validEnd) return true;
  return Date.parse(data.validStart) <= Date.parse(data.validEnd);
}

/** Payload to create a claim. `predicate` and at least one argument required. */
export const createClaimSchema = z
  .object({
    predicate: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    validStart: z.string().datetime().optional(),
    validEnd: z.string().datetime().optional(),
    properties: z.record(z.unknown()).optional(),
    arguments: z.array(createClaimArgumentSchema).min(1, 'At least one argument is required'),
  })
  .refine(validTimeOrdered, {
    message: 'validStart must be on or before validEnd',
    path: ['validEnd'],
  });
export type CreateClaim = z.infer<typeof createClaimSchema>;

/**
 * Payload to edit a claim. All fields optional; at least one is required. When
 * `arguments` is provided it REPLACES the full argument set (so argument roles
 * can be edited), and must contain at least one argument.
 */
export const updateClaimSchema = z
  .object({
    predicate: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    validStart: z.string().datetime().nullable().optional(),
    validEnd: z.string().datetime().nullable().optional(),
    properties: z.record(z.unknown()).optional(),
    arguments: z
      .array(createClaimArgumentSchema)
      .min(1, 'At least one argument is required')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  })
  .refine(validTimeOrdered, {
    message: 'validStart must be on or before validEnd',
    path: ['validEnd'],
  });
export type UpdateClaim = z.infer<typeof updateClaimSchema>;

// ---------------------------------------------------------------------------
// Note shapes (US-011)
//
// Notes are canonical records for freeform captured text. They are NOT entity
// rows: they hold original material before/after extraction and can be cited by
// Source Excerpts. No AI provider is required to capture a note. Editors can
// create/edit/delete notes; viewers are read-only (enforced by KB role
// middleware on the API).
// ---------------------------------------------------------------------------

/** Public shape of a note as returned by the API. */
export const noteSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  title: z.string().nullable(),
  content: z.string(),
  properties: z.record(z.unknown()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Note = z.infer<typeof noteSchema>;

/** A list of notes (as returned by `GET .../notes`). */
export const noteListSchema = z.array(noteSchema);

/** Payload to create a note. `content` is required; `title` is optional. */
export const createNoteSchema = z.object({
  title: z.string().trim().max(500).optional(),
  content: z.string().min(1, 'Content is required').max(200000),
  properties: z.record(z.unknown()).optional(),
});
export type CreateNote = z.infer<typeof createNoteSchema>;

/** Payload to edit a note. All fields optional; at least one is required. */
export const updateNoteSchema = z
  .object({
    title: z.string().trim().max(500).nullable().optional(),
    content: z.string().min(1, 'Content is required').max(200000).optional(),
    properties: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateNote = z.infer<typeof updateNoteSchema>;

// ---------------------------------------------------------------------------
// Source shapes (US-011)
//
// Sources are canonical records for imported/captured material or structured
// material metadata (e.g. a book, web page, or document). `uri` is a basic
// locator; richer details live in `metadata`. Like notes, sources are NOT
// entity rows and can be cited by Source Excerpts. No AI provider is required.
// ---------------------------------------------------------------------------

/** Public shape of a source as returned by the API. */
export const sourceSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  title: z.string().nullable(),
  sourceType: z.string().nullable(),
  uri: z.string().nullable(),
  content: z.string().nullable(),
  metadata: z.record(z.unknown()),
  properties: z.record(z.unknown()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Source = z.infer<typeof sourceSchema>;

/** A list of sources (as returned by `GET .../sources`). */
export const sourceListSchema = z.array(sourceSchema);

/** Payload to create a source. `title` is required as a human-readable label. */
export const createSourceSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  sourceType: z.string().trim().max(200).optional(),
  uri: z.string().trim().max(2000).optional(),
  content: z.string().max(500000).optional(),
  metadata: z.record(z.unknown()).optional(),
  properties: z.record(z.unknown()).optional(),
});
export type CreateSource = z.infer<typeof createSourceSchema>;

/** Payload to edit a source. All fields optional; at least one is required. */
export const updateSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    sourceType: z.string().trim().max(200).nullable().optional(),
    uri: z.string().trim().max(2000).nullable().optional(),
    content: z.string().max(500000).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    properties: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateSource = z.infer<typeof updateSourceSchema>;

// ---------------------------------------------------------------------------
// Source Excerpt / Citation shapes (US-011)
//
// A Source Excerpt references a span or excerpt in EXACTLY ONE origin (a Note
// or a Source) and optionally cites a `claim` it supports. This is how original
// material stays citable from extracted/manual claims (US-011 AC3/AC4).
// ---------------------------------------------------------------------------

/** Public shape of a source excerpt as returned by the API. */
export const sourceExcerptSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  noteId: z.string().uuid().nullable(),
  claimId: z.string().uuid().nullable(),
  excerpt: z.string().nullable(),
  spanStart: z.number().int().nonnegative().nullable(),
  spanEnd: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.unknown()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SourceExcerpt = z.infer<typeof sourceExcerptSchema>;

/**
 * A source excerpt enriched with a summary of the claim it cites (if any). Used
 * by note/source views to show linked extracted/manual claims (US-011 AC4).
 */
export const sourceExcerptViewSchema = sourceExcerptSchema.extend({
  claim: z
    .object({
      id: z.string().uuid(),
      predicate: z.string(),
    })
    .nullable(),
});
export type SourceExcerptView = z.infer<typeof sourceExcerptViewSchema>;

/** A list of source excerpts (as returned by `GET .../source-excerpts`). */
export const sourceExcerptListSchema = z.array(sourceExcerptViewSchema);

function spanOrdered(data: { spanStart?: number | null; spanEnd?: number | null }): boolean {
  if (data.spanStart === undefined || data.spanStart === null) return true;
  if (data.spanEnd === undefined || data.spanEnd === null) return true;
  return data.spanStart <= data.spanEnd;
}

/**
 * Payload to create a source excerpt. Exactly one of `noteId`/`sourceId` is
 * required (the origin); at least one of `excerpt` or a span must be present so
 * the citation actually references something.
 */
export const createSourceExcerptSchema = z
  .object({
    sourceId: z.string().uuid().optional(),
    noteId: z.string().uuid().optional(),
    claimId: z.string().uuid().optional(),
    excerpt: z.string().trim().max(50000).optional(),
    spanStart: z.number().int().nonnegative().optional(),
    spanEnd: z.number().int().nonnegative().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    const hasNote = data.noteId !== undefined;
    const hasSource = data.sourceId !== undefined;
    if (hasNote === hasSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one origin: noteId or sourceId',
        path: [hasNote ? 'sourceId' : 'noteId'],
      });
    }
    const hasSpan = data.spanStart !== undefined && data.spanEnd !== undefined;
    const hasExcerpt = data.excerpt !== undefined && data.excerpt.length > 0;
    if (!hasSpan && !hasExcerpt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide an excerpt or a span (spanStart and spanEnd)',
        path: ['excerpt'],
      });
    }
    if (!spanOrdered(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'spanStart must be on or before spanEnd',
        path: ['spanEnd'],
      });
    }
  });
export type CreateSourceExcerpt = z.infer<typeof createSourceExcerptSchema>;

/**
 * Payload to edit a source excerpt. The origin (note/source) cannot be changed;
 * only the citation details and the linked claim. At least one field required.
 */
export const updateSourceExcerptSchema = z
  .object({
    claimId: z.string().uuid().nullable().optional(),
    excerpt: z.string().trim().max(50000).nullable().optional(),
    spanStart: z.number().int().nonnegative().nullable().optional(),
    spanEnd: z.number().int().nonnegative().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  })
  .refine(spanOrdered, {
    message: 'spanStart must be on or before spanEnd',
    path: ['spanEnd'],
  });
export type UpdateSourceExcerpt = z.infer<typeof updateSourceExcerptSchema>;

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
