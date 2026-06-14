/**
 * Deterministic test-database reset for Playwright critical-flow e2e (US-034
 * AC4). TRUNCATEs every public table so the real-API e2e run starts from a
 * clean state (first-run setup visible, no leftover KBs/records).
 *
 * Destructive — double-guarded: requires both `DATABASE_URL` and an explicit
 * `JOTMIND_ALLOW_DB_RESET=true` so it can never silently wipe a real database.
 * Invoked by `pnpm --filter @jotmind/api db:reset:test`.
 */
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for db:reset:test');
}
if (process.env.JOTMIND_ALLOW_DB_RESET !== 'true') {
  throw new Error('Refusing to reset database without JOTMIND_ALLOW_DB_RESET=true');
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const tables = await sql<{ ident: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS ident
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '__drizzle_migrations'
  `;

  if (tables.length > 0) {
    await sql.unsafe(`TRUNCATE TABLE ${tables.map((t) => t.ident).join(', ')} CASCADE`);
  }
  console.log(`[jotmind-api] reset ${tables.length} public table(s)`);
} finally {
  await sql.end();
}
