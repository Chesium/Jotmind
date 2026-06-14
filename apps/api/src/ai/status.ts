import { buildAiProviderStatus, type AiProviderStatus } from '@jotmind/schemas';
import { parseProviderConfig } from './factory.js';

/**
 * Resolve the sanitized {@link AiProviderStatus} from the environment (US-046).
 * Reads `AI_PROVIDER_CONFIG` (JSON) — the same env var as extraction/command/
 * answers/embeddings — and returns a display-safe status. Secrets (API keys) are
 * NEVER included (the shared builder only copies non-secret fields, AC4). Any
 * missing/invalid config resolves to `configured: false` rather than crashing.
 */
export function resolveAiProviderStatusFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderStatus {
  const raw = env.AI_PROVIDER_CONFIG;
  if (!raw) return buildAiProviderStatus(null);
  try {
    return buildAiProviderStatus(parseProviderConfig(JSON.parse(raw)));
  } catch {
    return buildAiProviderStatus(null);
  }
}
