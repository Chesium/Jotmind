# JotMind — Agent Guide

## Environment constraints

- Only **Node 18** is available in this environment. Pin tooling to Node-18-compatible versions:
  Vite 5, Vitest 2, ESLint 9, TypeScript 5.x. Latest pnpm requires Node 22, so use **pnpm 9**
  (`npm install -g pnpm@9`; npm global prefix is set to `~/.npm-global`, so ensure
  `~/.npm-global/bin` is on `PATH`).

## Monorepo structure

- pnpm workspace: `apps/*` and `packages/*` (see `pnpm-workspace.yaml`).
- `@jotmind/schemas` is the shared Zod schema/type/util package, consumed by both apps via
  `"workspace:*"`. Its `package.json` `exports`/`main` point at **TypeScript source** (`./src/index.ts`),
  not built `dist`. This lets `tsc` (with `moduleResolution: "Bundler"`) and Vite/Vitest resolve it
  directly without a build step.

## TypeScript conventions

- All tsconfigs extend `tsconfig.base.json` (strict, `verbatimModuleSyntax`, `isolatedModules`,
  `noUncheckedIndexedAccess`). Because of `verbatimModuleSyntax`, import types with
  `import { type Foo }` / `import type`.
- Relative imports use `.js` extensions (ESM + Bundler resolution) even for `.ts`/`.tsx` files.
- **Do NOT** add TS project `references` from apps to `packages/schemas`. Composite references make
  `tsc` resolve the dependency from unbuilt `dist/*.d.ts` and fail with TS6305. Rely on package
  `exports` → source instead.

## Database (PostgreSQL + AGE + pgvector)

- Canonical store is **PostgreSQL 18** with **Apache AGE** (graph) + **pgvector** (embeddings).
  Reference image: `infra/db/Dockerfile` (`FROM apache/age:latest`, which is PG 18 + AGE 1.7.0,
  then compiles pgvector). **pgvector must be ≥ v0.8.1** — earlier versions fail to build on PG 18
  (`vacuum_delay_point` signature change). Compose service: `docker compose up -d --build db`.
- **PG 18 Docker volume must mount at `/var/lib/postgresql`, NOT `/var/lib/postgresql/data`** — PG 18
  images use a version-specific subdir and refuse to start with a volume at the old `/data` path.
- Extensions are created two ways (both idempotent): the init script
  `infra/db/init/01-extensions.sql` (runs on first volume init) and the migrate runner
  (`apps/api/src/db/migrate.ts`) which runs `CREATE EXTENSION IF NOT EXISTS age/vector` before
  Drizzle migrations. AGE may already exist on the base image's default DB.
- ORM is **Drizzle** (`drizzle-orm` + `postgres` driver, `drizzle-kit`). Schema in
  `apps/api/src/db/schema.ts`; `pnpm --filter @jotmind/api db:generate` writes SQL to
  `apps/api/drizzle/`; `pnpm --filter @jotmind/api db:migrate` applies them. Commit generated
  `drizzle/` files (SQL + `meta/`).
- DB access is gated on `DATABASE_URL`. When unset, `checkDatabaseHealth()` returns
  `configured: false` and `/api/health` stays `ok` — keep this graceful behavior so unit tests and
  AI-disabled runs don't need a live DB.
- Tests needing a live DB use `describe.skipIf(!process.env.DATABASE_URL)` (see
  `apps/api/src/db/db.integration.test.ts`) so default `pnpm test:api` stays green; run them with
  `DATABASE_URL=... pnpm --filter @jotmind/api test` against the compose DB.

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
