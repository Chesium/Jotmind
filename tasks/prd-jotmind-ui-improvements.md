# PRD: JotMind UI Improvements

## Introduction

JotMind already has backend support for several AI, embedding, proposal, import,
rule, schema, and policy workflows, but the web UI exposes only part of that
functionality and many selected-Knowledge-Base panels do not react to mutations
made in sibling panels. This feature improves the selected-KB web experience by
making important backend capabilities visible and actionable, and by introducing
a consistent cross-panel invalidation model so users no longer need to reload or
reselect a Knowledge Base to see recent changes.

The work must preserve JotMind's existing privacy-first product constraints:
remote AI remains opt-in, remote embeddings remain separate from general remote
LLM consent, provider secrets must never leak into exports or audit metadata,
and AI-generated graph writes must continue to flow through reviewable proposals
instead of auto-applying.

## Goals

- Surface whether AI generation and embedding generation are configured,
  permitted, and usable for the selected Knowledge Base.
- Let authorized users inspect embedding index status and enqueue embedding
  reindex jobs from the web UI.
- Enforce visible per-request confirmation before remote AI or remote embedding
  calls when effective policy requires `remote_per_request`.
- Reduce non-actionable AI preview states by allowing command `create`
  suggestions to enter the existing proposal review flow, or by clearly labeling
  them as preview-only if backend support is intentionally deferred.
- Replace stale selected-KB panels with a predictable invalidation/refresh model
  after graph, proposal, import, rule, module, and policy mutations.
- Add focused frontend regression coverage for the most visible AI UI and
  cross-panel update cases.

## User Stories

### US-001: Establish selected-KB invalidation model
**Description:** As a developer, I want a shared selected-KB invalidation mechanism so sibling panels can refresh consistently after mutations.

**Acceptance Criteria:**
- [ ] Introduce one clear invalidation approach for selected-KB UI data, such as a lightweight domain-keyed invalidation bus, selected-KB data context, or query/cache invalidation pattern.
- [ ] Invalidation domains cover at minimum: entities, claims, notes, sources, source excerpts, graph views, proposals, jobs, audit, schemas, rules, modules, AI policy, search results, command results, and answers.
- [ ] The implementation avoids ad hoc parent refs for individual sibling panels unless a localized escape hatch is clearly necessary.
- [ ] Existing panel-local refresh behavior still works when a panel is used in isolation.
- [ ] Typecheck/lint passes.

### US-002: Refresh claim entity dropdowns after entity mutations
**Description:** As a KB editor, I want entities created or changed in the Entities panel to be available immediately in claim argument controls so that I can keep building the graph without reloading.

**Acceptance Criteria:**
- [ ] Creating an entity in `Entities` invalidates the entity data used by `Claims`.
- [ ] Editing, deleting, or merging an entity invalidates entity and claim-dependent data because merges can retarget claim arguments server-side.
- [ ] The claim argument entity dropdown shows newly created entities without page reload or KB reselect.
- [ ] Add a regression test for add entity -> claim argument dropdown updates.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-003: Refresh graph views after graph record mutations
**Description:** As a KB user, I want graph views to reflect entity, claim, note, source, and citation changes immediately so that table, network, detail, source/note, and timeline views stay trustworthy.

**Acceptance Criteria:**
- [ ] Entity create/update/delete/merge invalidates `GraphViews` data.
- [ ] Claim create/update/delete invalidates `GraphViews` data.
- [ ] Note, source, and source excerpt create/update/delete invalidates `GraphViews` data.
- [ ] GraphViews preserves existing projection-status banners and AGE fallback behavior while refreshing relational data.
- [ ] Add regression coverage for add entity/claim -> graph table or network updates.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-004: Refresh capture citation controls after claim mutations
**Description:** As a KB editor, I want newly created claims to appear immediately in capture citation controls so that I can cite notes and sources without reloading.

