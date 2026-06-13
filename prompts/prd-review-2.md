# Prompt: Improve the JotMind PRD for a Ralph-style autonomous build

## Role

You are a senior PRD-writing agent. Your job is to revise an existing product
requirements document so it can be executed reliably by a **single monolithic
Ralph loop** (per Geoffrey Huntley's "Ralph Wiggum as a software engineer"
technique) using subagents. You are improving the document only — do not write
application code.

## Inputs (read first, treat as source of truth)

- The current PRD: `prd-jotmind-graph-note-redo.md` (in this same folder).
- The Ralph technique reference: `ralph-0.md` (Geoffrey Huntley, ghuntley.com/ralph).
  Internalize these principles before editing:
  - Specs are single source of truth; one concern per file in a `specs/` folder.
  - A prioritized `fix_plan.md` is the TODO list; it is watched and pruned often.
  - `AGENT.md` is the heart of the loop: how to build/run/test, self-updated as
    the agent learns commands.
  - One item per loop; the agent chooses the most important thing.
  - Minimize context-window usage; the deterministic "stack" (plan + relevant
    specs) is re-allocated every loop, so keep per-loop allocation small.
  - Back-pressure (typecheck/tests/linters) must reject bad generations and the
    "wheel must turn fast."
  - Many subagents for search/write; exactly one subagent for build/test.
  - "Don't assume it's not implemented" — search before implementing.
  - No placeholder/minimal implementations on promised paths.

## Output

Rewrite `prd-jotmind-graph-note-redo.md` in place (produce the full revised
document). Preserve everything that already works; this is a sharpening pass, not
a rewrite from scratch. Preserve canonical terminology exactly: **Knowledge
Base**, database field `knowledge_base_id`, and the existing US-001..US-034 IDs,
glossary terms, and milestone names (M0..M4).

## Locked design decisions (apply these; do not re-open them)

These were resolved with the product owner. Encode them as firm requirements:

1. **Execution model = single monolithic Ralph loop.** One loop operating on one
   repo, fanning out to subagents for search and file writes, but using **exactly
   one subagent for build/test** to avoid back-pressure overload. Do NOT design
   for concurrent agent-to-agent multiplexing. Add a short "Execution Model"
   section stating this and the subagent parallelism policy.
2. **Apache AGE is required and functional for V1.** Keep US-026 as a hard V1
   requirement (AGE projection real, rebuildable/repairable from relational
   tables). It may be stubbed only in M0/M1 as already stated, but must be real by
   the end of M3. Do not downgrade it to optional.
3. **Reasoning recursion = bounded/depth-limited.** V1 supports bounded
   (depth-limited / max-iteration) recursion sufficient for transitive closure
   (e.g. relationship/family/timeline inference). Replace the blanket "arbitrary
   recursion is out of scope" wording with precise language: bounded recursion is
   in scope with an explicit configurable depth/iteration cap; unbounded/arbitrary
   recursion and unrestricted negation-as-failure remain out of scope. Update the
   Glossary, M3 stories (US-023, US-024), FR-23/FR-24/FR-25, and Non-Goals to be
   consistent.
4. **Provider readiness for V1 = mock + local must work; remote may be skeleton.**
   The deterministic mock provider and local inference (Ollama-native +
   OpenAI-compatible local HTTP) must be functionally working for V1 completion.
   Remote OpenAI/Anthropic adapters may ship as configured-but-untested adapter
   skeletons. Make this explicit in US-015, US-020, US-021, Success Metrics, and
   the Ralph DoD so the loop knows what "done" means.
