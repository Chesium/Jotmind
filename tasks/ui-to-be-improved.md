# AI Feature Backend/UI Gaps

This note summarizes AI-related backend features that are only partially exposed
in the current frontend. It is intended as handoff context for a coding agent
improving the UI.

## Current frontend coverage

- Server/user AI policy is visible and editable in `apps/web/src/AiPolicySettings.tsx`.
  - Server policy is editable by system admins.
  - User policy is editable by the signed-in user.
  - Effective non-KB policy is displayed.
- KB AI policy is visible in the selected Knowledge Base workspace.
  - KB admins/owners can edit the KB layer.
  - Viewers can read it.
  - Remote embeddings can be toggled with a browser confirmation.
- AI command interpretation is reachable from the selected KB workspace.
  - `CommandBox` in `apps/web/src/App.tsx` calls `runCommand()`.
  - It shows AI availability, repaired/low-confidence status, structured
    interpretation, create-preview JSON, interpreted search results, and fallback
    token search.
- AI answers are reachable from `apps/web/src/Answers.tsx`.
  - It calls `answerQuestion()`.
  - It shows generated answers, fact labels, citations, citation detail, and
    fallback token search.
- Quick capture and proposal review are reachable from `apps/web/src/Proposals.tsx`.
  - Editors can capture note/source text.
  - The UI shows extraction states: created, empty, unavailable, and error.
  - Pending proposals can be accepted, partially accepted, rejected, or edited as
    raw JSON.
- Vector search availability is surfaced indirectly.
  - Search, command, and answers show a "semantic/vector search unavailable"
    notice when backend responses report no embeddings.

## Gaps to improve

### 1. Provider configuration has no UI

Backend support exists for AI providers through `AI_PROVIDER_CONFIG` and
`apps/api/src/ai/*`, but users cannot configure providers from the web app.

Missing UI:

- Select provider kind: `ollama`, `openai-compatible`, `openai`, `anthropic`,
  or `mock`.
- Enter provider name/label.
- Enter base URL for local/OpenAI-compatible providers.
- Enter LLM model and embedding model where applicable.
- Enter API key for remote providers.
- Explain which providers are local vs remote.
- Show whether the active backend provider is configured and usable.

Important constraint:

- Provider config contains secrets such as `apiKey`. Do not put these into KB
  portable exports. Existing schema helper `toPortableProviderConfig()` strips
  secrets.

Backend references:

- `packages/schemas/src/ai.ts`
- `apps/api/src/ai/factory.ts`
- `apps/api/src/ai/{ollama,openai-compatible,anthropic,mock}.ts`

### 2. Embedding status/reindex UI is missing

Backend routes exist, but the web app does not expose them directly.

Backend routes:

- `GET /api/knowledge-bases/:kbId/embeddings`
- `POST /api/knowledge-bases/:kbId/embeddings/reindex`

Missing UI:

- Show embedding status for the selected KB:
  - vector search available/unavailable
  - generation available/unavailable
  - reason when unavailable
  - total embeddings
  - counts by target type
  - model, dimensions, last indexed time
  - provider kind
- Add a "Reindex embeddings" action for editors.
- Let editors choose optional target types: entity, claim, note, source.
- After enqueueing, show the job id/status and link or point users to the KB job
  status panel.

Backend references:

- `apps/api/src/embeddings/index.ts`
- `apps/api/src/embeddings/indexer.ts`
- `apps/api/src/jobs/handlers.ts`
- `packages/schemas/src/embeddings.ts`

Suggested web work:

- Add API helpers in `apps/web/src/api.ts` for embedding status and reindex.
- Add an `EmbeddingsPanel` component in its own file.
- Render it near KB AI policy/admin tooling, likely in the automation column.

### 3. Remote-per-request confirmation is not implemented in UI flow

The policy model supports `remote_per_request`, and the UI displays that mode.
However, command, answers, and quick capture do not currently ask for explicit
per-request confirmation before a remote provider call.

Missing UX:

- When effective policy is `remote_per_request`, show a confirmation dialog or
  inline confirmation before triggering remote AI.
- Confirmation should disclose:
  - provider
  - model
  - feature name
  - categories of content being sent
- Do not show raw prompts or secrets in audit/UI metadata.

