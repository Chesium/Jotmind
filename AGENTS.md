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
- Routes: `createKnowledgeBaseRouter({ store, authStore, jobStore })` mounted at
  `/api/knowledge-bases` (`apps/api/src/kb/index.ts`). `GET /` (list own), `POST /` (create →
  creator becomes owner), `GET /:id` (viewer+), `GET /:id/members` + `POST /:id/members` (admin+),
  `GET /:id/audit` (admin+), `GET /:id/jobs` (admin+, KB-scoped job status — reuses `jobStore.list`
  - `toPublicJob` from `jobs/index.ts`). `requireKbRole(min)` loads the caller's membership for
    `:id` and returns **404** for non-members (hides existence) and 403 for insufficient role.
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

## Delete & merge (US-010)

- **All graph deletes are soft-deletes.** `dbEntityStore.deleteEntity` /
  `dbClaimStore.deleteClaim` set `deletedAt` (never `DELETE`), emit a
  `<target>.deleted` outbox event + an `entity.deleted`/`claim.deleted` audit row
  in one transaction. Deleting a claim also soft-deletes its `claim_arguments`.
  Re-deleting an already-deleted record returns `undefined` (→ 404). Mirror this
  for notes/sources when US-011 adds their stores.
- **Entity merge = Archive & Pointer** (`dbEntityStore.mergeEntities`): the
  source is soft-deleted with `merged_into_id` → survivor (NO compound graph
  node). Survivor absorbs source aliases/tags (set-union) + the source's display
  name as an alias; properties merge with **target winning** on key conflicts.
  Claims referencing the source are retargeted (`claim_arguments.entity_id`
  source→target) and each affected claim appends the archived id to
  `provenance.historical_source_entities` (dedup). Emits `entity.updated`
  (survivor) + `entity.deleted` (source) + `claim.updated` per retargeted claim,
  and one `entity.merged` audit row — all in one tx.
- `mergeEntities` returns a discriminated `MergeEntitiesResult`
  (`{ok:true,entity,retargetedClaimCount}` | `{ok:false,reason}`); the router
  maps `same_entity`→400, `source_not_found`/`target_not_found`→404.
- Routes (entity router): `DELETE /:entityId` (editor+CSRF), `POST
/:entityId/merge` (editor+CSRF, body `{targetId}` via `mergeEntitySchema`),
  `GET /:entityId/impact` (viewer) → `{claims:[{id,predicate}]}` for delete/merge
  confirmation dialogs (AC2). Claim router: `DELETE /:claimId` (editor+CSRF).
  Viewers get 403 on all mutations; non-members 404.
- Web (`App.tsx`): entity rows have Edit/Delete + a "Merge into" survivor
  `<select>` + Merge button; claim rows have Edit/Delete. Delete/merge call
  `getEntityImpact` first and `window.confirm` with the affected-claim summary.
- Shared shapes in `@jotmind/schemas` `graph.ts`: `mergeEntitySchema`,
  `entityImpactSchema`/`entityImpactClaimSchema`. The `entities.merged_into_id`
  column + `claims.provenance` JSONB already existed from US-005 (no migration).

## Notes, Sources & Citations (capture, US-011)

- Three new domains mirror the entity/claim store+router pattern exactly:
  `apps/api/src/notes/`, `apps/api/src/sources/`, `apps/api/src/source-excerpts/`
  (each: `store.ts` interface + `db<Domain>Store`, `index.ts` router, in-memory
  fake unit test). Mounted at `/api/knowledge-bases/:kbId/{notes,sources,
source-excerpts}` (`mergeParams:true`, AFTER the KB router). `createApp` seams
  added: `noteStore`, `sourceStore`, `sourceExcerptStore`. No DB migration —
  the `notes`/`sources`/`source_excerpts` tables already existed from US-005.
- **Notes & Sources are canonical graph records** (`note`/`source` are in
  `GRAPH_TARGET_TYPES`): writes emit a `graph_outbox` event AND an `audit_events`
  row in one tx (same dual pattern as entities/claims). No AI provider is needed
  to capture — these are plain relational writes.
- **Source Excerpts are NOT a graph projection target.** Their writes emit
  `audit_events` ONLY (no outbox) — do not call `enqueueGraphOutbox` for them.
  An excerpt references EXACTLY ONE origin (`noteId` XOR `sourceId`, enforced by
  the `source_excerpts_origin_check` DB constraint + Zod `superRefine`) and
  optionally cites a `claimId` it supports. The store validates that the origin
  note/source AND any linked claim exist in the SAME KB, returning a
  discriminated `SourceExcerptResult` (`{ok:false, reason}` → router maps to 404).
- **Linked-claim display (AC4):** `dbSourceExcerptStore` returns
  `SourceExcerptWithClaim` (excerpt row + `claim:{id,predicate}|null`); the list
  endpoint accepts `?noteId=/?sourceId=/?claimId=` filters. The web composes
  note/source "views" by filtering the excerpts list client-side per origin id —
  no dedicated detail endpoint. Schemas: `sourceExcerptViewSchema` (extends
  `sourceExcerptSchema` with `claim`), `noteSchema`/`sourceSchema` +
  create/update in `@jotmind/schemas` `graph.ts`.
- Web: `<Capture>` component in `App.tsx` (rendered after `<Claims>` for the
  selected KB) holds Notes + Sources + per-item citation forms. Like `<Claims>`,
  it fetches claims for the citation dropdown but only refetches on `kb.id`
  change — claims created in `<Claims>` won't appear in the citation dropdown
  until reload (same cross-component-sync gotcha).

## Manual search & filters (US-012)

- Search lives in `apps/api/src/search/`: `store.ts` (`SearchStore` interface +
  `dbSearchStore`) and `index.ts` (`createSearchRouter`). Mounted at
  **`/api/knowledge-bases/:kbId/search`** (`Router({ mergeParams: true })`,
  AFTER the KB router). `createApp` seam is `searchStore`. Single endpoint
  `GET /` requires **viewer** (search is a read; respects KB permissions, AC3);
  non-members get 404 to hide existence. NO AI provider needed — pure
  relational token search.
- **Token search** unions four per-kind queries (entities, claims, notes,
  sources), each filtering `deleted_at IS NULL` + `knowledge_base_id`. Tokens
  are whitespace-split and **AND-matched**; each token must ILIKE at least one
  searchable column. JSONB columns (`aliases`/`tags`/`properties`/`provenance`/
  `metadata`) are searched by casting `::text` (so array/object contents match).
  Results are merged, sorted by `createdAt` desc, capped at `limit` (default 50).
- **Filters narrow which kinds can match** (`resolveKinds`): `type`/`tag` →
  entities only; `predicate`/`confidenceMin`/`confidenceMax`/`hasProvenance` →
  claims only; an impossible combo yields no results. `dateFrom`/`dateTo` filter
  `createdAt` on every kind. `tag` uses JSONB containment
  (`tags @> '["x"]'::jsonb`, exact match). `hasProvenance` = `provenance <> '{}'`.
- **Vector search availability (AC4):** `getVectorSearchAvailability()` checks
  `information_schema.tables` for an `embeddings` table. It does not exist yet,
  so the endpoint returns `vectorSearch.available:false` with a reason and token
  search still works. When a later story adds embeddings, this flips to true.
- Shared shapes in `@jotmind/schemas` `search.ts`: `searchQuerySchema` (coerces
  numeric/boolean query-string params; `hasProvenance` accepts `'true'`/`'false'`
  and transforms to boolean; refines `confidenceMin <= confidenceMax`),
  `searchResultSchema`/`searchResponseSchema`. The router parses `kinds` as a CSV
  via `parseKinds` (drops unknown kinds).
