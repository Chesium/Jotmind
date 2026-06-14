import {
  MOCK_EXTRACTION_LABEL,
  commandInterpretationSchema,
  type AiProviderConfig,
  type AiProviderKind,
  type CommandInterpretation,
} from '@jotmind/schemas';
import { createLlmProvider, parseProviderConfig } from '../ai/factory.js';
import { isRemoteProviderKind } from '../extraction/index.js';
import type { LlmProvider } from '../ai/types.js';

/**
 * Command interpretation (US-019). A natural-language query is turned into a
 * STRUCTURED command (search filters or a create proposal) constrained by
 * `commandInterpretationSchema`. Interpreters sit behind this interface so the
 * command flow never depends on a vendor SDK directly (mirrors the AI provider
 * adapter layer, US-015, and the extraction layer, US-017).
 *
 * - {@link MockCommandInterpreter} is deterministic demo output — the same query
 *   always yields the same interpretation and no network is touched.
 * - {@link LlmCommandInterpreter} wraps a real {@link LlmProvider}, prompting it
 *   for strict JSON validated by `commandInterpretationSchema`. Invalid output
 *   triggers exactly one repair retry (AC4); still-invalid output is discarded
 *   (returns `null`, AC3) so the caller falls back to manual search (AC5).
 */
export interface CommandInterpretation_Result {
  /** The structured interpretation, or null when none could be produced. */
  interpretation: CommandInterpretation | null;
  /** Whether a repair retry was used to obtain valid output (AC4). */
  repaired: boolean;
}

export interface CommandInterpreter {
  readonly name: string;
  readonly providerKind: AiProviderKind;
  readonly model: string | null;
  /** True when output is deterministic mock/demo output (must be labeled). */
  readonly demo: boolean;
  /** False for remote adapters shipped as untested skeletons (US-017 AC3). */
  readonly verified: boolean;
  interpret(query: string): Promise<CommandInterpretation_Result>;
}

/**
 * Deterministic mock interpreter. Parses `key:value` hints out of the query
 * (`type:Person`, `predicate:knows`, `tag:family`, `kind:claim`) into search
 * filters and uses the remaining words as the token query. Purely a function of
 * the input, so tests are reproducible and browser verification is stable. Only
 * ever emits a `search` intent. Its output is labeled {@link MOCK_EXTRACTION_LABEL}.
 */
export class MockCommandInterpreter implements CommandInterpreter {
  readonly providerKind = 'mock' as const;
  readonly model = 'mock';
  readonly demo = true;
  readonly verified = true;
  constructor(readonly name = 'Mock Interpreter') {}

  interpret(query: string): Promise<CommandInterpretation_Result> {
    const filters: {
      q?: string;
      type?: string;
      predicate?: string;
      tag?: string;
      kinds?: ('entity' | 'claim' | 'note' | 'source')[];
    } = {};
    const validKinds = new Set(['entity', 'claim', 'note', 'source']);
    const words: string[] = [];
    for (const token of query.split(/\s+/).filter(Boolean)) {
      const match = token.match(/^(type|predicate|tag|kind):(.+)$/i);
      if (match) {
        const key = (match[1] as string).toLowerCase();
        const value = match[2] as string;
        if (key === 'type') filters.type = value;
        else if (key === 'predicate') filters.predicate = value;
        else if (key === 'tag') filters.tag = value;
        else if (key === 'kind' && validKinds.has(value.toLowerCase())) {
          filters.kinds = [value.toLowerCase() as 'entity' | 'claim' | 'note' | 'source'];
        }
        continue;
      }
      words.push(token);
    }
    if (words.length > 0) filters.q = words.join(' ');

    const interpretation: CommandInterpretation = {
      intent: 'search',
      confidence: 0.9,
      explanation: 'Mock interpreter mapped the query to a token search.',
      filters,
    };
    return Promise.resolve({ interpretation, repaired: false });
  }
}

