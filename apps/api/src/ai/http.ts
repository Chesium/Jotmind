import type { AiProviderKind } from '@jotmind/schemas';
import { AiProviderError } from './types.js';

/**
 * Small shared HTTP helper for the remote/local provider adapters. Uses the
 * global `fetch` (Node 18+). All adapters route through here so error handling
 * and JSON parsing are consistent.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  kind: AiProviderKind,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AiProviderError(
      `Failed to reach ${kind} provider at ${url}: ${(err as Error).message}`,
      kind,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiProviderError(
      `${kind} provider returned ${response.status}: ${detail.slice(0, 500)}`,
      kind,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new AiProviderError(
      `${kind} provider returned invalid JSON: ${(err as Error).message}`,
      kind,
      response.status,
    );
  }
}

/** Join a base URL and path without producing a double slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