- Web: `apps/web/src/api.ts` (`search()`) + the `<Search>` component in
  `App.tsx` (rendered first when a KB is selected). It builds a `URLSearchParams`
  from the filter form and renders the unified result list plus the
  vector-unavailable notice.

## Graph views (US-013)

- US-013 is **frontend-only** — all data comes from existing endpoints
  (`listEntities`/`listClaims`/`listNotes`/`listSources`/`listSourceExcerpts`),
  no new API or schema. The big `App.tsx` (~1.7k lines) was getting unwieldy, so
  this lives in its own file `apps/web/src/GraphViews.tsx` and is imported into
  `<KnowledgeBases>` (rendered first when a KB is selected, before `<Search>`).
  Put further large web components in their own files too.
- `<GraphViews>` owns ONE shared `selected` Selection (`{kind, id}`) so all
  views navigate to the same detail/source context. Five views, switched by a
  tablist: **Network** (dependency-free SVG circular layout — entities on a
  circle, claim entity-arguments drawn as edges labeled by predicate),
  **Timeline** (claims by `validStart ?? createdAt`, notes by `createdAt`,
  `Event`-typed entities — newest first), **Table** (entities/claims toggle,
  sortable column-header buttons, text filter, tag filter), **Detail** (selected
  entity/claim → related claims + citations + inline-editable entity metadata via
  `updateEntity`), and **Sources & Notes** (original note/source content + linked
  claims from excerpts). Clicking entities/claims/tags/citations calls
  `navigate`/`navigateTag`.
- **Cross-component sync gotcha (same as `<Claims>`/`<Capture>`):** `<GraphViews>`
  fetches its data once per `kb.id`, so entities/claims created in the sibling
  `<Entities>`/`<Claims>`/`<Capture>` sections won't appear until the KB is
  re-selected (reload + reselect). Browser tests must reload+reselect after
  creating records.
- **Testid collisions across sections:** `<Capture>` already uses
  `sources-empty`; `<GraphViews>` reuses it too. Scope Playwright/RTL queries to
  `getByTestId('graph-views')` (or a table row) when a testid isn't unique
  page-wide. Network/table rows use `data-testid="network-node-<id>"` /
  `table-row-<id>`; view tabs are `view-tab-{network,timeline,table,sources}`.

## Audit & permissions in graph flows (US-014)

- US-014 is mostly a **consolidation/enforcement** story — audit + role gating
  were already added per-domain (US-004–013). Every security-relevant mutation
  (entity/claim/note/source create/update/delete, entity merge, KB role
  assignment) already writes an `audit_events` row with `actorUserId` in the
  same tx as the canonical write. Viewers are read-only everywhere (mutations
  require `editor`+`requireCsrf`; reads require `viewer`). When adding NEW
  mutating flows (proposals/imports/settings in later stories) follow the same
  pattern so this stays true.
- **KB-scoped job status:** `GET /api/knowledge-bases/:id/jobs` (admin+) lets KB
  admins/owners inspect background jobs for their KB without a system-admin
  account (system-wide `/api/jobs` is still admin-only). It injects `jobStore`
  into the KB router and reuses `jobStore.list({knowledgeBaseId})` + `toPublicJob`.
- Web admin panel: `apps/web/src/KbAdmin.tsx` (own file, imported into
  `<KnowledgeBases>` after `<Capture>`) renders the audit summary + job status,
  gated by `kbRoleSatisfies(kb.role, 'admin')` (returns null for non-admins).
  API client helpers `listKbAudit`/`listKbJobs` are in `apps/web/src/api.ts`.

## AI provider adapter layer (US-015)

- ALL AI integrations sit behind typed adapters in `apps/api/src/ai/`; UI and
  graph repositories must never import a vendor SDK directly. Interfaces:
  `LlmProvider` (`complete(req)`) and `EmbeddingProvider` (`embed(req)` +
  `dimensions`), both extending `AiProvider` (`name`/`kind`/`capabilities`) in
  `ai/types.ts`. Build adapters via the factory (`ai/factory.ts`):
  `createLlmProvider(config)` / `createEmbeddingProvider(config)` switch on
  `config.kind`. `parseProviderConfig(input)` validates raw input first.
- Provider kinds (`@jotmind/schemas` `ai.ts` `AI_PROVIDER_KINDS`): `ollama`
  (local, no creds), `openai-compatible` (local servers OR remote OpenAI-shaped
  endpoints, `apiKey` optional), `openai` (remote, `apiKey` REQUIRED by config
  validation), `anthropic` (remote, LLM-only — `createEmbeddingProvider` THROWS),
  `mock` (deterministic, used by normal tests). `openai` reuses
  `OpenAiCompatibleProvider` (same REST shape). HTTP adapters use global `fetch`
  via `ai/http.ts` `postJson`; failures throw `AiProviderError`.
- **Secrets are separated from portable config (AC4).** Config schemas are a Zod
  `discriminatedUnion('kind', ...)`. Two variants per kind: a _portable_ schema
  (safe to export) and a _full_ schema that `.extend`s secret fields. The secret
  field list is `AI_PROVIDER_SECRET_FIELDS` (currently `['apiKey']`).
  `toPortableProviderConfig(config)` strips secrets AND re-parses against
  `portableAiProviderConfigSchema` (parse drops unknown keys, so a leaked secret
  cannot round-trip). When adding a new secret-bearing field, add it to
  `AI_PROVIDER_SECRET_FIELDS` so it is stripped from KB exports.
- **Normal tests use the mock providers, never the network** (AC5):
  `MockLlmProvider` echoes a stable `mock-response: <last user msg>`;
  `MockEmbeddingProvider` hashes (FNV-1a) inputs to fixed-dimension vectors —
  same input ⇒ same vector. HTTP adapters are unit-tested by
  `vi.spyOn(globalThis, 'fetch')` returning a `Response`; no live endpoint. No
  DB, no migration, no router for this story — later stories (US-016 privacy
  settings, US-021 embeddings, US-017/018 proposals) consume this layer.

## Layered AI privacy policy (US-016)

- AI usage is gated by THREE policy layers — `server` / `knowledge_base` / `user`
  — evaluated **strictest-policy-wins** (`@jotmind/schemas` `ai.ts`:
  `resolveAiPolicy(policies)`, `AI_POLICY_MODE_RANK`). Modes (least→most
  permissive): `off` < `local_only` < `remote_per_request` < `remote_always`.
  Fresh installs (no rows) resolve to `off`/No AI via `DEFAULT_AI_POLICY` (AC1).
  **Pass a missing applicable layer as `DEFAULT_AI_POLICY`, NOT omitted** — omit
  a layer only when it does not apply (e.g. non-KB calls skip the KB layer).
- `remoteEmbeddings` is a SEPARATE per-layer consent (AC4): even when the mode
  allows remote, `resolveAiPolicy` only sets `remoteEmbeddingsAllowed` when
  remote is allowed AND **every** applicable layer has `remoteEmbeddings: true`.
- DB: single `ai_policies` table (`apps/api/src/db/schema.ts`, migration
  `drizzle/0004_glamorous_jocasta.sql`). One row per layer: `scope='server'` →
  `scopeId IS NULL` (partial unique index `ai_policies_server_uq` enforces a
  single server row); `scope IN ('knowledge_base','user')` → `scopeId` set
  (partial unique `ai_policies_scope_scope_id_uq`). Check constraints validate
  scope/mode enums + the scope↔scopeId-null relationship. NO soft-delete.
