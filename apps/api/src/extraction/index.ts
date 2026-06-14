import {
  MOCK_EXTRACTION_LABEL,
  parseOrThrow,
  proposalChangesSchema,
  type AiProviderConfig,
  type AiProviderKind,
  type ProposalChange,
} from '@jotmind/schemas';
import { createLlmProvider, parseProviderConfig } from '../ai/factory.js';
import type { LlmProvider } from '../ai/types.js';

/**
 * Graph extraction (US-017). Captured text is run through an extractor that
 * proposes candidate entities/claims. Extractors sit behind this interface so
 * the capture flow never depends on a vendor SDK directly (mirrors the AI
 * provider adapter layer, US-015).
 *
 * - {@link MockGraphExtractor} is deterministic demo output (AC2/AC6) — the same
 *   text always yields the same candidates and no network is touched.
 * - {@link LlmGraphExtractor} wraps a real {@link LlmProvider}, prompting it for
 *   strict JSON validated by `proposalChangesSchema`. Remote providers ship as
 *   configured-but-untested skeletons (`verified: false`, AC3).
 */
export interface GraphExtractor {
  readonly name: string;
  readonly providerKind: AiProviderKind;
  readonly model: string | null;
  /** True when output is deterministic mock/demo output (must be labeled, AC6). */
  readonly demo: boolean;
  /** False for remote adapters shipped as untested skeletons (AC3). */
  readonly verified: boolean;
  extract(text: string): Promise<ProposalChange[]>;
}

/** Remote provider kinds — gated by AI policy and shipped unverified in V1. */
export function isRemoteProviderKind(kind: AiProviderKind): boolean {
  return kind === 'openai' || kind === 'anthropic';
}

const STOPWORDS = new Set([
  'The',
  'A',
  'An',
  'This',
  'That',
  'These',
  'Those',
  'It',
  'He',
  'She',
  'They',
  'We',
  'I',
  'You',
  'There',
  'When',
  'Where',
  'While',
  'And',
  'But',
  'Or',
  'If',
  'Then',
  'So',
]);

/** Deterministic slug usable as a proposal `ref` key. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Deterministic mock extractor (US-017 AC2/AC6). Pulls proper-noun phrases out
 * of the text as candidate `Concept` entities and, when at least two are found,
 * proposes a `mentioned_with` claim linking the first two. No model, no network
 * — purely a function of the input, so tests are reproducible. Its output is
 * always labeled {@link MOCK_EXTRACTION_LABEL}.
 */
export class MockGraphExtractor implements GraphExtractor {
  readonly providerKind = 'mock' as const;
  readonly model = 'mock';
  readonly demo = true;
  readonly verified = true;
  constructor(readonly name = 'Mock Extractor') {}

  extract(text: string): Promise<ProposalChange[]> {
    const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
    const names: string[] = [];
    for (const match of matches) {
      if (STOPWORDS.has(match)) continue;
      if (!names.includes(match)) names.push(match);
      if (names.length >= 5) break;
    }

    const changes: ProposalChange[] = names.map((name) => ({
      op: 'create_entity',
      ref: slugify(name),
      type: 'Concept',
      name,
    }));

    if (names.length >= 2) {
      changes.push({
        op: 'create_claim',
        predicate: 'mentioned_with',
        confidence: 0.5,
        arguments: [
          { role: 'subject', kind: 'entity', ref: slugify(names[0] as string) },
          { role: 'object', kind: 'entity', ref: slugify(names[1] as string) },
        ],
      });
    }

    return Promise.resolve(changes);
  }
}

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract a knowledge graph from text.',
  'Respond with ONLY a JSON object of the form {"items": [...]} and nothing else.',
  'Each item is either:',
  '  {"op":"create_entity","ref":"<local-key>","type":"Person|Event|Concept|Place|Character","name":"..."}',
  '  {"op":"create_claim","predicate":"...","arguments":[{"role":"subject","kind":"entity","ref":"<local-key>"}]}',
  'Claim arguments reference entities by their local "ref". Use "kind":"literal" with a "value" for non-entity arguments.',
  'If nothing can be extracted, respond with {"items": []}.',
].join('\n');

/**
 * LLM-backed extractor. Prompts a real {@link LlmProvider} for strict JSON and
 * validates it with `proposalChangesSchema`; invalid output is discarded
 * (returns no candidates — a repair retry is added in US-019). Remote providers
 * are configured-but-untested skeletons in V1 (`verified: false`, AC3).
 */
export class LlmGraphExtractor implements GraphExtractor {
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

  async extract(text: string): Promise<ProposalChange[]> {
    const result = await this.llm.complete({
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
    });
    return parseExtractionOutput(result.text);
  }
}

/** Parse + validate raw LLM text into proposal changes. Returns [] if invalid. */
export function parseExtractionOutput(raw: string): ProposalChange[] {
  const json = stripCodeFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const result = proposalChangesSchema.safeParse(parsed);
  return result.success ? result.data.items : [];
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? (fenced[1] as string) : text;
}

export interface ExtractorFactoryOptions {
  /** Whether the deterministic mock extractor may be used at runtime (AC6). */
  allowDemo: boolean;
}

/** Build a {@link GraphExtractor} from validated provider config. */
export function createExtractorFromConfig(
  config: AiProviderConfig,
  options: ExtractorFactoryOptions,
): GraphExtractor | null {
  if (config.kind === 'mock') {
    return options.allowDemo ? new MockGraphExtractor(config.name) : null;
  }
  return new LlmGraphExtractor(createLlmProvider(config), config);
}

/**
 * Resolve the configured extractor from the environment, or `null` when no AI
 * provider is configured (→ No-AI capture, AC4). Reads `AI_PROVIDER_CONFIG`
 * (JSON). The deterministic mock extractor is only enabled when
 * `AI_DEMO_EXTRACTION=true` or outside production (dev/demo flag, AC6). Any
 * parse/build error resolves to `null` rather than crashing the app.
 */
export function resolveExtractorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GraphExtractor | null {
  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return null;
  const allowDemo = env.AI_DEMO_EXTRACTION === 'true' || env.NODE_ENV !== 'production';
  try {
    const config = parseProviderConfig(JSON.parse(raw));
    return createExtractorFromConfig(config, { allowDemo });
  } catch {
    return null;
  }
}

/** Re-export so callers can normalize/validate extractor output if needed. */
export { proposalChangesSchema, MOCK_EXTRACTION_LABEL, parseOrThrow };
