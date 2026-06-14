import { z } from 'zod';
import { proposalChangesSchema } from './proposals.js';
import { searchResponseSchema, searchResultKindSchema, searchResultListSchema } from './search.js';

/**
 * Universal command/search interface (US-019).
 *
 * One command box accepts a natural-language query. Manual full-text search
 * always runs (so the box works with AI disabled — AC1). When AI is configured
 * and permitted, the query is additionally interpreted into a STRUCTURED
 * command constrained by the Zod schemas here (AC2): invalid model output is
 * discarded and never executed (AC3), one repair retry may be attempted (AC4),
 * and low-confidence / invalid interpretations fall back to the manual search
 * results (AC5). The structured interpretation and the fallback results are
 * returned separately so the UI can show them in distinct sections (AC6).
 */

/** Request body for the command box. */
export const commandRequestSchema = z.object({
  q: z.string().trim().min(1).max(500),
});
export type CommandRequest = z.infer<typeof commandRequestSchema>;

/**
 * Below this confidence, a structured interpretation is treated as
 * low-confidence and discarded in favour of the manual search fallback (AC5).
 */
export const COMMAND_CONFIDENCE_THRESHOLD = 0.4;

/** The intents the command interpreter may resolve a query into. */
export const COMMAND_INTENTS = ['search', 'create'] as const;
export const commandIntentSchema = z.enum(COMMAND_INTENTS);
export type CommandIntent = (typeof COMMAND_INTENTS)[number];

/**
 * Structured search filters an AI interpretation may produce. A constrained
 * subset of the manual search query (US-012) — the command router maps these
 * onto a real search call. All fields optional so a bare token query is valid.
 */
export const commandSearchFiltersSchema = z.object({
  q: z.string().trim().max(500).optional(),
  kinds: z.array(searchResultKindSchema).max(4).optional(),
  type: z.string().trim().max(200).optional(),
  predicate: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(200).optional(),
  confidenceMin: z.number().min(0).max(1).optional(),
  confidenceMax: z.number().min(0).max(1).optional(),
});
export type CommandSearchFilters = z.infer<typeof commandSearchFiltersSchema>;

/**
 * A structured command interpretation. `confidence` (0..1) lets the router fall
 * back to manual search when the model is unsure (AC5). A `search` intent is
 * executed against the search store; a `create` intent is presented as a
 * constrained proposal preview (the existing capture/proposal review flow,
 * US-017/018, performs any actual mutation).
 */
export const commandInterpretationSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('search'),
    confidence: z.number().min(0).max(1),
    explanation: z.string().max(500).optional(),
    filters: commandSearchFiltersSchema,
  }),
  z.object({
    intent: z.literal('create'),
    confidence: z.number().min(0).max(1),
    explanation: z.string().max(500).optional(),
    changes: proposalChangesSchema,
  }),
]);
export type CommandInterpretation = z.infer<typeof commandInterpretationSchema>;

/** Metadata about the AI interpretation attempt for a command. */
export const commandAiInfoSchema = z.object({
  /** Whether an AI interpretation was attempted (configured + policy permits). */
  attempted: z.boolean(),
  /** Whether AI interpretation is available at all (extractor + policy). */
  available: z.boolean(),
  /** Why AI was unavailable / not used, if applicable. */
  reason: z.string().nullable(),
  /** Whether a repair retry was used to obtain valid output (AC4). */
  repaired: z.boolean(),
  /** Whether a parsed interpretation was discarded for low confidence (AC5). */
  lowConfidence: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Whether the interpreter is deterministic mock/demo output. */
  demo: z.boolean(),
  /** Label shown for demo output, if any. */
  label: z.string().nullable(),
});
export type CommandAiInfo = z.infer<typeof commandAiInfoSchema>;

/**
 * Full response of `POST .../command`. `fallback` (manual search) is ALWAYS
 * present (AC1/AC5). `interpretation` is the structured AI command (or null
 * when AI is unavailable / output was invalid / confidence was too low), and
 * `interpretedResults` are the search hits produced by a `search`
 * interpretation. Keeping these separate lets the UI visually distinguish the
 * structured interpretation from the fallback results (AC6).
 */
export const commandResponseSchema = z.object({
  query: z.string(),
  ai: commandAiInfoSchema,
  interpretation: commandInterpretationSchema.nullable(),
  interpretedResults: searchResultListSchema.nullable(),
  fallback: searchResponseSchema,
});
export type CommandResponse = z.infer<typeof commandResponseSchema>;