Schema references:

- `remoteCallConfirmationSchema`
- `buildRemoteAiAuditMetadata()`
- `ResolvedAiPolicy.requiresPerRequestConfirmation`
- All in `packages/schemas/src/ai.ts`

Affected features:

- Command interpretation
- AI answers
- Quick capture extraction
- Embedding reindex when using remote embeddings

Note:

- Backend availability checks currently allow remote calls when policy permits
  remote. If true per-request consent is required, the API may need request body
  fields or headers proving consent, not just frontend-only confirmation.

### 4. Command create intent is preview-only

The command endpoint can return a `create` interpretation, and the frontend
shows a JSON preview. It does not turn that preview into a pending proposal.

Current behavior:

- `CommandBox` renders `command-create-preview`.
- The text says "review via Capture / Proposals", but there is no action to send
  the suggested changes into the proposal queue.

Possible improvement:

- Add a "Create proposal from suggestion" action.
- Store the structured changes as a pending proposal.
- Preserve provider/model/provenance/confirmation metadata if available.

Likely backend need:

- Either add an endpoint for creating a proposal from command interpretation, or
  reuse/extend proposal creation behavior safely.

### 5. AI proposal editing is raw JSON only

Pending proposal review is reachable, but editing candidate changes requires
manual JSON editing.

Possible improvement:

- Replace or supplement JSON editing with structured controls for:
  - create entity
  - create claim
  - create note
  - create source
- Keep raw JSON as an advanced escape hatch.

### 6. Frontend test coverage is thin for AI UI

Known current frontend test:

- `apps/web/src/App.test.tsx` has coverage for asking an AI answer and opening a
  cited claim detail.

Missing or limited frontend tests:

- Server/user AI policy editing.
- KB AI policy editing.
- Command interpretation UI states.
- Quick capture extraction states.
- Proposal accept/reject/edit UI.
- Embedding status/reindex UI, once added.
- Provider configuration UI, once added.
- Remote-per-request confirmation UI, once added.

## Suggested acceptance criteria for UI improvement

- A user can see whether AI is configured, which provider kind is active, and why
  AI generation is unavailable when it is unavailable.
- An admin/operator can configure provider settings without editing environment
  variables manually, or the UI clearly states that provider config is currently
  environment-only.
- A KB editor can see embedding status and enqueue a reindex job from the UI.
- Remote embedding consent remains distinct from general remote LLM consent.
- `remote_per_request` has an actual confirmation flow before remote AI calls.
- Command `create` suggestions can be promoted into the reviewable proposal flow
  or are clearly labeled as non-actionable preview-only.
- New UI work includes focused tests for the visible states and role gates.

# Cross-Panel Reactiveness Gaps

The current UI is mostly composed of independent panels that each fetch their own
copy of Knowledge Base data on mount or when `kb.id` changes. A mutation usually
refreshes only the panel that performed the mutation. Nearby panels often keep
stale local state until the user reloads, reselects the KB, or manually reruns an
operation.

This is visible in `apps/web/src/App.tsx`, where the selected KB workspace
renders sibling panels:

- `CommandBox`
- `Answers`
- `GraphViews`
- `Search`
- `Entities`
- `Claims`
- `Capture`
- `Modules`
- `SchemaDefinitions`
- `Imports`
- `Proposals`
- `Rules`
- `KbAiPolicy`
- `KbAdmin`

## Main cause

- `Entities` owns `listEntities()` state and refreshes after entity mutations.
- `Claims` owns separate `listClaims()` and `listEntities()` state and refreshes
  only after claim mutations or KB changes.
- `Capture` owns separate notes/sources/claims/excerpts state and refreshes only
  after capture/citation mutations or KB changes.
- `GraphViews` owns separate entities/claims/notes/sources/excerpts state and
  refreshes only after KB changes or edits made inside `GraphViews`.
- `Search`, `CommandBox`, and `Answers` hold the most recent response and do not
  automatically rerun when graph data changes.
- `KbAdmin`, `Imports`, and `Proposals` each load job/proposal/audit state
  independently and do not poll or subscribe to related job/proposal changes.

## Concrete stale-state cases

### 1. Entity created in `Entities` is not available in `Claims`

Repro:

