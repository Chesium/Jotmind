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

## Graph outbox & projection seam (US-006)

- Apache AGE is a **derived projection**; the relational tables are canonical.
  All entity/claim/note/source writes go through `apps/api/src/graph/store.ts`
  (`dbGraphWriteStore`): each `create*` writes the canonical row(s) **and** a
  `graph_outbox` event in the **same transaction** via `enqueueGraphOutbox(tx,
…)` (`graph/outbox.ts`). US-008/009/011 build their create flows on this store —
  do NOT write canonical graph rows without enqueuing the matching outbox event in
  the same tx. Outbox `event_type` is `"<targetType>.<eventType>"` (e.g.
  `entity.created`); use `outboxEventType()`.
- The projection pipeline lives in `graph/projector.ts`: a `Projector` interface
  (`name`, `stubbed`, `project(event)`), the default `stubProjector` (logs, does
  NOT write to AGE yet), `processOutbox()` (drains pending events in
  `(created_at, id)` order — UUIDv7 is sortable but not a strict sequence —
  marking each `processed`/`failed`), `rebuildProjection()` (repair: reprojects
  every non-deleted canonical record straight from the relational tables,
  bypassing the outbox), and `getProjectionStatus()`. Both `processOutbox` and
  `rebuildProjection` default to `dbProjectionStore` + `stubProjector`; inject a
  fake `ProjectionStore`/`Projector` for unit tests.