**Acceptance Criteria:**
- [ ] Claim create/update/delete invalidates the claims list used by `Capture` citation forms.
- [ ] New claims appear in citation dropdowns without page reload or KB reselect.
- [ ] Deleted claims no longer appear as selectable citation targets after refresh.
- [ ] Add a regression test for add claim -> capture citation dropdown updates.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-005: Refresh graph panels after proposal acceptance
**Description:** As a KB editor, I want accepted proposals to update graph panels immediately so that AI capture and import review feel connected to the canonical graph.

**Acceptance Criteria:**
- [ ] Accepting a proposal invalidates proposals, entities, claims, notes, sources, source excerpts, graph views, search results, answers, and audit data as applicable.
- [ ] Entities created by an accepted proposal appear in the Entities panel without reload.
- [ ] Claims created by an accepted proposal appear in Claims and GraphViews without reload.
- [ ] Notes or sources created by an accepted proposal appear in Capture/GraphViews without reload.
- [ ] Add regression coverage for accept proposal -> entities/claims/graph views update.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-006: Keep import jobs, proposal queue, and job status in sync
**Description:** As a KB editor, I want import job completion to update related job and proposal UI so that I know when imported candidates are ready for review.

**Acceptance Criteria:**
- [ ] Import enqueue invalidates jobs and audit data.
- [ ] Import job completion either polls or provides a clear refresh path that updates both import status and the proposal queue.
- [ ] When an import creates a pending proposal, the Proposals panel can show it without page reload or KB reselect.
- [ ] `KbAdmin` job status does not remain permanently stale after selected-KB jobs change.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-007: Refresh claims and graph views after accepting inferred rule results
**Description:** As a KB editor, I want claims created from rule inferences to appear in Claims and GraphViews immediately so that accepted reasoning results become visible canonical graph data.

**Acceptance Criteria:**
- [ ] Accepting an inferred result invalidates claims, graph views, search results, answers, and audit data.
- [ ] The new inferred claim appears in the Claims panel without reload.
- [ ] The new inferred claim appears in GraphViews without reload.
- [ ] The Rules panel continues to mark the accepted inferred result as accepted.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-008: Refresh schema and rule panels after module installation
**Description:** As a KB editor, I want installed modules to update schema and rule sibling panels immediately so that newly installed module content is discoverable.

**Acceptance Criteria:**
- [ ] Installing a module invalidates modules, schemas, rules, and audit data.
- [ ] New module-provided schema definitions appear in `SchemaDefinitions` without reload or KB reselect.
- [ ] New module-provided rule packs or installed rules appear in `Rules` without reload or KB reselect.
- [ ] The Modules panel still shows accurate installed/skipped status for idempotent installs.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-009: Mark search, command, and answer results stale after graph changes
**Description:** As a KB user, I want previous search, command, and answer results to be marked stale or rerun after graph data changes so that I do not mistake old results for current state.

**Acceptance Criteria:**
- [ ] Entity, claim, note, source, source excerpt, proposal-accept, and inferred-claim mutations invalidate search, command, and answer result freshness.
- [ ] `Search`, `CommandBox`, and `Answers` either visibly mark existing results as stale or automatically rerun the last query when relevant data changes.
- [ ] If auto-rerun is used, it avoids repeated network loops and keeps user-entered drafts intact.
- [ ] Stale-state messaging tells the user what action to take, for example “Graph data changed. Rerun this search for current results.”
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-010: Refresh Knowledge Base list after portable import
**Description:** As a user importing a portable JSON backup, I want the imported Knowledge Base to become selectable immediately so that backup restore feels complete.

**Acceptance Criteria:**
- [ ] Successful portable JSON import in `KbAdmin` invalidates the parent Knowledge Base list.
- [ ] The newly imported Knowledge Base appears in the Knowledge Base selector/list without page reload.
- [ ] Import success messaging identifies the imported Knowledge Base name or id when available.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-011: Refresh AI policy availability surfaces after policy changes
**Description:** As a KB user, I want server, user, and KB AI policy changes to update every visible effective-policy and AI-availability indicator so that privacy controls are clear and current.