1. Select a KB.
2. Add an entity in the `Entities` panel.
3. Move to `Claims` -> Add claim -> Arguments -> Entity dropdown.

Expected:

- The new entity should be available immediately.

Current:

- `Entities` refreshes its own `items`.
- `Claims` has a separate `entities` array fetched by its own `refresh()`, so the
  dropdown remains stale until reload/reselect or a claims-side refresh happens.

Relevant files:

- `apps/web/src/App.tsx` `Entities`
- `apps/web/src/App.tsx` `Claims`

### 2. Entity mutations do not refresh `GraphViews`

Repro:

1. Add, edit, delete, or merge an entity in `Entities`.
2. Look at `GraphViews` network/table/detail/timeline.

Current:

- The graph views keep their old entity/claim/note/source snapshot.
- Merge is especially stale because claim arguments can be retargeted server-side
  but `Claims` and `GraphViews` do not know.

Relevant files:

- `apps/web/src/App.tsx` `Entities`
- `apps/web/src/GraphViews.tsx`

### 3. Claim mutations do not refresh capture citation dropdowns or graph views

Repro:

1. Create or delete a claim in `Claims`.
2. Go to `Capture` -> citation form -> claim dropdown.
3. Check `GraphViews` table/network/detail.

Current:

- `Claims` refreshes itself.
- `Capture` has its own `claims` array and remains stale.
- `GraphViews` has its own `claims` array and remains stale.

Relevant files:

- `apps/web/src/App.tsx` `Claims`
- `apps/web/src/App.tsx` `Capture`
- `apps/web/src/GraphViews.tsx`

### 4. Notes/sources/citations created in `Capture` do not refresh graph views

Repro:

1. Add a note, source, or source excerpt in `Capture`.
2. Go to `GraphViews` -> Sources & Notes or Timeline.

Current:

- `Capture` refreshes itself.
- `GraphViews` keeps its previous notes/sources/excerpts snapshot.

Relevant files:

- `apps/web/src/App.tsx` `Capture`
- `apps/web/src/GraphViews.tsx`

### 5. Quick capture/proposal acceptance does not refresh manual graph panels

Repro:

1. Use `Proposals` quick capture.
2. Accept a proposal that creates entities/claims/notes/sources.
3. Look at `Entities`, `Claims`, `Capture`, and `GraphViews`.

Current:

- `Proposals` refreshes the proposal queue.
- Other graph panels do not refresh, even though accepted proposal changes create
  canonical graph records.

Relevant files:

- `apps/web/src/Proposals.tsx`
- `apps/web/src/App.tsx` `Entities`, `Claims`, `Capture`
- `apps/web/src/GraphViews.tsx`

### 6. Imports create proposals asynchronously, but related panels do not update

Repro:

1. Queue an import in `Imports`.
2. Wait for the import job to finish.
3. Look at `Proposals` and `KbAdmin` job status.

Current:

- `Imports` has a manual "Refresh status" button for its own job list.
- `Proposals` does not poll or refresh when the import job creates a pending
  proposal.
- `KbAdmin` job status is loaded once when the panel mounts.

Relevant files:

- `apps/web/src/Imports.tsx`
- `apps/web/src/Proposals.tsx`
- `apps/web/src/KbAdmin.tsx`

### 7. Accepted rule inferences do not refresh claims or graph views

Repro:

1. Run a rule in `Rules`.
2. Accept an inferred result as a stored claim.
3. Look at `Claims`, `GraphViews`, `Search`, or `Answers`.

Current:

- `Rules` marks the result accepted in local `acceptedResults`.
- The newly created claim is not pushed to sibling panels.

Relevant files:

- `apps/web/src/Rules.tsx`
- `apps/web/src/App.tsx` `Claims`
- `apps/web/src/GraphViews.tsx`

### 8. Module install does not refresh schema/rule sibling panels

Repro:

1. Install a module in `Modules`.
2. Look at `SchemaDefinitions` and `Rules`.

Current:

- `Modules` refreshes its own install status.
- Schema/rule panels keep their previous lists until reload/reselect or their own
  refresh path is triggered.

Relevant files:

- `apps/web/src/Modules.tsx`
- `apps/web/src/SchemaDefinitions.tsx`
- `apps/web/src/Rules.tsx`

