import {
  MOCK_EXTRACTION_LABEL,
  generatedAnswerSchema,
  type AiProviderConfig,
  type AiProviderKind,
  type AnswerCitation,
  type AnswerFactKind,
  type AnswerStatement,
  type GeneratedAnswer,
} from '@jotmind/schemas';
import { createLlmProvider, parseProviderConfig } from '../ai/factory.js';
import { isRemoteProviderKind } from '../extraction/index.js';
import type { LlmProvider } from '../ai/types.js';

/**
 * Provenance-aware answer generation (US-020). A question + the gathered graph
 * evidence are turned into a STRUCTURED answer constrained by
 * `generatedAnswerSchema`. Generators sit behind this interface so the answer
 * flow never depends on a vendor SDK directly (mirrors the AI provider adapter
 * layer, US-015, the extraction layer, US-017, and the command interpreter,
 * US-019).
 *
 * - {@link MockAnswerGenerator} is deterministic demo output — the same question
 *   + evidence always yields the same answer and no network is touched (AC1).
 * - {@link LlmAnswerGenerator} wraps a real {@link LlmProvider}, prompting it for
 *   strict JSON validated by `generatedAnswerSchema` with one repair retry.
 *   Remote providers are configured-but-untested skeletons (`verified: false`).
 */
export interface AnswerGenerationResult {
  /** The structured answer, or null when none could be produced. */
  answer: GeneratedAnswer | null;
  /** Whether a repair retry was used to obtain valid output. */
  repaired: boolean;
}

export interface AnswerGenerator {
  readonly name: string;
  readonly providerKind: AiProviderKind;
  readonly model: string | null;
  /** True when output is deterministic mock/demo output (must be labeled). */
  readonly demo: boolean;
  /** False for remote adapters shipped as untested skeletons (AC1). */
  readonly verified: boolean;
  generate(query: string, evidence: AnswerCitation[]): Promise<AnswerGenerationResult>;
}

/**
 * Classify a cited claim's fact kind from its provenance/confidence so the
 * answer distinguishes known / inferred / uncertain facts (AC5).
 */
function classifyClaim(citation: AnswerCitation): AnswerFactKind {
  const origin =
    citation.provenance && typeof citation.provenance.origin === 'string'
      ? (citation.provenance.origin as string)
      : null;
  if (origin === 'rule' || origin === 'inferred' || origin === 'rule_inference') {
    return 'inferred';
  }
  if (citation.confidence !== null && citation.confidence < 0.5) return 'uncertain';
  return 'known';
}

/**
 * Deterministic mock generator. Produces one statement per piece of evidence
 * (labeled by {@link classifyClaim}) plus a `missing` statement when there is no
 * evidence at all — so the same question always yields the same answer and the
 * four fact kinds (AC5) are exercised. Output is labeled
 * {@link MOCK_EXTRACTION_LABEL}.
 */
export class MockAnswerGenerator implements AnswerGenerator {
  readonly providerKind = 'mock' as const;
  readonly model = 'mock';
  readonly demo = true;
  readonly verified = true;
  constructor(readonly name = 'Mock Answerer') {}

  generate(query: string, evidence: AnswerCitation[]): Promise<AnswerGenerationResult> {
    if (evidence.length === 0) {
      const answer: GeneratedAnswer = {
        summary: `No supporting evidence was found in this Knowledge Base for: "${query}".`,
        statements: [
          {
            text: 'The graph has no claims, notes, or sources relevant to this question.',
            factKind: 'missing',
            citations: [],
          },
        ],
      };
      return Promise.resolve({ answer, repaired: false });
    }

    const statements: AnswerStatement[] = evidence.map((citation) => {
      if (citation.kind === 'claim') {
        const parts = citation.entities.map((e) => `${e.role}: ${e.name}`).join(', ');
        const confidence =
          citation.confidence !== null ? ` (confidence ${citation.confidence})` : '';
        return {
          text: `${citation.predicate ?? citation.title}${parts ? ` — ${parts}` : ''}${confidence}.`,
          factKind: classifyClaim(citation),
          citations: [citation.ref],
        };
      }
      return {
        text: `${citation.kind === 'note' ? 'Note' : 'Source'} "${citation.title}" is relevant.`,
        factKind: 'known',
        citations: [citation.ref],
      };
    });

    const answer: GeneratedAnswer = {
      summary: `Found ${evidence.length} piece(s) of evidence relevant to "${query}".`,
      statements,
    };
    return Promise.resolve({ answer, repaired: false });
  }
}