- Store/router follow the injectable-store pattern: `ai-policy/store.ts`
  (`AiPolicyStore` interface + `dbAiPolicyStore`; `getPolicy` returns
  `DEFAULT_AI_POLICY` when no row), `ai-policy/index.ts` (`createAiPolicyRouter`
  mounted at `/api/ai`, `createAiPolicyKbRouter` mounted at
  `/api/knowledge-bases/:kbId/ai/policy` AFTER the KB router). `createApp` seam:
  `aiPolicyStore`. `updatePolicy` UPSERTs the row + writes an `audit_events`
  (`ai_policy.updated`) row in the SAME tx.
- Routes: `GET /api/ai/policy/server` (any authed), `PUT` (system admin+CSRF);
  `GET|PUT /api/ai/policy/me` (self, CSRF on PUT); `GET /api/ai/policy`
  (effective server+user). KB router: `GET /` (viewer), `PUT /` (KB admin+CSRF),
  non-members get 404. `updateAiPolicySchema` rejects empty payloads.
- Confirmation/audit helpers for FUTURE remote calls live in `ai.ts`:
  `remoteCallConfirmationSchema` (provider/model/feature/contentCategories, AC5)
  and `buildRemoteAiAuditMetadata()` — an **allowlist** builder so full prompts /
  note content / API keys / model responses can NEVER leak into audit (AC6). All
  future remote-AI call sites (US-017/020) MUST record audit via this helper and
  show a confirmation built from `remoteCallConfirmationSchema`.
- Web: `apps/web/src/AiPolicySettings.tsx` (own file) exports `<AiPolicySettings>`
  (server+user layers, server editable only when `isAdmin`; rendered in
  `AuthedHome`) and `<KbAiPolicy>` (KB layer, editable when
  `kbRoleSatisfies(kb.role,'admin')`; rendered in the selected-KB section). Both
  show the effective resolved policy. API client helpers in `api.ts`:
  `getAiPolicyOverview`/`updateServerAiPolicy`/`updateMyAiPolicy`/`getKbAiPolicy`/
  `updateKbAiPolicy`.

## Quick-capture & AI proposal queue (US-017)

- **Proposals never mutate canonical records** — they sit in a review queue
  (`proposals` table, from US-005) until accepted (US-018). Creating one records
  an `audit_events` (`proposal.created`) row but **no** `graph_outbox` event
  (proposals are NOT a graph projection target). `apps/api/src/proposals/`:
  `store.ts` (`ProposalStore` + `dbProposalStore`, reads filter
  `deleted_at IS NULL`), `index.ts` (two routers + `toProposal` mapper).
- Two routers, both `mergeParams:true`, mounted AFTER the KB router:
  `createProposalRouter` at `/api/knowledge-bases/:kbId/proposals` (`GET /`,
  viewer+, `?status`/`?sourceNoteId`/`?sourceSourceId` filters) and
  `createCaptureRouter` at `/api/knowledge-bases/:kbId/capture` (`POST /`,
  editor+CSRF). `createApp` seams: `proposalStore`, `extractor`.
- **Capture order matters (AC1):** `POST /capture` stores the text as a Note or
  Source FIRST (so original material is never lost), THEN resolves AI
  availability and runs extraction. The response (`captureResponseSchema`)
  always includes the stored `note`/`source` plus an `extraction` result with
  `status` ∈ `created|empty|unavailable|error` so a No-AI or failed extraction
  never blocks capture (AC4).
- **Extraction sits behind the `GraphExtractor` interface** (`extraction/index.ts`,
  mirrors the US-015 AI adapter layer — never call a vendor SDK directly).
  `MockGraphExtractor` is deterministic demo output (`demo:true`,
  `verified:true`); `LlmGraphExtractor` wraps an `LlmProvider`, prompts for
  strict JSON validated by `proposalChangesSchema` (invalid output → `[]`, no
  repair retry until US-019). Remote providers (`openai`/`anthropic`, via
  `isRemoteProviderKind`) are configured-but-untested skeletons (`verified:false`,
  AC3). `resolveExtractorFromEnv` builds the extractor from `AI_PROVIDER_CONFIG`
  (JSON), returning `null` when unset (No-AI). The mock is only enabled when
  `AI_DEMO_EXTRACTION=true` or `NODE_ENV!=='production'` (dev/demo flag, AC6).
- **Availability = configured extractor AND policy permits it.**
  `computeExtractionAvailability(extractor, resolved)` reads the resolved AI
  policy (`resolveAiPolicy` over server+user+KB layers, strictest-wins from
  US-016): unavailable when no extractor, `mode==='off'`, or a remote extractor
  without `remoteAllowed`. Demo output carries `MOCK_EXTRACTION_LABEL`
  (`'Mock AI / deterministic demo output'`) which the UI must show (AC6).
- Shared shapes in `@jotmind/schemas` `proposals.ts`: `proposalChangesSchema`
  (`{items:[create_entity|create_claim]}` discriminated union; claim args
  reference candidate entities by a temporary local `ref` key or an existing
  entity id), `proposalSchema`/`proposalListSchema`, `captureRequestSchema`,
  `captureResponseSchema`, `extractionAvailabilitySchema`. Exported from
  `index.ts`.
- Web: `apps/web/src/Proposals.tsx` (`<Proposals>`, rendered after `<Capture>`
  for the selected KB) — quick-capture form + pending-proposal list showing each
  candidate change, the demo label, and (for editors) review controls. API
  client helpers in `api.ts`: `quickCapture`/`listProposals`.

## Review & apply proposals (US-018)

- **The proposal router (not the store) applies accepted changes.** Accepting a
  proposal runs `applyProposalChanges` (in `proposals/index.ts`) which calls the
  injected `entityStore.createEntity` / `claimStore.createClaim` — so each
  created record goes through the normal canonical write path (outbox + audit in
  one tx). The `ProposalStore` only mutates the proposal row
  (`updateProposalChanges`, `reviewProposal`). `createProposalRouter` now takes
  `entityStore`/`claimStore` options (wired in `app.ts`); inject in-memory fakes
  for unit tests.