**Acceptance Criteria:**
- [ ] Updating server AI policy invalidates global policy state, selected-KB effective policy, and AI availability surfaces.
- [ ] Updating user AI policy invalidates global policy state, selected-KB effective policy, and AI availability surfaces.
- [ ] Updating KB AI policy invalidates selected-KB effective policy and AI availability surfaces.
- [ ] `CommandBox`, `Answers`, quick capture/proposals, and embeddings UI reflect current effective policy without reload.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-012: Show AI provider configuration/readiness in the UI
**Description:** As an admin/operator, I want to understand which AI provider is active and whether it is usable so that I can diagnose AI availability without reading environment variables.

**Acceptance Criteria:**
- [ ] The UI shows the active provider kind when backend configuration exposes it: `ollama`, `openai-compatible`, `openai`, `anthropic`, or `mock`.
- [ ] The UI shows provider label/name, LLM model, embedding model, base URL, verification/readiness state, and local-vs-remote classification when available.
- [ ] If provider configuration remains environment-only, the UI clearly states that provider config is managed by server environment and cannot be edited in the browser.
- [ ] API keys and other secrets are never displayed, returned unnecessarily to the browser, logged in client metadata, or included in portable KB exports.
- [ ] Mock providers are visibly labeled as deterministic demo output when exposed.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-013: Optional provider configuration editing for authorized operators
**Description:** As an admin/operator, I want to configure provider settings from the web UI when the backend supports persisted provider config so that I do not need to edit deployment environment variables for routine setup.

**Acceptance Criteria:**
- [ ] If in-browser provider editing is implemented, only system admins can create/update server-level provider configuration.
- [ ] The provider form supports provider kind, display name/label, base URL where applicable, LLM model, embedding model, and API key where applicable.
- [ ] Existing API keys are treated as write-only secrets; the UI must not reveal stored secret values.
- [ ] Saving provider configuration validates required fields for the selected provider kind.
- [ ] If backend support for persisted provider config is deferred, the UI does not show non-functional edit controls and instead links or points to environment-only setup guidance.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-014: Show embedding status for the selected Knowledge Base
**Description:** As a KB user, I want to see embedding index status for the selected Knowledge Base so that I understand whether vector search and embedding generation are available.

**Acceptance Criteria:**
- [ ] Add API helpers in `apps/web/src/api.ts` for `GET /api/knowledge-bases/:kbId/embeddings`.
- [ ] Add an `EmbeddingsPanel` or equivalent selected-KB UI surface near KB AI policy/admin automation tooling.
- [ ] The panel shows vector search available/unavailable and generation available/unavailable as distinct states.
- [ ] The panel shows unavailable reasons when provided by the backend.
- [ ] The panel shows total embeddings, counts by target type, model, dimensions, last indexed time, and provider kind when present in the response.
- [ ] Viewer-role users can read embedding status if the backend permits the route.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-015: Enqueue embedding reindex jobs from the UI
**Description:** As a KB editor, I want to enqueue embedding reindex jobs from the web UI so that I can rebuild vector search after graph changes or provider changes.

**Acceptance Criteria:**
- [ ] Add API helper in `apps/web/src/api.ts` for `POST /api/knowledge-bases/:kbId/embeddings/reindex`.
- [ ] KB editors can trigger “Reindex embeddings”; viewers cannot trigger it.
- [ ] Editors can optionally choose target types: entity, claim, note, and source.
- [ ] If remote embeddings would be used, the UI preserves remote embedding consent as separate from remote LLM consent.
- [ ] After enqueueing, the UI shows the returned job id/status and points users to the selected-KB job status panel or displays a direct status link/summary.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-016: Confirm remote AI calls when policy requires per-request consent
**Description:** As a privacy-conscious user, I want explicit confirmation before each remote AI call when effective policy is `remote_per_request` so that remote data sharing is intentional.