5. **Browser verification is uncertain → make it graceful/optional.** The
   autonomous harness may or may not have an interactive browser ("dev-browser
   skill"). Rewrite all "browser verification using dev-browser skill" acceptance
   items so that: (a) Playwright e2e in CI is the authoritative UI back-pressure,
   and (b) interactive browser verification is a best-effort step that the loop
   performs *if the tool is available* and otherwise records as a deferred manual
   check in `fix_plan.md` — never a hard blocker that stalls the loop.

## Required additions (the Ralph-mechanics gaps to close)

Add or expand the following. Keep each addition tight and high-signal.

### 1. Repository operating files (new top-level section "Ralph Operating Model")

Define the three files the loop depends on and how they relate to this PRD:

- **`specs/` layout.** Specify that this PRD is decomposed into one-concern-per-file
  specs so the loop allocates only relevant specs per loop instead of the whole
  PRD. Provide the concrete file map, e.g.:
  - `specs/architecture.md` (stack, monorepo, source-of-truth, AGE projection seam)
  - `specs/data-model.md` (canonical tables, claims/arguments, outbox)
  - `specs/auth-security.md`
  - `specs/ai-privacy.md` (policy layering, mock rules, provider readiness)
  - `specs/reasoning.md` (restricted Datalog, bounded recursion, predicates)
  - `specs/modules/personal-relationship.md`, `specs/modules/reading-character.md`
  - `specs/import-export.md`, `specs/deployment.md`
  - `specs/glossary.md`
  State that specs are the single source of truth and the PRD's per-story
  acceptance criteria are mirrored into the relevant spec file.
- **`fix_plan.md`.** Define it as the prioritized, append/prune TODO list that is
  the loop's working stack. Specify: how it is bootstrapped from the US-stories +
  milestone matrix; that items are sorted by priority within the active milestone;
  that the loop updates it every turn (mark complete/incomplete, add discovered
  bugs and deferred manual checks); and that completed items are periodically
  pruned. Resolve the current contradiction: the loop **autonomously selects the
  most important not-yet-done item from `fix_plan.md` within the current
  milestone** — replace "do not implement until a story is selected" with this
  rule.
- **`AGENT.md`.** Define it as the operational source of truth for build/run/test
  commands, the verify tiers, and environment setup. Require the loop to update it
  (briefly, via subagent) whenever it learns a correct command, and forbid putting
  status reports into it.

### 2. Stub vs placeholder policy (new subsection under Cross-Cutting Constraints)

Add a crisp, testable distinction:

- **Sanctioned seam/stub (allowed):** declared in the story's "Allowed stubs",
  visible at runtime (logs/admin/UI label) or in docs, on a non-critical path, and
  recorded in `fix_plan.md`.
- **Forbidden placeholder:** fake/minimal logic on a promised/critical path,
  silent no-ops, hard-coded test-only returns in production code, or anything not
  declared as an allowed stub. State that the loop must not introduce forbidden
  placeholders and that discovering one converts it into a `fix_plan.md` item.

### 3. Back-pressure & verification tiers (expand Technology stack / Ralph DoD)

- Define a **fast inner loop** (`typecheck` + targeted unit tests, no containers)
  as the primary back-pressure run after every change — "the wheel that must turn
  fast." TypeScript typecheck + lint is the static-analyzer back-pressure.
- Define a **medium tier** (`verify:quick`) before marking a normal story item
  complete.
- Define a **full tier** (`verify`, includes `test:api` against a Postgres
  container with AGE+pgvector, and `test:e2e`) for milestone and V1 completion.
- State expectations for test determinism and DB lifecycle: deterministic mock
  AI/embedding providers, isolated/reset test database per run, and that slow
  container-backed suites are not on the fast inner loop.

### 4. Subagent & search policy (new subsection)

- Many subagents allowed for codebase search and file writes; **exactly one**
  subagent for build/test to avoid back-pressure overload.
- Mandatory "search before implement": before adding a table, repository, route,
  adapter, or component, search the codebase with subagents and do not assume a
  thing is unimplemented.

### 5. Loop cadence, commits, and tags (expand Ralph / Amp Definition of Done)

- Clarify loop-vs-story granularity: a story spans many loops; each loop does one
  thing, then updates `fix_plan.md` with learnings before ending the turn.
- Add commit/tag discipline: when the relevant tier is green, update `fix_plan.md`,
  `git add -A`, commit with a descriptive message; on a fully green build/test
  state create/increment a semver git tag (start `0.0.0`, bump patch).
- Add a rule to capture *why* a test/implementation matters in test docstrings and
  spec notes, since future loops won't have prior reasoning in context.
- Add a self-recovery note: a broken tree may be rescued with more prompts or, if
  cheaper, reset — and bugs found mid-task are documented in `fix_plan.md` and
  fixed via subagents even if unrelated.

### 6. Story dependency ordering

Add an explicit prerequisite list (a short DAG) per story or a dependency table so
the autonomous selector understands ordering within a milestone (e.g. US-005
canonical tables precede US-008/US-009 CRUD; US-006 outbox precedes US-026 AGE
projection; US-015 adapters precede US-017/US-020/US-021).

### 7. Centralize the early seams list

The Status section mentions "architecture seams/stubs required by later
milestones." Enumerate them in one place (AGE projector interface + outbox,
jobs/worker, provider adapter interfaces, schema-version references, rule-engine
interface) so M0 establishes every seam later milestones depend on.

## Consistency fixes to make while editing

- Make the 60-second capture/review Success Metric explicitly measurable against
  the deterministic mock provider.
- Ensure Glossary, Functional Requirements (FR-1..FR-30), Non-Goals, and the
  per-story text all agree after the recursion and provider-readiness edits.
- Keep UUIDv7, CORS defaults, and localhost-binding as-is (reasonable agent-level
  choices); do not over-specify them.
- Update the "Changelog for This PRD Revision" section with a new entry
  summarizing this revision's changes.

## Acceptance criteria for your revised PRD

- A `specs/` file map, `fix_plan.md`, and `AGENT.md` are defined and their
  relationship to the PRD and to each loop's context allocation is explicit.
- The selection mechanism is unambiguous (autonomous pick from `fix_plan.md`
  within the active milestone) with no remaining "do not implement until selected"
  contradiction.
- Stub-vs-placeholder is a testable distinction.
- Three verification tiers (fast inner loop / `verify:quick` / `verify`) and the
  one-subagent-for-build-test rule are stated.
- The five locked decisions are encoded consistently across glossary, stories,
  FRs, Non-Goals, and metrics.
- Browser verification never hard-blocks the loop; Playwright CI is authoritative.
- Canonical terminology and existing IDs are preserved.
- The document remains internally consistent end-to-end, with no orphaned
  references after edits.

## Style constraints

- Keep the document scannable: tables, short bullets, one concern per line.
- Prefer precise, testable language over prose.
- Do not add code. Do not invent new product scope beyond the locked decisions and
  the gaps listed above.
