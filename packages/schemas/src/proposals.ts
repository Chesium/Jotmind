import { z } from 'zod';
import { noteSchema, proposalStatusSchema, sourceSchema } from './graph.js';

/**
 * AI proposal review queue (US-017/US-018).
 *
 * Captured text (Notes/Sources) can be run through an AI extractor that
 * proposes candidate graph changes. Those candidates are stored as **Proposals**
 * and never mutate canonical records until reviewed and accepted (US-018). This
 * module defines the shared, serializable shapes:
 *
 * - the structured `changes` payload a proposal carries (create-entity /
 *   create-claim candidates, forward-compatible with update/delete/merge in
 *   US-018), and
 * - the public proposal shape, the quick-capture request, and the capture
 *   response (which reports AI availability so a No-AI install shows a
 *   setup/unavailable state without blocking capture — AC4).
 */

/** Where a proposal came from. `extraction` = AI capture (US-017). */
export const PROPOSAL_KINDS = ['extraction', 'import'] as const;
export const proposalKindSchema = z.enum(PROPOSAL_KINDS);
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Label shown wherever deterministic mock extraction output is surfaced at
 * runtime (US-017 AC6). The mock extractor is a dev/demo aid, never a real
 * model, so its output must be clearly marked.
 */
export const MOCK_EXTRACTION_LABEL = 'Mock AI / deterministic demo output';

// --- Structured proposal changes -------------------------------------------
//
// A proposal's `changes` is a list of candidate operations. US-017 produces
// `create_entity` and `create_claim` candidates; later stories extend the
// discriminated union with update/delete/merge ops. Because candidate entities
// do not exist yet, claim arguments reference them by a temporary local `ref`
// key (matching a `create_entity` change's `ref`), or by an existing entity id.

/** A candidate new entity. `ref` is a temporary key claim arguments point at. */
export const proposalEntityChangeSchema = z.object({
  op: z.literal('create_entity'),
  ref: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  aliases: z.array(z.string().min(1).max(500)).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(200)).optional(),
  properties: z.record(z.unknown()).optional(),
});
export type ProposalEntityChange = z.infer<typeof proposalEntityChangeSchema>;

/** A candidate claim argument: an entity reference (`ref`) or a literal `value`. */
export const proposalClaimArgumentSchema = z
  .object({
    role: z.string().min(1).max(200),
    kind: z.enum(['entity', 'literal']).default('entity'),
    /** Local `create_entity` ref OR an existing entity id (entity kind only). */
    ref: z.string().min(1).max(200).optional(),
    value: z.unknown().optional(),
  })
  .superRefine((arg, ctx) => {
    if (arg.kind === 'entity') {
      if (!arg.ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An entity argument requires a ref',
          path: ['ref'],
        });
      }
    } else if (arg.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A literal argument requires a value',
        path: ['value'],
      });
    }
  });
export type ProposalClaimArgument = z.infer<typeof proposalClaimArgumentSchema>;

/** A candidate new claim with role-labeled arguments. */
export const proposalClaimChangeSchema = z.object({
  op: z.literal('create_claim'),
  predicate: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  arguments: z.array(proposalClaimArgumentSchema).min(1),
});
export type ProposalClaimChange = z.infer<typeof proposalClaimChangeSchema>;

/**
 * A candidate new Note (US-031). Importing plain text/Markdown produces these so
 * the imported content is stored as a canonical Note only after review (AC1/AC3).
 */
export const proposalNoteChangeSchema = z.object({
  op: z.literal('create_note'),
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(100000),
  properties: z.record(z.unknown()).optional(),
});
export type ProposalNoteChange = z.infer<typeof proposalNoteChangeSchema>;

/**
 * A candidate new Source (US-031). Importing plain text/Markdown as a Source
 * produces these; the Source is created on accept via the canonical write path.
 */
export const proposalSourceChangeSchema = z.object({
  op: z.literal('create_source'),
  title: z.string().min(1).max(500),
  sourceType: z.string().max(200).optional(),
  uri: z.string().max(2000).optional(),
  content: z.string().max(100000).optional(),
  properties: z.record(z.unknown()).optional(),
});
export type ProposalSourceChange = z.infer<typeof proposalSourceChangeSchema>;

/** A single candidate change within a proposal. */
export const proposalChangeSchema = z.discriminatedUnion('op', [
  proposalEntityChangeSchema,
  proposalClaimChangeSchema,
  proposalNoteChangeSchema,
  proposalSourceChangeSchema,
]);
export type ProposalChange = z.infer<typeof proposalChangeSchema>;

/** The full structured payload stored in `proposals.changes`. */
export const proposalChangesSchema = z.object({
  items: z.array(proposalChangeSchema).default([]),
});
export type ProposalChanges = z.infer<typeof proposalChangesSchema>;