- Endpoints (all `editor` + `requireCsrf`; viewers are read-only): `PATCH
/:proposalId` (replace `changes`, re-validated by `proposalChangesSchema` so
  invalid payloads can't be saved/executed — AC4), `POST /:proposalId/accept`
  (body `{ itemIndexes?, note? }`; default = whole batch, `itemIndexes` =
  item-level subset — AC2), `POST /:proposalId/reject` (body `{ reason?,
dismiss? }`; sets `rejected`/`dismissed`, proposal stays linked to its source).
  `reviewProposal`/`updateProposalChanges` only act on `status='pending'` rows
  (else `undefined` → 404/409), so a proposal can't be reviewed twice.
- **Apply order + ref resolution:** create-entity items first (mapping each
  local `ref` → new id), then create-claim items. A claim entity-arg `ref` that
  isn't a created entity is treated as an existing entity id and is **pre-checked
  via `entityStore.getEntity`** before any mutation; an unresolved ref aborts the
  whole accept with 422 (invalid payloads cannot execute, AC4). Accept also
  re-parses the stored `proposal.changes` with `proposalChangesSchema` first.
- **Accepted-claim provenance (AC3):** `dbClaimStore.createClaim` now accepts an
  optional `provenance` field (persisted to the `claims.provenance` JSONB
  column). The accept handler records `{origin:'ai_proposal', proposalId,
sourceNoteId, sourceSourceId, provider, model, acceptedBy, acceptedAt,
confirmationNote?}`. When adding new claim-creating flows that need provenance,
  pass `provenance` here rather than stuffing it into `properties`.
- Shared review schemas in `@jotmind/schemas` `proposals.ts`:
  `editProposalSchema`, `acceptProposalSchema`, `rejectProposalSchema`,
  `acceptProposalResultSchema` (the accept response = updated proposal +
  `createdEntityIds`/`createdClaimIds`). Web helpers in `api.ts`:
  `acceptProposal`/`rejectProposal`/`editProposal`; `<ProposalItem>` renders
  per-item checkboxes + Accept all / Accept selected / Reject / Edit (JSON).

## Universal command/search box (US-019)

- One command box (`apps/api/src/command/`) accepts a natural-language query.
  `interpreter.ts` defines the `CommandInterpreter` interface +
  `MockCommandInterpreter` (deterministic demo, parses `type:`/`predicate:`/
  `tag:`/`kind:` hints into search filters) + `LlmCommandInterpreter` (wraps an
  `LlmProvider`, strict-JSON prompt validated by `commandInterpretationSchema`).
  `resolveCommandInterpreterFromEnv` mirrors `resolveExtractorFromEnv` exactly
  (reads `AI_PROVIDER_CONFIG`; mock gated by `AI_DEMO_EXTRACTION`/non-prod).
- `index.ts` `createCommandRouter` is mounted at
  `/api/knowledge-bases/:kbId/command` (`mergeParams`, AFTER the KB router).
  Single `POST /` is **read-only** (no mutation) → requires `viewer`, **no
  CSRF**; non-members get 404. `createApp` seam is `commandInterpreter`
  (default `resolveCommandInterpreterFromEnv()`); it also reuses the
  `searchStore` + `aiPolicyStore` seams.
- Endpoint always runs manual token search (`fallback`, works with AI off —
  AC1). When AI is available (interpreter present + `resolveAiPolicy` over
  server+user+KB is not `off`, remote needs `remoteAllowed`) it interprets the
  query: invalid output is discarded after ONE repair retry done _inside_
  `LlmCommandInterpreter.interpret` (AC3/AC4), and confidence <
  `COMMAND_CONFIDENCE_THRESHOLD` (0.4) is discarded → fallback (AC5). A `search`
  interpretation is executed against the search store to produce
  `interpretedResults`; `create` interpretations are returned as a constrained
  proposal preview only (no mutation — use capture/proposals to apply).
  Structured interpretation and fallback results are SEPARATE response fields
  (AC6). Shared shapes in `@jotmind/schemas` `command.ts`.
- **Repair retry lives in the interpreter, not the router** — when adding new
  structured-output AI flows, do the parse/validate + single repair inside the
  adapter and return `{ interpretation: null }` on failure so callers fall back.
- Web: `<CommandBox>` in `App.tsx` (rendered FIRST when a KB is selected) +
  `runCommand()` in `api.ts`. Testids: `command`, `command-query`,
  `command-submit`, `command-ai-status`, `command-interpretation`/`-intent`/
  `-interpreted-result-<kind>`, `command-no-interpretation`,
  `command-fallback`/`-fallback-result-<kind>`.

## Provenance-aware AI answers (US-020)

- `apps/api/src/answers/` answers a question using graph evidence and cites it.
  Three pieces mirror the command box (US-019): `evidence.ts`
  (`AnswerEvidenceStore` + `dbAnswerEvidenceStore` — COMPOSES `searchStore` +
  `claimStore` + `entityStore`, no new SQL: it runs a token search scoped to
  `claim/note/source`, then enriches each claim hit with its arguments + entity
  NAMES so a cited claim carries predicate/connected-entities/confidence/
  provenance, AC3), `answerer.ts` (`AnswerGenerator` interface +
  `MockAnswerGenerator` deterministic demo + `LlmAnswerGenerator` strict-JSON
  with ONE repair retry inside `generate()`; `resolveAnswerGeneratorFromEnv`
  mirrors `resolveCommandInterpreterFromEnv`), and `index.ts`
  (`createAnswerRouter`).
- Mounted at `/api/knowledge-bases/:kbId/answers` (`mergeParams`, AFTER the KB
  router). Single `POST /` is **read-only** → `viewer`, **no CSRF**, non-members 404. `createApp` seams: `answerGenerator` (default
  `resolveAnswerGeneratorFromEnv()`) + `answerEvidenceStore`; reuses
  `searchStore`/`aiPolicyStore`.
- Manual token search ALWAYS runs as `fallback` so No-AI mode still offers
  results (AC2). AI is available only when a generator exists + `resolveAiPolicy`
  (server+user+KB strictest-wins) is not `off` (remote needs `remoteAllowed`),
  so **viewer generation is gated by policy** (AC6). The generated answer's
  `statements` are labeled `known|inferred|uncertain|missing` (AC5 — the mock
  classifies by claim confidence (<0.5 → uncertain) and `provenance.origin`
  (`rule`/`inferred` → inferred)). The router **clamps each statement's citation
  refs to real evidence refs** so the model can't fabricate citations (AC1/AC3).
- Shared shapes in `@jotmind/schemas` `answers.ts`: `answerRequestSchema`,
  `answerCitationSchema` (the `ref`-indexed evidence), `answerStatementSchema`,
  `generatedAnswerSchema` (what the generator/LLM produces), `answerResponseSchema`.
- Web: `<Answers>` in its own file `apps/web/src/Answers.tsx` (rendered after
  `<CommandBox>` when a KB is selected) + `answerQuestion()` in `api.ts`.
  Testids: `answers`, `answers-query`, `answers-submit`, `answers-ai-status`,
  `answers-summary`, `answers-statement-<factKind>`, `answers-citation-open-<ref>`,
  `answers-citation-detail-<ref>`/`-confidence-<ref>`/`-provenance-<ref>`,
  `answers-fallback`/`-fallback-result-<kind>`. Clicking a citation toggles an
  inline detail panel (AC4); keep that single (don't also render a duplicate
  detail block — duplicate testids break `getByTestId`).

## Vector embeddings & indexing jobs (US-021)

- Embeddings are stored in PostgreSQL via **pgvector** in the `embeddings` table
  (`apps/api/src/db/schema.ts`, migration `drizzle/0005`). The `embedding`
  column uses a custom Drizzle type `vector` (also in `schema.ts`) declared
  **without a fixed dimension** so one table holds vectors of whatever size the
  configured provider produces (mock = 8). It marshals `number[]` ⇄ pgvector's
  text format (`[1,2,3]`). Unique index `(target_type, target_id, model)` makes
  re-indexing an upsert; the table is **not** soft-deleted (it's a derived
  index — delete the row when a canonical record is removed).
- `apps/api/src/embeddings/`: `store.ts` (`EmbeddingStore` + `dbEmbeddingStore`:
  `upsert` via `onConflictDoUpdate`, `deleteByTarget`, `getStats`,
  `hasEmbeddings`, `vectorSearch` = raw `embedding <=> $vec::vector` cosine),
  `content.ts` (per-kind content builders — **entity content folds in aliases +
  tags**, AC2 — plus `hashContent`), `targets.ts` (`EmbeddingTargetSource` reads
  entity/claim/note/source `WHERE deleted_at IS NULL`), `provider.ts`
  (`resolveEmbeddingProviderFromEnv` mirrors `resolveExtractorFromEnv`; reads
  `AI_PROVIDER_CONFIG`; anthropic → null, no embedding endpoint), `indexer.ts`
  (`runEmbeddingIndex` — the policy-gated indexing logic), `index.ts`
  (`createEmbeddingsRouter`). `createApp` seam: `embeddingStore`.
- **Policy gating (US-016 reuse):** `runEmbeddingIndex` resolves
  `resolveAiPolicy` over server + KB + requesting-user layers (strictest-wins),
  skips when `mode==='off'`, and **requires the separate
  `remoteEmbeddingsAllowed` consent before using a remote provider** (AC3 —
  remote embeddings are gated independently of remote LLM use).
- **Indexing runs as a durable job (US-007):** `POST
/api/knowledge-bases/:kbId/embeddings/reindex` (editor + CSRF) enqueues an
  `EMBEDDING_INDEX_JOB_TYPE` (`'embeddings.index'`) job; its status is visible
  via the existing KB jobs endpoint (`GET /api/knowledge-bases/:id/jobs`, AC5).
  The handler is registered in `jobs/handlers.ts` and is **self-contained**
  (resolves its own DB stores + env provider) so it works identically in the
  in-process and separate-process workers.
- **Availability is decoupled from the provider (AC4):** `GET
/api/knowledge-bases/:kbId/embeddings` returns `vectorSearchAvailable` =
  _embeddings exist_ (independent of whether a generation provider is currently
  configured/permitted) and `generationAvailable` = _new embeddings can be made
  now_ (provider + policy). The search store's `getVectorSearchAvailability`
  likewise now checks `EXISTS(SELECT 1 FROM embeddings)` rows. NOTE: query-time
  vector search (embedding the query at search time) is deferred — it needs a
  live provider; only the stored-embedding availability/data is implemented.
- Shared shapes in `@jotmind/schemas` `embeddings.ts`. US-021 has **no UI** and
  its AC list omits browser verification (only "Tests pass" / "Typecheck
  passes").

## Built-in rule packs (US-022)

- Showcase Modules ship versioned, installable bundles of restricted
  Datalog-like inference rules so reasoning is useful without authoring rules
  (US-023 adds custom authoring; US-024 runs them). The catalog is **static
  shared content** in `@jotmind/schemas` `rules.ts`: `BUILTIN_RULE_MODULES`
  (Module -> packs -> rules) + `findBuiltinRulePack(moduleId, packId)`. Two
  Modules ship: `personal-relationship` (event-participation pack) and
  `reading-character-map` (family-relationship pack), each with >=1 rule.
  `rules.ts` reuses `ruleStatusSchema`/`RULE_STATUSES` from `graph.ts` (US-005)
  — do NOT redefine them.
- `apps/api/src/rules/`: `store.ts` (`RuleStore` + `dbRuleStore`) and `index.ts`
  (`createRuleRouter`). Mounted at **`/api/knowledge-bases/:kbId/rules`**
  (`mergeParams:true`, AFTER the KB router). `createApp` seam: `ruleStore`.
  No DB migration — the `rule_definitions` table existed from US-005.
- **Rules are NOT graph projection targets** — writes record an `audit_events`
  row ONLY (no `graph_outbox`, unlike entities/claims/notes/sources). Built-in
  provenance (`{moduleId, packId, ruleKey, packVersion}`) is stashed in the
  `rule_definitions.compiled` JSONB under a `builtin` key; `readBuiltinMeta` +
  the router's `toRule` mapper surface `moduleId`/`packId` on the public shape.
- **Install is idempotent + versioned (AC4):** `installRulePack` inserts each
  rule with `status='disabled'` and `version = pack.version`; it skips a rule
  already present at the same `(kb, name, version)` (matches the
  `rule_definitions_kb_name_version_uq` partial unique index) and returns
  `{installed, skipped}`. `setRuleStatus` toggles `enabled`/`disabled` and writes
  a `rule.enabled`/`rule.disabled` audit row (install writes `rule.installed`).
- Routes (`GET /packs` catalog + `GET /` installed = viewer; `POST /install` +
  `PATCH /:ruleId` status = editor + `requireCsrf`; non-members 404). Viewers are
  read-only. The `/packs` handler is synchronous — use a plain `(req,res)=>{}`,
  NOT `asyncHandler` (which requires a Promise-returning handler).
- Web: `apps/web/src/Rules.tsx` (`<Rules>`, rendered after `<Proposals>` for the
  selected KB) lists built-in Modules/packs with Install buttons + installed
  rules with Enable/Disable toggles (editor-gated). API helpers in `api.ts`:
  `listBuiltinRulePacks`/`listRules`/`installRulePack`/`setRuleStatus`. Testids:
  `rules`, `rules-pack-<mod>-<pack>`, `rules-install-<mod>-<pack>`,
  `rules-rule-<id>`, `rules-rule-status-<id>`, `rules-toggle-<id>`.

## Restricted Datalog rule authoring (US-023)

- Custom rules are a tiny **restricted Datalog** dialect parsed into a structured
  AST by `parseRule(text, { recursionCap? })` in `@jotmind/schemas` `rules.ts`.
  Rules are NEVER `eval`'d — the parser only produces data, so there is no
  filesystem/network/process/JS/provider access (AC7). Execution is US-024.
- Syntax (AC1): `head(?a, ?b) <- atom1, atom2, ... .` Terms are explicit
  `?variables` or `"string literals"` only. Built-in low-level predicates (AC2):
  `entity(?id, ?type, ?name)` (3), `claim(?id, ?predicate)` (2),
  `arg(?claimId, ?role, ?entityId)` (3) — see `RULE_BUILTIN_PREDICATES`.
- The validator enforces: built-in arity; **range-restriction safety** (every
  head var must appear in a positive, non-negated body atom — AC3); rejection of
  skolem/function terms, blank nodes (`_:x`), anonymous/existential vars (`?_`),
  and quantifier keywords (`exists`/`∃`…) (AC4); a head cannot redefine a
  built-in predicate; body atoms must be a built-in OR the rule's own head
  (bounded **direct recursion** only — AC7/AC8); restricted negation (negated-atom
  vars must also be bound positively). Recursion cap is configurable and clamped
  to `[RULE_RECURSION_CAP_MIN..MAX]` (default 16) via `clampRecursionCap`.
- Store (`rules/store.ts`): `createRule` (always `status:'draft'`, version 1,
  duplicate name → `{ok:false,reason:'duplicate_name'}`) and `updateRule`
  (re-validates; an **enabled** rule that becomes invalid is demoted to `draft`).
  Both stash `{ authored: { ast, validation, recursionCap } }` in the
  `rule_definitions.compiled` JSONB (parallel to the `builtin` key from US-022);
  `readAuthoredCap` reads the stored cap. No migration — `rule_definitions`
  existed from US-005.
- Router (`rules/index.ts`): `POST /validate` (viewer+, read-only, no CSRF — live
  UI preview), `POST /` create + `PUT /:ruleId` edit (editor + CSRF). The
  existing `PATCH /:ruleId` status toggle now **gates enable on validity**:
  enabling an invalid rule → **422** with `validationErrors` (AC5/AC6). `toRule`
  re-parses `ruleText` as the single source of truth so `valid`/`validationErrors`/
  `recursionCap` are surfaced consistently for built-in AND authored rules.
- Web: `Rules.tsx` gained an "Author a Custom Rule" form (Validate +
  Save-as-draft, editor-only) and a `✓ valid`/`✗ invalid` badge per installed
  rule. API helpers in `api.ts`: `validateRule`/`createRule`/`updateRule`.
  Testids: `rules-author-form`/`-name`/`-text`/`-cap`/`-validate`/`-submit`/
  `-validation`/`-valid`/`-invalid`, `rules-rule-valid-<id>`/`rules-rule-errors-<id>`.

## Run rules with traces (US-024)

- Rule execution is a **pure, in-memory evaluator** in `apps/api/src/rules/engine.ts`
  (`executeRule(CompiledRule, RuleFacts)`). It walks the US-023 AST bottom-up
  (semi-naïve, positive atoms joined first then stratified negation) over facts
  the caller supplies — it NEVER touches the DB, network, filesystem, or `eval`.
  Each derived head tuple accumulates a **trace** (source `claimIds`/`entityIds`/
  `argumentIds`, AC6). Iteration is bounded by `rule.recursionCap`; if new tuples
  are still derived when the cap is hit, `limitExceeded` is set (AC2). NOTE:
  single-rule direct recursion can't bootstrap a base case (no disjunction in the
  dialect), so recursive rules are effectively inert — the cap is a safety guard.
- **`dbRuleRunStore.loadFacts` is where the hidden safety predicates are injected**
  (`rules/run-store.ts`): `deleted_at IS NULL` on entities/claims/claim_arguments
  (AC3) and current valid-time bounds on claims (AC4). **GOTCHA:** each OR fragment
  must be wrapped in its own parens in the `sql` template
  (`sql\`(${claims.validStart} IS NULL OR ${claims.validStart} <= now())\``) —
  without parens, SQL's AND-binds-tighter-than-OR precedence silently lets
  expired/not-yet-valid rows through. The pure engine never sees filtered rows.
- Two tables (migration `drizzle/0006`): `rule_runs` (status running/completed/
  failed, started/finished_at, error, result_count, iterations, limit_exceeded,
  `triggered_by` user + `job_id` — AC5) and `inferred_results` (predicate,
  `arguments` jsonb `[{name,value,entityName}]`, `trace` jsonb). Both are
  **operational/derived — no soft-delete**. Inferred results are **labelled
  `'inferred'` and are NOT written to `claims`** (AC8) and are NOT graph
  projection targets.
- Router (`rules/index.ts`): `POST /:ruleId/run` (**editor + CSRF** — a run is a
  write that creates run/result rows; only `status='enabled'` AND re-parsed-valid
  rules execute, else 409/422), `GET /runs` + `GET /runs/:runId` (viewer,
  read-only). The run handler wraps execution in try/catch so any failure records
  a **failed** run with 0 results and never mutates canonical data (AC7);
  `limitExceeded` → `status='failed'` + error. `createApp` seam: `ruleRunStore`.
  An `audit_events` `rule.run` row is written in the same tx as the run.
- Shared schemas in `@jotmind/schemas` `rules.ts`: `ruleRunStatusSchema`,
  `inferredResult{Argument,Trace,}Schema`, `ruleRunSchema`, `ruleRunResultSchema`,
  and the `ruleReferencesValidTime()` seam (always `false` — the dialect has no
  valid-time predicate, so current-time bounds always apply).
- Web: `Rules.tsx` per-enabled-rule **Run** button (disabled unless enabled +
  valid) + a "Last Rule Run" panel. API helpers in `api.ts`: `runRule`/
  `listRuleRuns`/`getRuleRun`. Testids: `rules-run-<id>`, `rules-run-result`,
  `rules-run-status`, `rules-run-results`, `rules-run-result-<id>`,
  `rules-run-label-<id>`, `rules-run-trace-<id>`, `rules-run-empty`.

## Accept inferred results as claims (US-025)

- An editor can convert an Inferred Result (US-024) into a stored Claim. The
  route is `POST
/api/knowledge-bases/:kbId/rules/runs/:runId/results/:resultId/accept`
  (**editor + CSRF** — it creates a canonical claim; viewers are read-only, AC4)
  on the same rule router. It mirrors the **US-018 proposal-accept pattern**:
  the conversion happens **in the ROUTER**, calling the injected
  `claimStore.createClaim` so the new claim goes through the normal canonical
  write path (graph outbox + audit in one tx). The `RuleRouterOptions` now take a
  `claimStore` (wired in `app.ts`); inject an in-memory fake for unit tests.
- `RuleRunStore` gained `getResult(kbId, runId, resultId)` (scoped to both the
  run AND the KB) so the accept route can fetch a single inferred result. The
  in-memory fake in `rules-run.test.ts` implements it too.
- **Argument mapping:** each resolved head argument of the inferred result
  becomes a claim argument — `entityName !== null` ⇒ an **entity** arg
  (`entityId = value`), otherwise a **literal** arg. The role is the head
  variable name (`arg.name`).
- **Provenance (AC2/AC3):** the created claim's `provenance` records
  `{ origin: 'inferred', ruleId, ruleName, ruleRunId, inferredResultId,
sourceClaimIds, sourceEntityIds, sourceArgumentIds, acceptedBy, acceptedAt,
confirmationNote? }`. `origin: 'inferred'` (the `INFERRED_CLAIM_ORIGIN`
  constant in `@jotmind/schemas` `rules.ts`) distinguishes it from user-entered
  (no `origin`) and AI-extracted (`ai_proposal`) claims — pass it via
  `CreateClaimInput.provenance`, not `properties`.
- Shared schemas in `@jotmind/schemas` `rules.ts`: `acceptInferredResultSchema`
  (`{ confirmationNote? }`), `acceptInferredResultResultSchema`
  (`{ claimId, result }`), `INFERRED_CLAIM_ORIGIN`. Web: `acceptInferredResult`
  in `api.ts` + per-result **Accept as claim** button in the `Rules.tsx` run
  panel. Testids: `rules-run-accept-<resultId>`, `rules-run-accepted-<resultId>`.

## AGE-backed graph projection & traversal (US-026)

- The stub projector (US-006) is replaced by a REAL Apache AGE projector. AGE is
  a DERIVED index of the canonical relational tables — it never holds canonical
  data, so an AGE failure can never corrupt records. `createApp`'s default
  projector is now `ageProjector` unless `GRAPH_PROJECTOR=stub` is set; unit
  tests inject `projector: stubProjector` (or a fake) to avoid touching AGE.
- **AGE session pattern (`apps/api/src/graph/age.ts`):** every AGE statement must
  run on a connection that has done `LOAD 'age'` + `SET search_path`. postgres-js
  pools connections, so ALL AGE work goes through `withAge(fn)`, which uses
  `getSqlClient().begin()` (pins one connection), loads age, sets the path, and
  ensures the `jotmind_graph` graph exists. Run Cypher via the session's
  `cypher(body, columns, params?)`.
- **AGE Cypher params (critical gotcha):** AGE requires the 3rd `cypher()` arg to
  be a bare bind parameter inferred as `agtype` — a literal or a CAST (`$1::agtype`)
  is REJECTED with "third argument of cypher function must be a parameter".
  postgres-js sends interpolated values as bind params with the type inferred, so
  `cypher('g', $$ ... $name ... $$, ${JSON.stringify(params)})` works and the
  server infers `agtype`. NEVER concatenate user text into the Cypher body — pass
  it through the param map (handles quote escaping), keeping the projector
  injection-safe.
- **Graph model (`age-projector.ts`):** `(:Entity {id,kbId,...})`, `(:Claim
{id,kbId,predicate,...,literalArgs})`, and `(:Claim)-[:ARGUMENT
{argumentId,role,position}]->(:Entity)` per entity argument (multi-arg claims =
  claim node + role-labeled edges, AC2). Use the FIXED `:ARGUMENT` edge label
  with a `role` property — do NOT create dynamic edge labels from user role text.
  `project(event)` always RELOADS the current canonical row (never trusts the
  outbox payload) so create/update/delete/rebuild share one idempotent path
  (claim upsert = DETACH DELETE then recreate). Note/Source events are accepted
  as no-ops (not traversal targets yet).
- **Projection lifecycle status (US-026 AC4):** new singleton `graph_projection_status`
  table (migration `drizzle/0007`, `id='default'` check constraint) with a
  `state` of `rebuilding`/`synchronized`/`failed` + rebuild metadata. Accessed via
  `ProjectionStatusStore` (`dbProjectionStatusStore`); `createApp` seam
  `projectionStatusStore`. `getProjectionStatus` now returns `state` + lifecycle
  fields (schema `graphProjectionStatusSchema` extended — update fakes when
  testing). GOTCHA: this row has an FK to `knowledge_bases`, so a `TRUNCATE
knowledge_bases CASCADE` (as in integration tests) WIPES it; `get()` returns a
  `synchronized` default when the row is missing.
- **Rebuild = durable job (AC4/AC7, non-locking):** `POST
/api/graph/projection/rebuild` (system admin+CSRF) now ENQUEUES a
  `GRAPH_REBUILD_JOB_TYPE` (`graph.projection.rebuild`) job (202 `{job}`) instead
  of running synchronously; the handler in `jobs/handlers.ts` calls
  `rebuildProjection` with `ageProjector`. `rebuildProjection` drives the state
  machine: `markRebuilding` -> `projector.prepareRebuild()` (clears AGE, optional
  Projector method) -> reproject every non-deleted canonical record ->
  `markSynchronized`; on error `markFailed` + rethrow. App writes/relational reads
  are never blocked (AGE is separate), so it is non-locking.
- **Traversal service (`traversal.ts`, AC6):** traversal-dependent views/rules
  query AGE ONLY through `GraphTraversalService` (`ageTraversalService` /
  `createAgeTraversalService({statusStore})`), never raw Cypher. It throws
  `GraphProjectionUnavailableError` when `state` is `rebuilding`/`failed` so
  callers fall back. `getEntityNeighborhood` returns nodes+role-labeled edges.
- **Web (AC5/AC7):** `getGraphProjectionStatus()` in `api.ts`; `GraphViews.tsx`
  loads it best-effort (core relational views work even if it fails) and, while
  `state==='rebuilding'`, replaces the Network view with an `network-indexing`
  "Indexing Graph…" panel (other tabs keep using relational data). It also shows
  `graph-projection-failed` and `graph-projection-lag` (pending>0) banners.
- **Testing:** unit tests use in-memory `ProjectionStore`/`ProjectionStatusStore`
  - the stub/fake projector (no DB). Real AGE behavior is covered by
    `age-projector.integration.test.ts` (`skipIf` no DATABASE_URL): param-escaping,
    entity projection, multi-arg edges, idempotency, rebuild, delete, traversal,
    rebuilding-unavailable. AGE persists between test runs — call
    `ageProjector.prepareRebuild()` in setup/teardown to clear it.

## Custom schemas (US-027)

- Advanced users define custom **entity types** (`kind:'entity_type'`) and **claim
  predicates** (`kind:'claim_predicate'`) so JotMind adapts to new domains. The
  `schema_definitions` + `schema_versions` tables already existed from US-005 — NO
  migration. A definition is the stable conceptual type (`name`); concrete
  validation rules live in a **versioned** `schema_versions` row. Entity types
  carry a flat `propertySchema` (validated by the existing
  `validateCustomProperties`); claim predicates carry a `spec` of allowed
  argument roles + compatible entity types.
- `apps/api/src/schema-defs/`: `store.ts` (`SchemaStore` + `dbSchemaStore`) and
  `index.ts` (`createSchemaRouter`). Mounted at
  **`/api/knowledge-bases/:kbId/schema`** (`mergeParams:true`, AFTER the KB
  router). `createApp` seam: `schemaStore`. Schemas are **NOT graph projection
  targets** — `createDefinition` records an `audit_events` (`schema.created`) row
  only (no `graph_outbox`), mirroring the rules store. Create inserts the
  definition + a v1 active version in one tx; `(kb, kind, name)` is unique (return
  `{ok:false,reason:'duplicate_name'}` → 409). Routes: `GET /` + `GET /export` +
  `GET /:defId` (viewer); `POST /` (editor + CSRF). `GET /export` is the portable
  JSON export (US-027 AC4; US-032 builds the full KB export).
- **Validation + stamping (AC3/AC5) happens in the entity/claim ROUTERS, not the
  stores.** Both routers gained a `schemaStore` seam (the claim router also takes
  `entityStore` to resolve entity types for compatible-type checks). `createApp`
  resolves `schemaStore = options.schemaStore ?? dbSchemaStore` and passes it to
  the entity/claim routers. Use the shared helpers `checkEntityAgainstSchema` /
  `checkClaimAgainstSchema` (exported from `schema-defs/index.ts`): they look up
  the active version by `name`/`predicate`, validate (400 + `issues` on failure),
  and return the `schemaVersionId` to stamp. **No custom schema for that
  type/predicate ⇒ unconstrained (`schemaVersionId` null).** Validation runs on
  BOTH create and update; the update path loads the existing record to fill the
  unchanged half of the type/properties (entities) or predicate/arguments
  (claims). `UpdateEntityFields`/`UpdateClaimFields` gained `schemaVersionId`.
- **GOTCHA — keep DB-free unit tests green:** the entity/claim routers do NOT
  default `schemaStore` (skip validation when absent), but `createApp` always
  injects `dbSchemaStore`. So unit tests that build the app via `createApp` and
  POST entities/claims (`entities.test.ts`, `claims.test.ts`) MUST inject a
  schema store — use the reusable `createMemorySchemaStore()` exported from
  `schema-defs/schema-defs.test.ts` (returns no constraints by default; seed it
  with `createDefinition` to test validation).
- Shared shapes in `@jotmind/schemas` `schema-defs.ts`: `schemaArgumentRoleSchema`,
  `predicateSpecSchema`, `schemaVersionSchema`, `schemaDefinitionSchema`,
  `createSchemaDefinitionSchema`, `schemaExportSchema`, and the validation hooks
  `validateEntityProperties`/`validatePredicateArguments` (shared so API + web
  run the SAME logic). Reuse `schemaDefinitionKindSchema`/`SchemaDefinitionKind`
  from `graph.ts` — do NOT redefine them. Web: `apps/web/src/SchemaDefinitions.tsx`
  (`<SchemaDefinitions>`, rendered after `<Search>` for the selected KB) lists
  entity types/predicates + an editor-only create form (property schema / spec
  entered as JSON). API helpers in `api.ts`: `listSchemaDefinitions`/
  `createSchemaDefinition`. Testids: `schema-definitions`, `schema-create-form`,
  `schema-kind`, `schema-name`, `schema-display-name`, `schema-spec`,
  `schema-submit`, `schema-def-<id>`.

## Schema version evolution (US-028)

- Editing a schema is classified **compatible** (metadata or LOOSEN validation)
  vs **breaking** (TIGHTEN validation) by pure functions in `@jotmind/schemas`
  `schema-defs.ts`: `classifyPropertySchemaChange` (entity types),
  `classifyPredicateSpecChange` (claim predicates), and the kind-dispatching
  `classifySchemaChange`. **Breaking** = added/now-required field/role, type
  change, removed field/role, narrowed entity types, or disallowed-literal.
  **Compatible** = added-optional, made-optional, widened entity types, or
  newly-allowed-literal. These are shared so the API store and (potential) web
  preview agree. NO migration — `schema_versions` already has the
  `version`/`is_active` columns + the one-active partial unique index from US-005.
- `SchemaStore.updateDefinition` (`apps/api/src/schema-defs/store.ts`): metadata
  (displayName/description) is always updated in place. **Compatible** validation
  changes update the active version's `propertySchema`/`spec` IN PLACE (no new
  version, existing data untouched — AC1). **Breaking** changes deactivate the
  current version and insert a NEW active version (`version = max+1`) so existing
  entities/claims keep their old `schema_version_id` and stay valid under it
  (AC2/AC3). Audit action is `schema.updated` (compatible) or
  `schema.version_created` (breaking), all in one tx. Returns
  `{ok,definition,classification}` / `{ok:false,reason:'not_found'}`.
