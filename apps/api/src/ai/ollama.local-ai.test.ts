import { describe, expect, it } from 'vitest';
import { OllamaProvider } from './ollama.js';

/**
 * Manual local-inference verification (US-034 AC3).
 *
 * This file is EXCLUDED from `pnpm verify` — it is only run by the dedicated
 * `pnpm verify:local-ai` command and SKIPS entirely unless a running Ollama
 * endpoint is configured via `OLLAMA_BASE_URL`. This keeps routine loops / CI
 * from ever downloading or hitting a real local LLM.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434 \
 *   OLLAMA_LLM_MODEL=llama3 \
 *   OLLAMA_EMBEDDING_MODEL=nomic-embed-text \
 *   pnpm verify:local-ai
 */
const baseUrl = process.env.OLLAMA_BASE_URL;
const llmModel = process.env.OLLAMA_LLM_MODEL;
const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL;

describe.skipIf(!baseUrl)('manual local Ollama verification', () => {
  it('has at least one Ollama model configured', () => {
    expect(
      llmModel || embeddingModel,
      'Set OLLAMA_LLM_MODEL and/or OLLAMA_EMBEDDING_MODEL',
    ).toBeTruthy();
  });

  it.skipIf(!llmModel)(
    'completes a prompt against the local Ollama LLM',
    async () => {
      const provider = new OllamaProvider({
        name: 'Manual Ollama',
        baseUrl: baseUrl!,
        llmModel,
      });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Reply with a short health check.' }],
        temperature: 0,
        maxTokens: 32,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
    },
    60_000,
  );

  it.skipIf(!embeddingModel)(
    'embeds text against the local Ollama embedding model',
    async () => {
      const provider = new OllamaProvider({
        name: 'Manual Ollama',
        baseUrl: baseUrl!,
        embeddingModel,
      });
      const result = await provider.embed({ input: 'jotmind local ai check' });
      expect(result.embeddings).toHaveLength(1);
      expect(result.dimensions).toBeGreaterThan(0);
    },
    60_000,
  );
});
