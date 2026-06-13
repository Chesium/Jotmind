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

## Authentication (accounts & sessions)

- Auth lives in `apps/api/src/auth/`. Passwords use **Argon2id** via `@node-rs/argon2`
  (`password.ts`). NOTE: `Algorithm` is an ambient const enum and cannot be value-imported under
  `verbatimModuleSyntax` — reference it numerically (`Argon2id === 2`, `2 as Algorithm`).
- Routes are built by `createAuthRouter({ store })` (`auth/index.ts`) and mounted at `/api/auth` in
  `createApp`. Endpoints: `GET /setup-status`, `POST /setup` (first-run admin, 409 once any user
  exists), `POST /login`, `GET /me`, `POST /logout`, `POST /users` (admin-only account creation).
- **Testability pattern:** route handlers depend on an injectable `AuthStore` interface
  (`auth/store.ts`). Unit tests pass an in-memory fake (see `auth/auth.test.ts`) so they run with no
  DB; production uses `dbAuthStore` (lazy `getDb()` per call). `createApp({ authStore })` and
  `createApp({ checkDatabase })` are the two injection seams — follow this for future DB-backed routes.
- **Sessions** are PostgreSQL-backed (`sessions` table). Cookie names: `jm_session` (HTTP-only,
  `Secure` when `COOKIE_SECURE=true` or `NODE_ENV=production`, `SameSite=Lax`) and `jm_csrf`
  (readable). `cookieParser()` is mounted in `createApp`; read cookies via `req.cookies`.
- **CSRF** uses the synchronizer-token pattern: compare the `x-csrf-token` header against
  `session.csrfToken` (constant-time). Apply `requireCsrf` to all cookie-authenticated mutations.
- `req.auth` (`{ user, session }`) is attached by `requireAuth` via a global Express `Request`
  augmentation in `auth/index.ts`.
- DB-backed auth integration test (`auth/auth.integration.test.ts`) uses
  `describe.skipIf(!DATABASE_URL)` and TRUNCATEs `sessions, users` before/after.

## Knowledge Bases, roles & audit (US-004)

- Knowledge Bases are the top-level graph scope. Tables (`apps/api/src/db/schema.ts`):
  `knowledge_bases`, `knowledge_base_members` (composite PK `(knowledge_base_id, user_id)`,
  `role` text), and the append-only `audit_events` (nullable `knowledge_base_id`/`actor_user_id`,
  `action`, `target_type`, `target_id`, JSONB `metadata`). Later graph tables (US-005) carry
  `knowledge_base_id`.
- **KB roles are separate from system account roles.** System roles (`admin`/`member`, in
  `auth.ts`) gate server account creation; KB roles (`owner > admin > editor > viewer`, in
  `packages/schemas/src/knowledge-base.ts`) gate per-KB access. A `member` account can `own` a KB.
  Use `kbRoleSatisfies(role, required)` / `KB_ROLE_RANK` for "at least role X" checks.
- Routes: `createKnowledgeBaseRouter({ store, authStore })` mounted at `/api/knowledge-bases`
  (`apps/api/src/kb/index.ts`). `GET /` (list own), `POST /` (create → creator becomes owner),
  `GET /:id` (viewer+), `GET /:id/members` + `POST /:id/members` (admin+), `GET /:id/audit`
  (admin+). `requireKbRole(min)` loads the caller's membership for `:id` and returns **404** for
  non-members (hides existence) and 403 for insufficient role.
- Reuse the shared auth middleware exported from `auth/index.ts`: `requireAuth(authStore)`,
  `requireCsrf`, `asyncHandler`. All cookie-auth mutations need `requireCsrf`.
- Audit + membership writes happen in the **same DB transaction** as the canonical write (see
  `dbKnowledgeBaseStore.createKnowledgeBase`/`assignRole`). Record an `audit_events` row for every
  security-relevant mutation. Mirror this for US-005+ graph writes.
- `createApp` resolves `authStore` once and passes it to both the auth and KB routers; injection
  seams are now `{ checkDatabase, authStore, kbStore }`. Each DB-backed domain follows the
  injectable-store pattern (interface + `db<Domain>Store` + in-memory fake in tests).
- **DB integration tests share one database and TRUNCATE the same tables.** `apps/api` has a
  `vitest.config.ts` setting `fileParallelism: false` so parallel test files don't wipe each
  other's fixtures (FK violations). Keep it when adding more `*.integration.test.ts` files.

## Canonical graph schema (US-005)

- The relational tables in `apps/api/src/db/schema.ts` are the **canonical source
  of truth** for the graph; Apache AGE is a derived projection fed from
  `graph_outbox` (US-006). All writes go to the relational tables first.
- Graph tables: `schema_definitions`, `schema_versions`, `entities`, `claims`,
  `claim_arguments`, `notes`, `sources`, `source_excerpts`, `rule_definitions`,
  `proposals`, `jobs`, `graph_outbox` (+ pre-existing `audit_events`). Migration
  `drizzle/0003_massive_kronos.sql`.
- **Canonical graph records use UUIDv7 PKs** via the PG18-native `uuidv7()`
  default (`uuid('id').primaryKey().default(sql\`uuidv7()\`)`), NOT
`gen_random_uuid()`/`defaultRandom()`(which the older auth/KB tables use).
UUIDv7 is time-sortable (handy for outbox ordering) but is NOT a strict
sequence — process outbox by`(created_at, id)` and keep projection idempotent.
- Every canonical graph record has `knowledge_base_id` (FK, cascade), `created_at`/
  `updated_at` timestamptz, nullable `deleted_at` (**soft-delete** — all reads
  must filter `deleted_at IS NULL`; US-024 rule execution injects it), and
  `created_by` (FK users, set null). JSONB columns (`properties`/`metadata`/
  `provenance`/`spec`/`changes`/`payload`) default to `'{}'`/`'[]'`.
- Operational tables (`jobs`, `graph_outbox`) have NO soft-delete.
- KB-scoping is enforced at the **app layer** (`requireKbRole`); FKs are
  single-column (mirroring existing tables), not composite same-KB FKs.
- `entities.schema_version_id` / `claims.schema_version_id` are **nullable** so
  US-008/009 can create records before custom schemas (US-027) exist; they record
  the version a record was validated against. `entities.type` / `claims.predicate`
  are the conceptual string types used for cross-version search (US-028).
- Claims are multi-argument: `claim_arguments` rows are role-labeled and either an
  entity ref (`argument_kind='entity'`, `entity_id`) or a literal
  (`argument_kind='literal'`, `value` JSONB) — enforced by a check constraint. Do
  NOT reduce claims to binary edges.
- DB-level **check constraints** added via drizzle `check(name, sql\`...\`)`:
confidence 0..1, valid_start<=valid_end, span_start<=span_end, source_excerpt
origin (exactly one of note/source), entity not-self-merge, status enums.
**Partial unique indexes** (`.where(sql\`deleted_at IS NULL\`)`) let
  soft-deleted schema definitions / rules be recreated.
- **Custom-property validation hook** lives in `@jotmind/schemas`
  (`graph.ts` → `validateCustomProperties(propertySchema, properties)`); run it
  before writing JSONB `properties`. Built-in entity types + status enums also
  live there. `schema_versions.property_schema` stores the `PropertySchema`.
- New `*.integration.test.ts` files must TRUNCATE the tables they touch in
  before/after and rely on `fileParallelism:false` (see `vitest.config.ts`).

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