- Route `PUT /:defId` (editor + CSRF) returns `{changeType, reasons, definition}`.
  `GET /:defId/validation` (viewer) returns a `schemaValidationReportSchema`
  report (AC6): it scans existing records of the conceptual `name`/predicate via
  the injected `entityStore`/`claimStore` (NEW seams on the schema router, wired
  in `createApp`) and validates each against the ACTIVE version, reporting
  `warnings` + `onOldVersionRecords`. Cross-version lookups key off the string
  `type`/`predicate` (AC4 — `getActiveVersionByName` + search already do this);
  validators treat absent JSONB fields as missing/null rather than throwing (AC5).
- **GOTCHA:** the in-memory `createMemorySchemaStore()` fake (in
  `schema-defs.test.ts`) must implement `updateDefinition` too. Unit tests for the
  validation report inject tiny `entityStore`/`claimStore` fakes
  (`listEntities`/`getEntity`/`listClaims`) via `createApp`.
- AI-assisted schema migrations (AC7) are "if present" — JotMind has none, so it
  is vacuously satisfied; any future one MUST go through the proposal queue
  (US-018 pattern) and never auto-apply. Web: `SchemaDefinitions.tsx`
  `<SchemaDefRow>` adds per-row **Edit** (editor) + **Check data** (validation
  report) controls. Testids: `schema-edit-<id>`, `schema-edit-form-<id>`,
  `schema-edit-display/-description/-rules-<id>`, `schema-save-<id>`,
  `schema-result-<id>`, `schema-check-<id>`, `schema-report-<id>`,
  `schema-warning-<recordId>`. `api.ts`: `updateSchemaDefinition`,
  `getSchemaValidation`.