### 9. Search, command, and answer results become stale after graph changes

Repro:

1. Run `Search`, `Command`, or `Answers`.
2. Add/edit/delete graph records in another panel.

Current:

- Previous result panes remain visible and are not marked stale.
- User must manually rerun the query/question/command.

Relevant files:

- `apps/web/src/App.tsx` `Search`
- `apps/web/src/App.tsx` `CommandBox`
- `apps/web/src/Answers.tsx`

### 10. Portable JSON import creates a new KB but does not refresh KB list

Repro:

1. Import a portable JSON backup in `KbAdmin`.
2. Try to select the newly imported KB from the KB list.

Current:

- `ExportBackup` displays import success.
- The parent `KnowledgeBases` list is not refreshed, so the new KB is not
  immediately selectable.

Relevant files:

- `apps/web/src/KbAdmin.tsx`
- `apps/web/src/App.tsx` `KnowledgeBases`

### 11. Server AI policy changes do not refresh selected-KB AI policy panel

Repro:

1. Change server or user AI policy in the global `AiPolicySettings`.
2. Look at the selected KB's `KbAiPolicy` effective policy.

Current:

- Global policy panel refreshes itself.
- KB policy panel has its own state and only refreshes on `kb.id`, so its
  effective policy can be stale.

Relevant files:

- `apps/web/src/AiPolicySettings.tsx`
- `apps/web/src/App.tsx`

## Suggested fix direction

Prefer one of these approaches instead of adding ad hoc sibling refs everywhere:

- Introduce a selected-KB data context with shared state and mutation helpers.
- Introduce a lightweight invalidation bus keyed by domains, such as:
  - `entities`
  - `claims`
  - `notes`
  - `sources`
  - `sourceExcerpts`
  - `proposals`
  - `jobs`
  - `audit`
  - `schemas`
  - `rules`
  - `aiPolicy`
- Use a query/cache library pattern and invalidate queries after mutations.
- Add manual refresh buttons only as a fallback, not as the primary sync model.

Suggested invalidation mapping:

- Entity create/update/delete/merge invalidates:
  - `entities`
  - `claims` (merge can retarget claim arguments)
  - `graphViews`
  - `searchResults`
  - `answers`
  - `audit`
- Claim create/update/delete invalidates:
  - `claims`
  - `graphViews`
  - `captureClaimDropdowns`
  - `searchResults`
  - `answers`
  - `audit`
- Note/source/excerpt create/update/delete invalidates:
  - `notes`
  - `sources`
  - `sourceExcerpts`
  - `graphViews`
  - `searchResults`
  - `answers`
  - `audit`
- Proposal accept invalidates:
  - `proposals`
  - `entities`
  - `claims`
  - `notes`
  - `sources`
  - `sourceExcerpts`
  - `graphViews`
  - `searchResults`
  - `answers`
  - `audit`
- Import enqueue/job completion invalidates:
  - `jobs`
  - `proposals`
  - `audit`
- Rule accepted inference invalidates:
  - `claims`
  - `graphViews`
  - `searchResults`
  - `answers`
  - `audit`
- Module install invalidates:
  - `modules`
  - `schemas`
  - `rules`
  - `audit`
- AI policy update invalidates:
  - global policy view
  - KB policy view
  - AI availability surfaces in command/answers/capture/embeddings

## Suggested acceptance criteria

- Adding an entity immediately makes it available in the claim argument entity
  dropdown without page reload or KB reselect.
- Entity/claim/note/source changes immediately update `GraphViews`.
- New claims immediately appear in citation dropdowns.
- Accepted proposals immediately update manual graph panels and graph views.
- Import jobs either poll or provide a clear refresh that updates both job status
  and the proposal queue.
- Rule-accepted claims immediately appear in Claims/GraphViews.
- Search/Command/Answers are either invalidated with a visible "results may be
  stale" state or rerun automatically when relevant graph data changes.
- AI policy changes update all visible effective-policy and AI-availability
  indicators.
- Add regression tests for cross-panel updates, especially:
  - add entity -> claim argument dropdown updates
  - add claim -> capture citation dropdown updates
  - add entity/claim -> graph table/network updates
  - accept proposal -> entities/claims/graph views update