// --- Public proposal shape --------------------------------------------------

/** Public shape of a proposal as returned by the API. */
export const proposalSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  kind: z.string(),
  status: proposalStatusSchema,
  changes: proposalChangesSchema,
  sourceNoteId: z.string().uuid().nullable(),
  sourceSourceId: z.string().uuid().nullable(),
  sourceExcerptId: z.string().uuid().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  reviewReason: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdBy: z.string().uuid().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const proposalListSchema = z.array(proposalSchema);

// --- Quick capture ----------------------------------------------------------

/** What a quick-capture stores the original text as before extraction (AC1). */
export const CAPTURE_KINDS = ['note', 'source'] as const;
export const captureKindSchema = z.enum(CAPTURE_KINDS);
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

/** Quick-capture request: store text as a Note/Source, then optionally extract. */
export const captureRequestSchema = z.object({
  kind: captureKindSchema.default('note'),
  title: z.string().trim().max(500).optional(),
  content: z.string().trim().min(1).max(100000),
  sourceType: z.string().trim().max(200).optional(),
  uri: z.string().trim().max(2000).optional(),
  /** Run AI extraction after storing (default true; honored only if AI available). */
  extract: z.boolean().optional(),
});
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

/** Whether AI extraction is currently available, and why not if it is not. */
export const extractionAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** True when output is deterministic mock/demo output (must be labeled, AC6). */
  demo: z.boolean(),
  /** False for remote adapters shipped as configured-but-untested skeletons (AC3). */
  verified: z.boolean(),
  /** Human-readable label shown alongside demo output (AC6). */
  label: z.string().nullable(),
});
export type ExtractionAvailability = z.infer<typeof extractionAvailabilitySchema>;

export const EXTRACTION_STATUSES = ['created', 'empty', 'unavailable', 'error'] as const;
export const extractionStatusSchema = z.enum(EXTRACTION_STATUSES);
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

/** Result of running (or skipping) extraction during a quick-capture. */
export const captureExtractionResultSchema = z.object({
  status: extractionStatusSchema,
  availability: extractionAvailabilitySchema,
  proposal: proposalSchema.nullable(),
  error: z.string().nullable(),
});
export type CaptureExtractionResult = z.infer<typeof captureExtractionResultSchema>;

/** Quick-capture response: the stored record plus the extraction outcome. */
export const captureResponseSchema = z.object({
  kind: captureKindSchema,
  note: noteSchema.nullable(),
  source: sourceSchema.nullable(),
  extraction: captureExtractionResultSchema,
});
export type CaptureResponse = z.infer<typeof captureResponseSchema>;

// --- Proposal review (US-018) ----------------------------------------------
//
// Editors review the pending queue and accept/reject/edit proposals at item
// level (a subset of `changes.items`) or batch level (the whole proposal).
// Accepting executes the selected create-entity/create-claim candidates as
// canonical records, preserving provenance; rejecting marks the proposal so it
// stays linked to its source note/source.

/**
 * Edit a pending proposal's structured changes before accepting (US-018 AC2).
 * The replacement payload is re-validated by `proposalChangesSchema`, so invalid
 * payloads can never be saved (and therefore never executed — AC4).
 */
export const editProposalSchema = z.object({
  changes: proposalChangesSchema,
});
export type EditProposalRequest = z.infer<typeof editProposalSchema>;

/**
 * Accept a pending proposal (US-018 AC2). With no `itemIndexes` the whole batch
 * is applied; an `itemIndexes` array applies only those items (item-level
 * accept). A `note` records optional user-confirmation context preserved in
 * accepted-claim provenance (AC3).
 */
export const acceptProposalSchema = z.object({
  itemIndexes: z.array(z.number().int().nonnegative()).min(1).optional(),
  note: z.string().max(2000).optional(),
});
export type AcceptProposalRequest = z.infer<typeof acceptProposalSchema>;

/** Reject (or dismiss) a pending proposal; it stays linked to its source. */
export const rejectProposalSchema = z.object({
  reason: z.string().max(2000).optional(),
  dismiss: z.boolean().optional(),
});
export type RejectProposalRequest = z.infer<typeof rejectProposalSchema>;

/** Result of accepting a proposal: created records plus the updated proposal. */
export const acceptProposalResultSchema = z.object({
  proposal: proposalSchema,
  createdEntityIds: z.array(z.string().uuid()),
  createdClaimIds: z.array(z.string().uuid()),
  createdNoteIds: z.array(z.string().uuid()).default([]),
  createdSourceIds: z.array(z.string().uuid()).default([]),
});
export type AcceptProposalResult = z.infer<typeof acceptProposalResultSchema>;