## Built-in domain Modules (US-029)

- A **Module** is an installable bundle of default _content_ for a Knowledge
  Base: custom entity-type + claim-predicate schemas (US-027) and references to
  built-in rule packs (US-022). The catalog is **static shared content** in
  `@jotmind/schemas` `modules.ts`: `BUILTIN_MODULES` + `findBuiltinModule(id)`.
  Each module declares `entityTypes` (name/displayName/description/propertySchema),
  `claimPredicates` (name/displayName/description/spec), and `rulePacks`
  (`{moduleId, packId}` refs into `BUILTIN_RULE_MODULES`). The
  `personal-relationship` module ships Person/Event/Place entity types + the
  relationship predicates (attended/met/introduced/interacted_with/mentioned/
  knows/lives_in) + the event-participation rule pack.
- **Install happens IN THE ROUTER, not a dedicated store** (mirrors the
  proposal-accept pattern, US-018). `apps/api/src/modules/index.ts`
  `createModuleRouter` reuses the injected `schemaStore.createDefinition` +
  `ruleStore.installRulePack` so created content goes through the canonical write
  paths (audit + idempotency). There is NO module store and NO migration.
  Mounted at `/api/knowledge-bases/:kbId/modules` (`mergeParams`, AFTER the KB
  router); wired in `createApp` reusing the already-resolved `schemaStore` +
  `ruleStore`/`kbStore`/`authStore` seams. Routes: `GET /` (viewer) returns the
  catalog with per-KB installed status (`installedEntityTypes`/
  `installedClaimPredicates`/`fullyInstalled`); `POST /install` (editor + CSRF,
  body `{moduleId}`) is **idempotent** — schema defs already present (by name) ⇒
  `createDefinition` returns `duplicate_name` ⇒ item `skipped`; rule packs reuse
  the US-022 idempotent installer. Non-members 404, viewers 403 on install.