const COMMAND_SYSTEM_PROMPT = [
  'You translate a user request about a knowledge graph into ONE structured command.',
  'Respond with ONLY a JSON object and nothing else.',
  'Use intent "search" to find existing records:',
  '  {"intent":"search","confidence":0.0-1.0,"explanation":"...","filters":{"q":"...","kinds":["entity"|"claim"|"note"|"source"],"type":"...","predicate":"...","tag":"...","confidenceMin":0.0,"confidenceMax":1.0}}',
  'Use intent "create" to propose new graph records:',
  '  {"intent":"create","confidence":0.0-1.0,"explanation":"...","changes":{"items":[{"op":"create_entity","ref":"<key>","type":"Person|Event|Concept|Place|Character","name":"..."}]}}',
  'All filter fields are optional. Set confidence low (below 0.4) when unsure so the app can fall back to plain search.',
].join('\n');

/**
 * LLM-backed interpreter. Prompts a real {@link LlmProvider} for strict JSON and
 * validates it with `commandInterpretationSchema`. On invalid output it issues
 * exactly ONE repair retry (AC4) that includes the validation error; if the
 * repair is also invalid the interpretation is discarded (`null`, AC3). Remote
 * providers are configured-but-untested skeletons in V1 (`verified: false`).
 */
export class LlmCommandInterpreter implements CommandInterpreter {
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

  async interpret(query: string): Promise<CommandInterpretation_Result> {
    const first = await this.llm.complete({
      messages: [
        { role: 'system', content: COMMAND_SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      temperature: 0,
    });
    const parsedFirst = parseCommandOutput(first.text);
    if (parsedFirst) return { interpretation: parsedFirst, repaired: false };

    // One repair retry (AC4): re-ask with the original output to fix.
    const repair = await this.llm.complete({
      messages: [
        { role: 'system', content: COMMAND_SYSTEM_PROMPT },
        { role: 'user', content: query },
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content:
            'That was not valid JSON for the command schema. Reply again with ONLY a single valid JSON object.',
        },
      ],
      temperature: 0,
    });
    const parsedRepair = parseCommandOutput(repair.text);
    return { interpretation: parsedRepair, repaired: parsedRepair !== null };
  }
}

/** Parse + validate raw LLM text into a command interpretation. Null if invalid. */
export function parseCommandOutput(raw: string): CommandInterpretation | null {
  const json = stripCodeFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = commandInterpretationSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? (fenced[1] as string) : text;
}

export interface InterpreterFactoryOptions {
  /** Whether the deterministic mock interpreter may be used at runtime. */
  allowDemo: boolean;
}

/** Build a {@link CommandInterpreter} from validated provider config. */
export function createInterpreterFromConfig(
  config: AiProviderConfig,
  options: InterpreterFactoryOptions,
): CommandInterpreter | null {
  if (config.kind === 'mock') {
    return options.allowDemo ? new MockCommandInterpreter(config.name) : null;
  }
  return new LlmCommandInterpreter(createLlmProvider(config), config);
}

/**
 * Resolve the configured command interpreter from the environment, or `null`
 * when no AI provider is configured (→ manual-search-only command box, AC1).
 * Reads `AI_PROVIDER_CONFIG` (JSON). The deterministic mock is only enabled when
 * `AI_DEMO_EXTRACTION=true` or outside production. Mirrors
 * `resolveExtractorFromEnv` (US-017). Any parse/build error resolves to `null`.
 */
export function resolveCommandInterpreterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CommandInterpreter | null {
  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return null;
  const allowDemo = env.AI_DEMO_EXTRACTION === 'true' || env.NODE_ENV !== 'production';
  try {
    const config = parseProviderConfig(JSON.parse(raw));
    return createInterpreterFromConfig(config, { allowDemo });
  } catch {
    return null;
  }
}

export { MOCK_EXTRACTION_LABEL };
