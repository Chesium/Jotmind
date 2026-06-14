import { z } from 'zod';
import { remoteCallConfirmationSchema } from './ai.js';
import { searchResponseSchema } from './search.js';

/**
 * Provenance-aware AI answers (US-020).
 *
 * A natural-language question is answered using evidence drawn from the graph.
 * Manual search ALWAYS runs as a fallback so the box stays useful with AI
 * disabled (AC2). When AI is configured and permitted, an answer is generated
 * that cites the graph claims / notes / sources used as evidence (AC1). Each
 * cited claim carries its predicate, connected entities, confidence, and
 * provenance metadata (AC3) — built server-side from the real records so the
 * citations cannot be fabricated by the model. Statements are labeled as known
 * facts, inferred facts, uncertain claims, or missing information (AC5), and
 * the citations are clickable so the UI can open detail views (AC4).
 */

/** Request body for the answer box. */
export const answerRequestSchema = z.object({
  q: z.string().trim().min(1).max(1000),
  /** Required only after the server asks for per-request remote AI confirmation. */
  remoteConfirmation: remoteCallConfirmationSchema.optional(),
});
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

/**
 * How a statement relates to the graph evidence (AC5). `known` = directly
 * supported by stored claims/notes/sources; `inferred` = derived from rules or
 * combined evidence; `uncertain` = low-confidence/conflicting; `missing` = the
 * graph has no evidence to answer this part.
 */
export const ANSWER_FACT_KINDS = ['known', 'inferred', 'uncertain', 'missing'] as const;
export const answerFactKindSchema = z.enum(ANSWER_FACT_KINDS);
export type AnswerFactKind = z.infer<typeof answerFactKindSchema>;

/** Kinds of records an answer may cite as evidence (AC1). */
export const ANSWER_CITATION_KINDS = ['claim', 'note', 'source', 'source_excerpt'] as const;
export const answerCitationKindSchema = z.enum(ANSWER_CITATION_KINDS);
export type AnswerCitationKind = z.infer<typeof answerCitationKindSchema>;

/** A role-labeled entity (or literal) connected to a cited claim (AC3). */
export const answerClaimEntitySchema = z.object({
  role: z.string(),
  entityId: z.string().uuid().nullable(),
  name: z.string(),
});
export type AnswerClaimEntity = z.infer<typeof answerClaimEntitySchema>;

/**
 * A single piece of evidence the answer may cite. Built server-side from real
 * records (AC3) and given a stable `ref` index that statements reference.
 * Claim-specific fields (`predicate`, `entities`, `confidence`, `provenance`)
 * are null/empty for note/source citations.
 */
export const answerCitationSchema = z.object({
  /** Stable index referenced by `answerStatement.citations`. */
  ref: z.number().int().nonnegative(),
  kind: answerCitationKindSchema,
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid(),
  title: z.string(),
  snippet: z.string().nullable(),
  predicate: z.string().nullable(),
  entities: z.array(answerClaimEntitySchema),
  confidence: z.number().nullable(),
  provenance: z.record(z.unknown()).nullable(),
});
export type AnswerCitation = z.infer<typeof answerCitationSchema>;

export const answerCitationListSchema = z.array(answerCitationSchema);

/**
 * One statement of the answer, labeled by fact kind (AC5) and citing zero or
 * more pieces of evidence by their `ref` index (AC1/AC4).
 */
export const answerStatementSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  factKind: answerFactKindSchema,
  /** Indices into the response `citations` array supporting this statement. */
  citations: z.array(z.number().int().nonnegative()),
});
export type AnswerStatement = z.infer<typeof answerStatementSchema>;

/**
 * The structured answer produced by an {@link AnswerGenerator}. LLM output is
 * constrained to this shape (invalid output is discarded, mirroring US-019).
 */
export const generatedAnswerSchema = z.object({
  summary: z.string().max(4000),
  statements: z.array(answerStatementSchema),
});
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;

/** Metadata about the AI answer attempt (mirrors `commandAiInfoSchema`). */
export const answerAiInfoSchema = z.object({
  /** Whether answer generation was attempted (configured + policy permits). */
  attempted: z.boolean(),
  /** Whether answer generation is available at all (generator + policy). */
  available: z.boolean(),
  /** Why AI was unavailable / not used, if applicable. */
  reason: z.string().nullable(),
  /** Whether a repair retry was used to obtain valid output. */
  repaired: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Whether the generator is deterministic mock/demo output. */
  demo: z.boolean(),
  /** False for remote adapters shipped as untested skeletons (AC1). */
  verified: z.boolean(),
  /** Label shown for demo output, if any. */
  label: z.string().nullable(),
});
export type AnswerAiInfo = z.infer<typeof answerAiInfoSchema>;

/**
 * Full response of `POST .../answers`. `fallback` (manual search) is ALWAYS
 * present so No-AI mode still offers search results (AC2). `answer` is the
 * structured AI answer (or null when AI is unavailable / output invalid), and
 * `citations` is the evidence it could cite (empty when AI is unavailable).
 */
export const answerResponseSchema = z.object({
  query: z.string(),
  ai: answerAiInfoSchema,
  answer: generatedAnswerSchema.nullable(),
  citations: answerCitationListSchema,
  fallback: searchResponseSchema,
});
export type AnswerResponse = z.infer<typeof answerResponseSchema>;
