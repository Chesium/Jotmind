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

## Validation

- Run `pnpm verify:quick` for fast feedback; `pnpm verify` for the full suite (adds API + e2e).
- `pnpm test` excludes `@jotmind/api` (uses a `--filter=!@jotmind/api`); API tests run via
  `pnpm test:api`. Keep this split when adding packages.
- Playwright browsers must be installed once:
  `pnpm --filter @jotmind/web exec playwright install chromium`.
- Prettier ignores Ralph/agent scaffolding (`prd.json`, `progress.txt`, `prompt.md`, `.agents`, etc.)
  via `.prettierignore`. Add new non-source top-level files there if they trip `format:check`.
