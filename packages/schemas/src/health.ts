import { z } from 'zod';

/**
 * Availability of the PostgreSQL extensions JotMind relies on.
 * `age` is Apache AGE (graph) and `vector` is pgvector (embeddings).
 */
export const databaseExtensionsSchema = z.object({
  age: z.boolean(),
  vector: z.boolean(),
});

export type DatabaseExtensions = z.infer<typeof databaseExtensionsSchema>;

/**
 * Reported state of the canonical PostgreSQL store and its required extensions.
 * `configured` is false when no DATABASE_URL is set (e.g. unit-test runs).
 */
export const databaseHealthSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  extensions: databaseExtensionsSchema,
  error: z.string().optional(),
});

export type DatabaseHealth = z.infer<typeof databaseHealthSchema>;

/**
 * Shared health-check response schema, imported by both the API (to validate
 * outgoing responses) and the web app (to validate incoming responses).
 *
 * `database` is optional so older/lightweight callers (and unit-test mocks)
 * remain valid; the API populates it with connectivity + extension status.
 */
export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
  database: databaseHealthSchema.optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