- The stubbed state must stay visible: `createApp` logs the stub notice **once
  per process** (guarded by a module flag in `app.ts` so tests aren't flooded)
  and `GET /api/graph/projection/status` returns `projector.stubbed`. When you
  add the real AGE projector, set `stubbed: false` and replace `stubProjector`
  in `createApp`'s default.
- Routes (`graph/index.ts`, mounted at `/api/graph` in `createApp`):
  `GET /projection/status` (any authed user), `POST /projection/process` and
  `POST /projection/rebuild` (system **admin** only + `requireCsrf`). `requireAdmin`
  is now exported from `auth/index.ts` for reuse. `createApp` seams are now
  `{ checkDatabase, authStore, kbStore, projectionStore, projector }`.

## Durable jobs & worker (US-007)

- The `jobs` table (`apps/api/src/db/schema.ts`) is the durable queue; jobs are
  operational state (no soft-delete). Access goes through `apps/api/src/jobs/`:
  `store.ts` (`JobStore` interface + `dbJobStore`), `worker.ts` (run/retry/loop
  logic), `index.ts` (`createJobsRouter` + re-exports), `handlers.ts`
  (`defaultJobHandlers` registry), `worker-process.ts` (separate-process entry).
- **Atomic claim:** `dbJobStore.claimNext()` selects the oldest runnable
  (`status='queued'`, `runAfter <= now`) row with `FOR UPDATE SKIP LOCKED` inside
  a transaction, then sets `status='running'` and increments `attempts`. This
  lets multiple workers (in-process + separate-process) run safely without
  double-claiming. `claimNext` increments attempts, so `job.attempts` inside a
  handler/`runNextJob` already counts the current attempt.
- **Retry/backoff:** `runNextJob` runs the registered handler for `job.type`; on
  throw it dead-letters (`markFailed`, terminal `status='failed'`) when
  `attempts >= maxAttempts`, else re-queues via `markForRetry` with
  `runAfter = now + computeBackoffMs(attempts)` (capped exponential, base 1s,
  cap 5min). Missing handler → immediate dead-letter (`no-handler`). Register new
  job types in `defaultJobHandlers`.
- **Run modes:** separate-process via `pnpm --filter @jotmind/api worker`
  (`runWorkerLoop`, polls `WORKER_POLL_INTERVAL_MS`, graceful SIGINT/SIGTERM);
  in-process via `startInProcessWorker` (server.ts starts it when
  `WORKER_INLINE=true`). All modes share `runNextJob`.
- **API:** `GET /api/jobs` (list, `?status`/`?knowledgeBaseId`/`?limit`),
  `GET /api/jobs/stats` (per-status counts), `GET /api/jobs/:id` — all system
  **admin** only (read-only, no CSRF). `createApp` seams are now
  `{ checkDatabase, authStore, kbStore, projectionStore, projector, jobStore }`.
- Job API/worker logic is unit-tested with an in-memory `JobStore` fake (inject a
  fixed `now: () => Date` for deterministic backoff assertions); the
  `*.integration.test.ts` uses `skipIf(!DATABASE_URL)` and TRUNCATEs
  `jobs, knowledge_bases, users`.

## Entities (manual create/edit, US-008)

- Entity CRUD lives in `apps/api/src/entities/`: `store.ts` (`EntityStore`
  interface + `dbEntityStore`) and `index.ts` (`createEntityRouter`). Mounted at
  **`/api/knowledge-bases/:kbId/entities`** with `Router({ mergeParams: true })`
  so the parent `:kbId` is visible. `createApp` seam is `entityStore`.
- Mount order: the entity router is registered AFTER the KB router. The KB router
  (`/api/knowledge-bases`) has no `/:id/entities` route, so it falls through to
  the more specific entities mount — keep this ordering when adding nested KB
  routers.
- **Role gating mirrors the KB router**: reads (`GET /`, `GET /:entityId`)
  require `viewer`; mutations (`POST /`, `PATCH /:entityId`) require `editor`
  (so viewers are read-only) + `requireCsrf`. The router's local `requireKbRole`
  calls `kbStore.getRole(kbId, userId)` and returns **404 for non-members**
  (hides existence), 403 for insufficient role.
- **Entity writes emit audit + graph outbox events in the SAME transaction** as
  the canonical `entities` row (`dbEntityStore.createEntity`/`updateEntity`):
  `enqueueGraphOutbox(tx, …)` + an `audit_events` insert (`entity.created`/
  `entity.updated`). This is the pattern for all US-009+ canonical graph writes —
  note `dbGraphWriteStore` (graph/store.ts) does outbox but NOT audit; entity/
  claim writes need both. Reads filter `deleted_at IS NULL`.
- Shared entity Zod shapes are in `@jotmind/schemas` (`graph.ts`): `entitySchema`,
  `entityListSchema`, `createEntitySchema` (type+name required), `updateEntitySchema`
  (all-optional, `.refine` requires ≥1 field, nullable `description`). Built-in
  types: `BUILTIN_ENTITY_TYPES`.
- Web: `apps/web/src/api.ts` (`listEntities`/`createEntity`/`updateEntity`) +
  the `<Entities>` component in `App.tsx` (rendered when a KB is selected; uses
  `kbRoleSatisfies(kb.role, 'editor')` to show the form vs a read-only notice).
  Custom properties are entered as a JSON object string; aliases/tags are
  comma-separated inputs.

## Claims (manual create/edit, US-009)

- Claim CRUD lives in `apps/api/src/claims/`: `store.ts` (`ClaimStore`
  interface + `dbClaimStore`, returns `ClaimWithArguments` = `ClaimRow` +
  `arguments: ClaimArgumentRow[]`) and `index.ts` (`createClaimRouter`). Mounted
  at **`/api/knowledge-bases/:kbId/claims`** (`mergeParams: true`), AFTER the KB
  router. `createApp` seam is `claimStore`. Role gating / 404-for-non-members /
  CSRF mirror the entity router exactly.
- **Claims are multi-argument, NOT binary edges.** A claim row carries
  `predicate` + optional `description`/`confidence`/`validStart`/`validEnd`/
  `properties`; its role-labeled arguments live in the separate `claim_arguments`
  table. `dbClaimStore.createClaim` inserts the claim AND its arguments (with
  sequential `position`) in ONE transaction, plus `enqueueGraphOutbox(tx, …)`
  (`claim.created`) and an `audit_events` insert — same dual outbox+audit pattern
  as entities. `updateClaim` updates metadata and, when `fields.arguments` is
  present, **replaces the full argument set** (hard-delete old rows + reinsert) so
  argument roles/order can be edited; emits `claim.updated`.
- Each argument is either `argumentKind:'entity'` (`entityId` set, `value` null)
  or `argumentKind:'literal'` (`value` JSONB set, `entityId` null) — enforced by
  the `claim_arguments_kind_check` DB constraint. Literal SQL NULL is rejected by
  that constraint.
- Shared Zod shapes in `@jotmind/schemas` (`graph.ts`): `claimSchema` (includes
  `arguments`), `claimListSchema`, `createClaimArgumentSchema` (`.superRefine`:
  entity needs `entityId`+no `value`, literal needs `value`+no `entityId`;
  `argumentKind` defaults to `'entity'`), `createClaimSchema` (predicate + ≥1
  argument required, `.refine` validStart≤validEnd), `updateClaimSchema`
  (all-optional, ≥1 field, optional arguments-replace with ≥1 item). The store's
  `value` columns are `z.unknown()` (JSONB).
- Web: `apps/web/src/api.ts` (`listClaims`/`createClaim`/`updateClaim`) + the
  `<Claims>` component in `App.tsx` (rendered after `<Entities>` for the selected
  KB). It fetches BOTH claims and entities (entity dropdowns for entity args).
  **Gotcha:** `<Claims>` only refetches entities when `kb.id` changes, so
  entities created in `<Entities>` won't appear in the claim form until a reload
  — acceptable for now; revisit if live cross-component sync is needed.

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