- **No new property field types:** `propertySchema` only supports
  `string`/`number`/`boolean`/`date` (US-005). Person "birthday uncertainty" is
  modeled as a `birthday` string + a `birthdayPrecision` string; names/aliases/
  tags(groups)/notes are first-class **entity** fields, NOT custom properties, so
  the Person `propertySchema` only declares the extra contact/social/strength
  fields and requires none (a name-only Person stays valid).
- Web: `apps/web/src/Modules.tsx` (`<Modules>`, rendered after `<Search>` for the
  selected KB) lists modules with an Install button (editor) + `✓ installed`
  badge. API helpers `listModules`/`installModule` in `api.ts`. Testids:
  `modules`, `modules-list`, `modules-module-<id>`, `modules-install-<id>`,
  `modules-installed-<id>`, `modules-readonly-<id>`. GOTCHA (cross-component
  sync): installing a Module creates schema defs but the sibling
  `<SchemaDefinitions>` only fetches once per `kb.id` — reload + reselect the KB
  to see them (browser tests must do this).
- **AC5 (Remote RAG confirmation):** remote sharing stays minimal by default
  (US-016 `DEFAULT_AI_POLICY` off). Enabling the "Allow remote embeddings
  (Remote RAG context sharing)" consent in `AiPolicySettings.tsx`'s
  `PolicyEditor` now triggers a prominent `window.confirm` before checking;
  turning it OFF needs no confirmation. Browser tests must register a
  `page.once('dialog')` handler and use `.click()` (not `.check()`, which asserts
  the box ends up checked) when exercising it.

