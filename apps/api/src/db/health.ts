import type { DatabaseHealth } from '@jotmind/schemas';
import { getDatabaseUrl, getSqlClient } from './client.js';

const REQUIRED_EXTENSIONS = ['age', 'vector'] as const;

/**
 * Probe the canonical PostgreSQL store for connectivity and the presence of the
 * required extensions (Apache AGE + pgvector).
 *
 * When DATABASE_URL is not configured this reports `configured: false` rather
 * than failing, so lightweight/unit-test runs still get a healthy response.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  if (!getDatabaseUrl()) {
    return {
      configured: false,
      connected: false,
      extensions: { age: false, vector: false },
    };
  }

  try {
    const client = getSqlClient();
    const rows = await client<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('age', 'vector')
    `;
    const present = new Set(rows.map((r) => r.extname));
    return {
      configured: true,
      connected: true,
      extensions: {
        age: present.has('age'),
        vector: present.has('vector'),
      },
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      extensions: { age: false, vector: false },
      error: err instanceof Error ? err.message : 'Unknown database error',
    };
  }
}

/** True when the database is either not configured, or fully healthy. */
export function isDatabaseHealthy(db: DatabaseHealth): boolean {
  if (!db.configured) return true;
  return db.connected && REQUIRED_EXTENSIONS.every((ext) => db.extensions[ext]);
}
