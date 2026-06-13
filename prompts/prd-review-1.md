You are a PRD-improvement agent working on the current JotMind Graph-Note Redo PRD.

Your task is to revise and strengthen the PRD so that it becomes suitable for a mostly human-free Ralph loop / Amp multi-agent implementation workflow.

Do not implement code. Do not invent a new product direction. Improve the PRD by resolving ambiguities, contradictions, terminology drift, staging problems, and weak acceptance criteria.

The current PRD is directionally correct but too broad and not yet mechanical enough for autonomous implementation. Your output should be an improved PRD, plus a concise changelog explaining what you changed and why.

## High-level intent

JotMind is a privacy-first, self-hostable, graph-based personal knowledge app for fragmented information. It stores notes, sources, typed entities, multi-argument provenance-aware claims, custom schemas, and restricted Datalog/Prolog-like reasoning rules. It should support two first-class v1 showcase modules:

1. Personal relationship management.
2. Reading / character maps.

The PRD should remain aligned with the existing decisions:

* TypeScript everywhere on Node.js.
* React + Vite frontend.
* Express backend with strict TypeScript/Zod project template.
* Monorepo with `apps/web`, `apps/api`, and shared packages.
* REST JSON APIs with Zod validation.
* PostgreSQL + Drizzle migrations.
* PostgreSQL-backed jobs/outbox.
* Server-side sessions with secure HTTP-only cookies.
* Argon2id password hashing.
* CSRF protection for cookie-authenticated mutations.
* Role-based access per knowledge base.
* Remote AI disabled by default.
* AI writes never apply without explicit user confirmation.
* Prolog-style reasoning is a core differentiating feature, but v1 must use a restricted Datalog/Horn-clause rule layer rather than an unrestricted external Prolog runtime.

## Mandatory human decisions to apply

Apply the following decisions exactly.

### V1 staging and Ralph execution

* `v1` means milestones M0-M4 are complete.
* `first autonomous implementation wave` means M0 Foundation plus architecture seams/stubs.
* `first user-facing demo` means M1 Manual Graph.
* The PRD must include a milestone matrix.
* Every user story must be annotated with:

  * Target milestone.
  * Whether stubs are allowed.
  * Definition of done.
  * Verification expectations.
  * Out-of-scope items for that story or milestone.

Use these milestone names:

* M0 Foundation.
* M1 Manual Graph.
* M2 AI/RAG.
* M3 Reasoning.
* M4 Polish/Hardening.

Prefer vertical, demoable milestones rather than backend-only or frontend-only phases.

### Source of truth

Resolve all contradictions about Apache AGE.

The canonical rule is:

* Relational PostgreSQL tables are canonical.
* Apache AGE is a derived graph projection/query index.
* AGE can be rebuilt or repaired from canonical relational tables.
* Agents must not treat AGE as canonical source of truth.
* Relational writes and `graph_outbox` events must happen in the same transaction.
* AGE projection is performed by a background projector.
* The AGE projector may be stubbed in M0/M1, but the projection interface and outbox must exist early.

Rewrite any PRD sentence that says “PostgreSQL plus Apache AGE is the source of truth” if it implies AGE is canonical. Use “PostgreSQL relational tables are canonical; AGE is a derived graph projection/query index.”

### Terminology

Unify terminology.

* User-facing scope is called `Knowledge Base`.
* Database field name must be `knowledge_base_id`.
* Do not mix `workspace`, `workspace_id`, and `knowledge base` as separate concepts.
* If the original PRD uses `workspace`, replace or normalize it to `Knowledge Base` unless explicitly discussing future implementation alternatives.
* Add a glossary near the beginning of the PRD.

Glossary must define at least:

* Server instance.
* Knowledge Base.
* Module.
* Entity.
* Claim.
* Claim Argument.
* Note.
* Source.
* Citation / Source Excerpt.
* Proposal.
* AI Proposal.
* Inferred Result.
* Accepted Inferred Claim.
* Schema Definition.
* Schema Version.
* Rule Definition.
* Rule Run.
* Graph Projection.
* Audit Event.
* Job / Background Job.

### Module definition

Clarify that:

* A Module is an installed schema/view/rule-pack bundle inside a Knowledge Base.
* A Module is not a separate database.
* A Module is not a separate permission scope.
* Personal relationship management and reading/character maps are built-in modules.

### Note and Source modeling

Clarify that:

* Note and Source are canonical records.
* They may be projected as graph nodes.
* They are not ordinary user-created entity types unless graph projection or schema views need to expose them that way.
* Claims may cite Notes, Sources, or Source Excerpts.
* Source/note views display original captured/imported material and linked extracted claims.

Avoid ambiguous wording that treats Note/Source as both normal entity types and separate provenance records without explanation.

### Mock AI provider

Clarify that:

* Mock AI providers are only for development, tests, demos, and early milestones.
* If a mock provider is exposed in runtime UI, it must be behind a development/demo flag.
* It must be visibly labeled as `Mock AI / deterministic demo output`.
* Fresh production installs still default to `No AI`.
* The app must not fabricate AI output via hidden remote calls.

### Custom schema v1 minimum

Clarify the v1 minimum custom schema scope:

* V1 minimum custom schema support means:

  * Custom entity type.
  * Custom claim predicate.
  * JSONB property schema validation.
* View defaults and extraction hints may be placed in M4 polish.
* Full guided schema migration UI may be staged later within M4, but schema version references must exist from the start.

### Reasoning v1 minimum

Clarify the v1 reasoning minimum:

* M3 minimum:

  * Built-in rule packs.
  * Low-level predicates.
  * Simple text rules.
  * Result trace.
* Guided rule builder, stratified negation, and graph edit proposal generation may be staged after the first reasoning milestone.
* Unrestricted Prolog, arbitrary recursion, arbitrary JavaScript, filesystem/network/process access, and unrestricted Prolog negation-as-failure are out of scope.
* V1 rule syntax should be restricted Datalog-like text syntax with explicit variables exposed through a Prolog-like UI.

### Import/export/backup scope

Clarify that:

* Full-fidelity round trip is guaranteed only for portable JSON.
* Markdown export is human-readable export, not guaranteed full-fidelity round trip.
* CSV/table import/export is a structured subset flow.
* PostgreSQL dump/restore is operator maintenance, not normal per-user portable export.
* Knowledge Base owner/admin UI should focus on portable JSON import/export first.
* Full database backup/restore belongs to server operator/admin CLI/docs.

### Personal relationship module remote sharing

Clarify that:

* Personal relationship data may be sensitive.
* The personal relationship module defaults remote sharing scope to minimal.
* Remote RAG context sharing for this module requires an additional prominent confirmation.
* Remote AI/embedding use still follows global, Knowledge Base, and user-level consent policies.

### Viewer AI behavior

Clarify that:

* Viewers may use read-only AI answer generation only if Knowledge Base policy permits it.
* Viewers must not trigger graph writes, proposals, imports, or mutations.
* Viewer remote calls still require personal and Knowledge Base consent.
* Viewer AI answer generation must respect provider policies, remote scope, audit logging, and rate limits.

## Apply P1/P2 default decisions

Use the following defaults unless the existing PRD already says something stricter and compatible.

### PRD structure and Ralph-readiness

* Add a milestone matrix mapping all user stories to M0-M4.
* Split oversized user stories into smaller implementation stories where needed.
* Large stories such as views, custom schemas, reasoning, and import/export should become sub-stories or staged deliverables.
* Each implementation story should be small enough for one Ralph/Amp iteration and one small commit.
* Add a “Ralph / Amp Definition of Done” section.

Every implementation story should specify:

* API acceptance.
* UI acceptance if applicable.
* Test expectations.
* Browser verification expectations if applicable.
* Permission/audit/job requirements if applicable.
* Allowed stubs and stub visibility.
* Out-of-scope items.

### AI privacy setting layering

Define AI privacy policy as layered:

1. Server policy.
2. Knowledge Base policy.
3. User setting.

The stricter policy wins.

Remote always allowed:

* Is per-user and per-Knowledge Base.
* Cannot override stricter Knowledge Base or server policy.

Per-user provider keys:

* May be used for a shared Knowledge Base only if the Knowledge Base policy allows that provider and remote data sharing scope.

Environment provider settings:

* Are server-global defaults or overrides.
* If server policy disables remote AI, user or Knowledge Base settings cannot bypass it.

### Audit and retention

Clarify audit export and retention:

* Portable graph export includes claim provenance needed to reconstruct graph data.
* Portable graph export does not include full server security audit logs by default.
* Admins may separately export audit logs.
* Raw AI debug logs are disabled by default.
* If enabled, raw AI debug logs should have explicit retention, for example 7 or 30 days, and must be manually clearable.
* Raw debug logs must not be included in portable graph exports by default.
* Hard purge should remove raw private content, embeddings, and source text. It may preserve minimal non-content audit event metadata unless the admin explicitly purges those references.

### Contradiction and uncertainty

Define v1 contradiction conservatively:

* V1 displays `possible contradiction`, not definitive truth judgment.
* A possible contradiction may be detected when active claims have the same predicate and same normalized argument role set but incompatible values, incompatible polarity, or overlapping incompatible valid time ranges.
* Low confidence is displayed separately as uncertainty.
* Add fields or schema support where useful:

  * `polarity`: positive / negative / unknown.
  * `origin`: user / AI / inferred / imported.
  * optional modality may be deferred.

### Search MVP

Clarify search staging:

* M1 search minimum:

  * PostgreSQL full-text/token search over entity names, aliases, claim descriptions, tags, notes, and sources.
  * Graph filters by type, predicate, tag, date, confidence, provenance where data exists.
* M2 embedding search:

  * Optional.
  * Works only when embedding provider is configured and indexing is complete.
  * UI must gracefully hide/disable vector results when no embeddings exist.
  * UI should show embedding/indexing status.

### AGE stub boundary

Clarify acceptable AGE stubbing:

* M0/M1 may stub AGE projection.
* But canonical relational writes, `graph_outbox`, projector interface, and stub behavior must exist and be tested.
* AGE-specific graph traversal features must not be marked complete until real AGE projection/querying works.
* Before final v1 completion, real AGE projection/querying must support graph traversal features that depend on it.

### Rule language

Clarify reasoning staging:

* Rule negation target is stratified negation with safety checks.
* If implementation risk is high, M3 initial rule engine may ship without negation.
* Agents must not implement unrestricted Prolog negation-as-failure.
* Guided rule builder is M4 polish unless explicitly pulled earlier.
* Built-in rule packs and text syntax are higher priority than the builder.

### Custom schema migration

Clarify schema evolution:

* Schema definitions have versions.
* Stored data references schema version used at validation time.
* Full guided schema migration UI can be M4.
* AI-assisted schema migration proposals can be deferred.
* Existing data should never be silently rewritten or invalidated by schema changes.

### Backup/restore

Clarify backup levels:

* Portable JSON import/export: normal owner/admin Knowledge Base feature.
* Markdown export: human-readable.
* CSV/table import/export: structured subset.
* Full database backup/restore: server operator/admin CLI/docs, not ordinary user flow.

### Data modeling defaults

Apply these defaults:

* Use `knowledge_base_id`, not `workspace_id`.
* Built-in modules may be enabled/disabled, but destructive uninstall is out of scope for v1.
* Person and Character are separate schema types, with shared/common fields where useful.
* PersonalEvent and PlotEvent may share an Event base concept but should be schema-distinct.
* Source citations should support optional `excerpt`, `start_offset`, and `end_offset`.
* Entity merge should preserve aliases and old IDs through redirects or audit metadata where practical.
* Deleting an entity should soft-delete it by default and explain affected claims. Connected claims should become invalid/needs-review unless user deletes or reassigns them.
* AI proposal schema may support create/update/delete/merge, but UI may initially enable only create/update. Delete/merge proposals require extra confirmation.
* Imports should generate reviewable changes before graph mutation. Plain text import may create source notes directly if no extraction is attempted.

### Jobs, rate limits, security defaults

Apply these defaults:

* Job status UI: user-visible own jobs plus admin global status/dead-letter view.
* Rate limiting state should be Postgres-backed for production/reference. In-memory rate limiting is allowed only in dev/test.
* Cookie sessions require CSRF token/header for mutation requests.
* Personal access tokens use `Authorization: Bearer` and do not require CSRF, but still require auth, scopes, and rate limits.
* PAT scopes should include at least:

  * `kb:read`
  * `kb:write`
  * `import:write`
  * `export:read`
  * `ai:use`

### UI verification defaults

* Mobile browser is supported as responsive web UI, but no offline mobile-local graph database is required.
* Critical Playwright flows should include:

  * first admin setup
  * login/logout
  * create Knowledge Base
  * create entity
  * create claim
  * search
  * quick capture with mock provider
  * proposal accept/reject
* Stories with UI acceptance criteria require browser verification using the available browser/dev-browser/Playwright workflow.

### Ralph/Amp process defaults

* Every Ralph task should produce one small commit.
* Every task should update implementation plan / story status.
* PRD agent may normalize, clarify, split, and reorganize the PRD.
* PRD agent must not silently delete resolved decisions.
* If it finds conflicting decisions, it should resolve them using this prompt or list them explicitly in a `Remaining Open Questions` section.
* Replace `Open Questions: None currently` with a real `Open Questions / Human Decisions` section if any uncertainty remains.

## Required PRD output structure

Revise the PRD to include these sections, in a clean order:

1. Introduction.
2. Product Goals.
3. Non-Goals.
4. Glossary / Canonical Terminology.
5. User Personas / Main Use Cases.
6. Milestones and Scope.
7. Milestone Matrix mapping user stories to M0-M4.
8. User Stories, preferably split into smaller implementation-ready stories.
9. Functional Requirements.
10. Non-Functional Requirements.
11. Privacy, Consent, and AI Safety Requirements.
12. Data Model and Storage Requirements.
13. Search, AI/RAG, and Provider Requirements.
14. Rule Language and Reasoning Requirements.
15. Custom Schema and Schema Evolution Requirements.
16. Import, Export, and Backup Requirements.
17. Access Control, Authentication, and Networking Requirements.
18. Background Jobs and Operations Requirements.
19. Deployment Requirements.
20. Verification, Tooling, and Definition of Done.
21. Ralph/Amp Autonomous Workflow Constraints.
22. Success Metrics.
23. Remaining Open Questions / Human Decisions.
24. Changelog of PRD cleanup.

You may preserve the existing section names where reasonable, but the improved PRD must be easier for autonomous agents to follow than the current one.

## Required milestone model

Use this milestone model unless the current PRD has a compatible stricter one.

### M0 Foundation

Goal:
Bootable app with authentication, database connectivity, Knowledge Base selection, basic entity/claim CRUD, and architecture seams.

Must include:

* pnpm monorepo.
* React + Vite frontend.
* Express + TypeScript + Zod backend.
* PostgreSQL connection.
* Drizzle migrations.
* first admin setup.
* server-side sessions.
* Knowledge Base creation/selection.
* basic entity CRUD.
* basic claim CRUD.
* role/permission middleware foundation.
* audit event foundation.
* graph_outbox foundation.
* job table foundation.
* provider adapter interfaces.
* mock AI provider interface.
* AGE projector interface/stub.
* tests and verification commands.

Allowed stubs:

* AGE projection.
* AI providers.
* import/export.
* advanced schema UI.
* rules.

Not allowed to defer:

* canonical relational model.
* `knowledge_base_id` scoping.
* auth/session basics.
* permission middleware foundation.
* API validation.
* audit skeleton.
* graph_outbox skeleton.

### M1 Manual Graph

Goal:
First user-facing graph demo.

Must include:

* manual entity CRUD.
* manual claim CRUD.
* merge/delete flows.
* basic full-text/token search.
* graph filters.
* table/detail/source views.
* basic network view if feasible.
* browser verification and critical UI tests.

Allowed stubs:

* AI extraction.
* real AGE traversal if graph projection still stubbed, but UI must not claim AGE traversal is complete.
* advanced custom schemas.
* rule authoring.
* import/export.

### M2 AI/RAG