## Reading / character-map Module (US-030)

- Adding a domain Module is **catalog-only**: append a `BuiltinModule` to
  `BUILTIN_MODULES` in `@jotmind/schemas` `modules.ts`. The install router
  (`modules/index.ts`) and `<Modules>` UI are generic, so a new module is
  automatically installable + browsable with NO API/web/migration changes. The
  `reading-character-map` module ships `Character`/`Event`/`Place`/`Concept`
  entity types + plot/relationship predicates (`parent_of`, `appears_in`,
  `first_appears_in`, `knows`, `married_to`, `allied_with`, `enemy_of`,
  `located_at`) and references the existing `reading-character-map`/
  `family-relationship` rule pack (US-022). A module's `parent_of` predicate's
  roles (`parent`/`child`) MUST match the rule pack's atom names for inference.
  All four entity types are already in `BUILTIN_ENTITY_TYPES` (graph.ts), so the
  entity-create `<select>` already offers them.
- **GraphViews enhancements** (`apps/web/src/GraphViews.tsx`): the **Network**
  view has a tag/work filter (`network-tag-filter` select → filters
  `visibleEntities` by tag; `network-filter-empty` when none match). The
  **Timeline** view has an order toggle (`timeline-order` select: `date` |
  `sequence`); plot-`Event` entities carry an optional numeric `sequence` JSONB
  property read by `readSequence()` and shown as `#N`. Sequence mode sorts
  sequenced items ascending, unsequenced fall back to newest-date-first.

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