**Acceptance Criteria:**
- [ ] Before command interpretation triggers a remote provider call under `remote_per_request`, the UI asks for confirmation.
- [ ] Before AI answer generation triggers a remote provider call under `remote_per_request`, the UI asks for confirmation.
- [ ] Before quick capture extraction triggers a remote provider call under `remote_per_request`, the UI asks for confirmation.
- [ ] Before embedding reindex triggers remote embedding generation under `remote_per_request`, the UI asks for confirmation and treats remote embeddings as a distinct consent category.
- [ ] Confirmation discloses provider, model, feature name, and categories of content being sent.
- [ ] Confirmation does not display raw prompts, API keys, or hidden system metadata.
- [ ] Backend request metadata or headers prove user confirmation if backend routes require confirmation enforcement; frontend-only confirmation is not considered sufficient for true policy enforcement if the backend currently cannot distinguish confirmed calls.
- [ ] Remote-call audit metadata uses allowlisted fields only and does not include raw prompts or secrets.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-017: Promote command create suggestions into proposal flow
**Description:** As a KB editor, I want command `create` suggestions to become reviewable proposals so that useful AI-created structure can be accepted through the normal safe workflow.

**Acceptance Criteria:**
- [ ] When `CommandBox` receives a `create` interpretation and the user is an editor, it offers a “Create proposal from suggestion” action if backend support exists.
- [ ] The action stores structured candidate changes as a pending proposal and never writes directly to canonical graph records.
- [ ] Provider, model, provenance, and confirmation metadata are preserved when available and safe to store.
- [ ] The new proposal appears in the Proposals panel without reload.
- [ ] If backend proposal creation from command interpretation is deferred, the create preview is clearly labeled as non-actionable preview-only and the UI does not imply it has been queued.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-018: Improve proposal editing beyond raw JSON
**Description:** As a KB editor reviewing AI or import proposals, I want structured editing controls for common proposal item types so that I do not need to hand-edit JSON for routine corrections.

**Acceptance Criteria:**
- [ ] Pending proposal items for create entity can be edited through structured fields for type, name, aliases/tags where supported, description, and properties.
- [ ] Pending proposal items for create claim can be edited through structured fields for predicate, arguments, confidence, timestamps/properties where supported, and provenance-safe metadata.
- [ ] Pending proposal items for create note and create source can be edited through structured title/content/source fields where supported by the proposal schema.
- [ ] Raw JSON editing remains available as an advanced escape hatch.
- [ ] Structured edits are validated against the same proposal change schema before saving.
- [ ] Invalid edits cannot be accepted or executed.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-019: Add frontend coverage for existing AI policy and AI workflow states
**Description:** As a developer, I want focused frontend tests for AI-related UI states so regressions in privacy and review workflows are caught early.

**Acceptance Criteria:**
- [ ] Add or extend tests for server/user AI policy display and editing role gates.
- [ ] Add or extend tests for KB AI policy display and editing role gates.
- [ ] Add or extend tests for command interpretation states: unavailable, interpreted search, low-confidence/fallback, and create preview.
- [ ] Add or extend tests for quick capture extraction states: created, empty, unavailable, and error.
- [ ] Add or extend tests for proposal accept/reject/edit visible behavior.
- [ ] Tests use deterministic mock providers and do not require remote provider credentials or network calls.
- [ ] Typecheck/lint passes.

### US-020: Add frontend coverage for new embedding/provider UI
**Description:** As a developer, I want tests for embedding and provider UI so operators can trust setup and indexing screens.

**Acceptance Criteria:**
- [ ] Add tests for embedding status available/unavailable states.
- [ ] Add tests for embedding generation unavailable reasons.
- [ ] Add tests for reindex action visibility by role.
- [ ] Add tests for reindex enqueue success showing job id/status.
- [ ] Add tests for provider configuration/readiness display, including local/remote/mock labels.
- [ ] Tests assert that API keys or secret values are not rendered.
- [ ] Typecheck/lint passes.