const ANSWER_SYSTEM_PROMPT = [
  'You answer questions about a knowledge graph using ONLY the provided evidence.',
  'Each evidence item has a numeric "ref". Cite the refs that support each statement.',
  'Respond with ONLY a JSON object and nothing else, shaped exactly like:',
  '  {"summary":"...","statements":[{"text":"...","factKind":"known|inferred|uncertain|missing","citations":[0,1]}]}',
  'Use factKind "known" for facts directly supported by evidence, "inferred" for facts you',
  'derived by combining evidence, "uncertain" for low-confidence/conflicting evidence, and',
  '"missing" when the evidence does not answer part of the question. Do not invent evidence',
  'or cite refs that were not provided.',
].join('\n');

function buildEvidencePrompt(query: string, evidence: AnswerCitation[]): string {
  const lines = evidence.map((c) => {
    if (c.kind === 'claim') {
      const args = c.entities.map((e) => `${e.role}=${e.name}`).join(', ');
      const confidence = c.confidence !== null ? `, confidence=${c.confidence}` : '';
      return `ref ${c.ref} [claim] ${c.predicate ?? c.title}${args ? ` (${args})` : ''}${confidence}`;
    }
    return `ref ${c.ref} [${c.kind}] ${c.title}${c.snippet ? `: ${c.snippet}` : ''}`;
  });
  const evidenceBlock = lines.length > 0 ? lines.join('\n') : '(no evidence found)';
  return `Question: ${query}\n\nEvidence:\n${evidenceBlock}`;
}

/**
 * LLM-backed generator. Prompts a real {@link LlmProvider} for strict JSON and
 * validates it with `generatedAnswerSchema`. On invalid output it issues exactly
 * ONE repair retry; if the repair is also invalid the answer is discarded
 * (`null`) so the caller falls back to manual search. Remote providers are
 * configured-but-untested skeletons in V1 (`verified: false`).
 */
export class LlmAnswerGenerator implements AnswerGenerator {
  readonly name: string;
  readonly providerKind: AiProviderKind;
  readonly model: string | null;
  readonly demo = false;
  readonly verified: boolean;

  constructor(
    private readonly llm: LlmProvider,
    config: AiProviderConfig,
  ) {
    this.name = config.name;
    this.providerKind = config.kind;
    this.model = 'llmModel' in config ? (config.llmModel ?? null) : null;
    this.verified = !isRemoteProviderKind(config.kind);
  }

  async generate(query: string, evidence: AnswerCitation[]): Promise<AnswerGenerationResult> {
    const userPrompt = buildEvidencePrompt(query, evidence);
    const first = await this.llm.complete({
      messages: [
        { role: 'system', content: ANSWER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    });
    const parsedFirst = parseAnswerOutput(first.text);
    if (parsedFirst) return { answer: parsedFirst, repaired: false };

    // One repair retry: re-ask including the previous invalid output.
    const repair = await this.llm.complete({
      messages: [
        { role: 'system', content: ANSWER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content:
            'That was not valid JSON for the answer schema. Reply again with ONLY a single valid JSON object.',
        },
      ],
      temperature: 0,
    });
    const parsedRepair = parseAnswerOutput(repair.text);
    return { answer: parsedRepair, repaired: parsedRepair !== null };
  }
}

/** Parse + validate raw LLM text into a generated answer. Null if invalid. */
export function parseAnswerOutput(raw: string): GeneratedAnswer | null {
  const json = stripCodeFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = generatedAnswerSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? (fenced[1] as string) : text;
}

export interface AnswerGeneratorFactoryOptions {
  /** Whether the deterministic mock generator may be used at runtime. */
  allowDemo: boolean;
}

/** Build an {@link AnswerGenerator} from validated provider config. */
export function createAnswerGeneratorFromConfig(
  config: AiProviderConfig,
  options: AnswerGeneratorFactoryOptions,
): AnswerGenerator | null {
  if (config.kind === 'mock') {
    return options.allowDemo ? new MockAnswerGenerator(config.name) : null;
  }
  return new LlmAnswerGenerator(createLlmProvider(config), config);
}

/**
 * Resolve the configured answer generator from the environment, or `null` when
 * no AI provider is configured (→ No-AI answers, AC2). Reads `AI_PROVIDER_CONFIG`
 * (JSON). The deterministic mock is only enabled when `AI_DEMO_EXTRACTION=true`
 * or outside production. Mirrors `resolveCommandInterpreterFromEnv` (US-019).
 */
export function resolveAnswerGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnswerGenerator | null {
  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return null;
  const allowDemo = env.AI_DEMO_EXTRACTION === 'true' || env.NODE_ENV !== 'production';
  try {
    const config = parseProviderConfig(JSON.parse(raw));
    return createAnswerGeneratorFromConfig(config, { allowDemo });
  } catch {
    return null;
  }
}

export { MOCK_EXTRACTION_LABEL };