Goal:
AI-assisted capture, proposal review, consent, audit, and provider adapters.

Must include:

* quick capture.
* mock AI proposal flow.
* real provider adapter structure.
* local and remote provider settings.
* remote consent modes.
* separate remote embedding consent.
* AI call audit metadata.
* proposal accept/reject/edit.
* answer with citations using mock or configured provider.
* fallback search when AI unavailable.
* embedding job interface and status.

### M3 Reasoning

Goal:
Core differentiating reasoning feature.

Must include:

* built-in rule packs for personal relationship and reading/character maps.
* restricted Datalog-like text rule syntax.
* low-level predicates.
* simple rule execution on backend.
* inferred result labeling.
* result traceability.
* rule validation and runtime error panel.
* cached derived results where practical.

May stage later:

* guided builder.
* stratified negation.
* graph edit proposals from rules.
* advanced generated schema predicates.

### M4 Polish / Hardening

Goal:
Complete v1 polish and self-hosting readiness.

Must include:

* custom schema UI minimum.
* portable JSON import/export round trip.
* Markdown export.
* CSV/table subset import/export if included in final v1.
* operator backup/restore docs or CLI.
* deployment docs.
* hardening of roles, rate limits, jobs, AGE projection, AI provider adapters.
* mobile responsive polish.
* module polish for personal relationship and reading/character maps.

## Required Definition of Done by story type

Add a Definition of Done section similar to this.

### Backend/API story DoD

* Zod request/response schemas where applicable.
* Service/repository layer used.
* No direct DB/provider calls from UI.
* Permission checks applied.
* API tests using migrated test PostgreSQL container.
* Audit/job/outbox behavior tested where applicable.
* `pnpm verify:quick` passes.

### UI story DoD

* API integration uses shared schemas/types where practical.
* Browser verification completed.
* Playwright coverage for critical flows where applicable.
* Unauthorized actions are not only hidden in UI; backend must enforce permissions.
* `pnpm verify:quick` passes.

### AI story DoD

* Provider adapter interface used.
* Mock provider tests included.
* Remote consent behavior tested.
* Audit metadata tested.
* No remote calls without explicit consent.
* No raw prompt/response retention unless debug retention is enabled.
* Accepted AI writes require explicit confirmation.

### Graph mutation story DoD

* Canonical relational write.
* Audit event.
* graph_outbox event.
* Permission check.
* Soft-delete behavior if applicable.
* Tests verify side effects.

### Rule story DoD

* Parser/compiler validation tested.
* Sandbox constraints tested.
* Runtime timeout/error behavior tested.
* Result traceability tested.
* Rules cannot directly mutate graph data.

### Import/export story DoD

* Import creates reviewable changes before graph mutation where graph changes are involved.
* JSON export includes entities, claims, notes, sources, schemas, provenance, and rules.
* Export excludes secrets and raw debug logs by default.
* Round-trip test exists for portable JSON when implemented.

## Important prohibitions

The improved PRD must explicitly tell implementation agents not to:

* introduce a different package manager.
* introduce Python/Go backend services in v1.
* introduce Redis/BullMQ as required v1 infrastructure.
* call provider SDKs directly from UI or repositories.
* call remote AI without the consent/audit path.
* write AGE directly outside graph projection service.
* treat AGE as canonical source of truth.
* use `workspace_id` if the canonical field is `knowledge_base_id`.
* store JWTs in localStorage.
* rely on in-memory sessions in production/reference deployments.
* rely on durable local disk queues/cache for correctness.
* allow all CORS origins by default.
* apply AI or rule-generated graph writes without user confirmation.
* enable invalid rules.
* execute arbitrary JavaScript, SQL, filesystem, network, process, or unrestricted Prolog code from user-authored rules.
* silently mark stubbed AGE/AI/import/export behavior as complete.

## Expected final answer from you

Return:

1. The improved PRD in Markdown.
2. A concise changelog listing major fixes.
3. A list of any remaining open questions that still require human decision.
4. A short “Ralph readiness assessment” explaining whether the PRD is ready to be split into implementation tasks.

Do not write implementation code.
Do not start generating tasks unless you first finish the PRD cleanup.