## Functional Requirements

- FR-1: The selected-KB UI must use a consistent invalidation mechanism for data
  domains touched by sibling-panel mutations.
- FR-2: Entity mutations must invalidate entities, claim-dependent entity
  dropdowns, graph views, search results, answers, and audit data.
- FR-3: Entity merge must also invalidate claims because server-side retargeting
  can change claim arguments.
- FR-4: Claim mutations must invalidate claims, capture citation dropdowns,
  graph views, search results, answers, and audit data.
- FR-5: Note, source, and source-excerpt mutations must invalidate notes,
  sources, source excerpts, graph views, search results, answers, and audit data.
- FR-6: Proposal acceptance must invalidate proposals and every canonical data
  domain represented by created records.
- FR-7: Import enqueue and import job completion must update job status and make
  generated proposals visible without full-page reload.
- FR-8: Accepting an inferred rule result as a claim must refresh Claims,
  GraphViews, search-result freshness, answer freshness, and audit surfaces.
- FR-9: Module installation must refresh module, schema, rule, and audit surfaces.
- FR-10: Portable JSON import that creates a new Knowledge Base must refresh the
  parent Knowledge Base list.
- FR-11: AI policy updates at server, user, or KB scope must refresh every
  effective-policy and AI-availability surface visible in the selected-KB UI.
- FR-12: Search, CommandBox, and Answers must not silently present old results as
  current after relevant graph data changes; they must either rerun or show a
  visible stale-results state.
- FR-13: The UI must show selected-KB embedding status using the existing
  embeddings status API.
- FR-14: KB editors must be able to enqueue embedding reindex jobs using the
  existing embeddings reindex API.
- FR-15: Embedding reindex target-type selection must support entity, claim,
  note, and source.
- FR-16: The UI must distinguish vector-search availability from embedding
  generation availability.
- FR-17: The UI must show provider/readiness information when the backend exposes
  safe non-secret provider metadata.
- FR-18: Provider API keys and secrets must never be displayed, logged in UI
  metadata, or included in portable exports.
- FR-19: If provider configuration remains environment-only, the UI must clearly
  say so instead of presenting non-functional edit controls.
- FR-20: When effective policy requires `remote_per_request`, command, answers,
  quick capture, and remote embedding reindex flows must require explicit user
  confirmation before remote calls.
- FR-21: Remote confirmation UI must disclose provider, model, feature name, and
  categories of content sent.
- FR-22: Remote confirmation and audit metadata must not expose raw prompts,
  raw content beyond disclosed categories, model responses, API keys, or secrets.
- FR-23: Command `create` suggestions must either be promotable into pending
  proposals or clearly labeled as non-actionable preview-only.
- FR-24: Proposal editing must provide structured controls for common create
  entity, create claim, create note, and create source changes, while preserving
  raw JSON as an advanced fallback.
- FR-25: New and changed UI behavior must include focused regression tests for
  role gates, stale-state prevention, and visible AI/embedding states.

## Non-Goals

- Do not replace the existing backend proposal review model with direct AI writes
  to canonical graph records.
- Do not make remote AI or remote embeddings enabled by default.
- Do not merge remote embedding consent with general remote LLM consent.
- Do not include provider API keys, secrets, or full prompts in portable exports,
  audit events, browser-visible metadata, or test fixtures.
- Do not require live OpenAI, Anthropic, Ollama, or other external provider
  credentials for normal verification.
- Do not replace the existing GraphViews projection-status and AGE fallback model.
- Do not introduce a large application-wide state management framework unless a
  lightweight invalidation/context approach is insufficient.
- Do not build a full guided schema migration UI as part of proposal editing.
- Do not implement unrelated visual redesign or layout polish beyond what is
  needed for these workflows to be discoverable and usable.

## Design Considerations

- Place embedding status/reindex UI near selected-KB AI policy or automation
  tooling so users understand the relationship between policy, provider
  availability, and vector search.
