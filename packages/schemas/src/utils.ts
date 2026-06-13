import { z } from 'zod';

/**
 * Parse a value against a Zod schema, throwing a normalized error message on
 * failure. Shared utility usable by both web and API boundaries.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  return result.data;
}