- Use explicit local/remote/mock labels wherever provider behavior affects
  privacy or user expectations.
- Prefer inline stale-result banners over silently clearing user results; users
  should understand why a result needs rerunning.
- Keep manual refresh buttons as a fallback, not as the primary sync model.
- Keep role-gated controls visible-but-disabled with explanatory copy where that
  improves discoverability; hide only when existing UI patterns already do so.
- Use existing test ids and component conventions where possible. Add stable
  test ids for new embedding, provider, stale-results, and structured-proposal
  controls.

## Technical Considerations

- Existing relevant frontend files include:
  - `apps/web/src/App.tsx` for selected-KB composition, `Entities`, `Claims`,
    `Capture`, `Search`, and `CommandBox`.
  - `apps/web/src/GraphViews.tsx` for graph table/network/detail/source/timeline
    views and projection-status UI.
  - `apps/web/src/Answers.tsx` for AI answers.
  - `apps/web/src/Proposals.tsx` for quick capture and proposal review.
  - `apps/web/src/Imports.tsx` for import queue/status UI.
  - `apps/web/src/KbAdmin.tsx` for KB admin, jobs, and portable import/export.
  - `apps/web/src/AiPolicySettings.tsx` for server/user/KB AI policy UI.
  - `apps/web/src/Modules.tsx`, `apps/web/src/SchemaDefinitions.tsx`, and
    `apps/web/src/Rules.tsx` for module/schema/rule workflows.
  - `apps/web/src/api.ts` for web API helpers.
- Existing relevant backend/schema references include:
  - `packages/schemas/src/ai.ts` for policy resolution, remote confirmation
    schema, and remote audit metadata helpers.
  - `packages/schemas/src/embeddings.ts` and `apps/api/src/embeddings/*` for
    embedding status and reindex behavior.
  - `apps/api/src/ai/factory.ts` and provider adapters under `apps/api/src/ai/`
    for provider kinds and readiness constraints.
  - `apps/api/src/jobs/handlers.ts` for import, embedding, rule, and graph job
    behavior.
- If adding backend support for provider metadata or command-create proposal
  creation, use shared Zod schemas and existing Express/router/store seams.
- If adding backend enforcement for `remote_per_request`, prefer explicit
  validated request body fields or headers over frontend-only confirmation.
- Tests must use deterministic mock AI/embedding providers and remain compatible
  with the existing no-infra verification tier.

## Success Metrics

- A KB editor can create an entity and use it in a claim argument dropdown
  without reload or KB reselect.
- A KB editor can create a claim and immediately cite it from Capture without
  reload or KB reselect.
- GraphViews reflects entity, claim, note, source, proposal-accept, and
  inferred-claim changes without reload or KB reselect.
- Users no longer see stale Search, Command, or Answers output without either a
  visible stale warning or an automatic refresh.
- A KB editor can inspect embedding status and enqueue a reindex job in the web
  UI.
- Users can tell whether AI is unavailable because of missing provider config,
  policy restrictions, lack of embeddings, or another backend-provided reason.
- Remote per-request policy produces an explicit confirmation step before remote
  AI or remote embedding work.
- New regression tests cover the highest-risk stale-panel and AI UI states.

## Open Questions

- Should stale Search, Command, and Answers results rerun automatically, or is a
  visible stale banner with a manual rerun button preferred for predictable cost
  and privacy?
- Should provider configuration be editable in the database-backed UI for V1, or
  should V1 only expose read-only environment-managed provider readiness?
- Does the backend already expose enough safe provider metadata for a readiness
  panel, or is a new provider-status endpoint required?
- Should `remote_per_request` enforcement be added to all AI/embedding backend
  routes in the same implementation wave as the UI confirmation, or staged with
  frontend disclosure first and backend enforcement immediately following?
- Should command `create` suggestion promotion reuse the existing capture/proposal
  route shape, or add a dedicated command-to-proposal endpoint with narrower
  validation and provenance handling?
