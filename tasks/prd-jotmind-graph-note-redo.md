# PRD: JotMind Graph-Note Redo

## Introduction

JotMind is being rebuilt as a privacy-first self-hostable, graph-based personal knowledge app for fragmented information. The product should let users quickly capture notes, transform them into typed entities and provenance-aware claims, visualize relationships, search and edit through AI-assisted commands, and reason over the graph with Prolog-like/Datalog-style restricted rules.

The first polished version must demonstrate that the same graph-note foundation works across two first-class use cases:

- **Personal relationship management:** remembering people, interactions, places, events, and relationship context.
- **Reading/character maps:** tracking characters, events, attributes, plot participation, and logical relationships in books or manuscripts.

The app must prioritize privacy and user control: data lives in a user-controlled self-hosted backend/database, AI writes require explicit user confirmation, and remote AI provider use is opt-in only.

## Goals

- Create a privacy-first self-hostable knowledge graph that stores entities, notes, sources, and multi-argument claims.
- Support manual creation, editing, deletion, merging, and search for entities and claims.
- Provide fast natural-language capture that proposes structured entities/claims for user confirmation.
- Preserve provenance, citation/source, timestamp, and confidence for every AI-created claim.
- Provide a universal command/search interface where manual search works by default, local AI/RAG can be configured explicitly, and remote AI providers remain opt-in only.
- Support Prolog-like/Datalog-style restricted rules and queries as a core graph-reasoning capability.
- Let advanced users create lightweight custom schemas for entity types, claim predicates, properties, and validation rules.
- Provide usable network, timeline/card, table, detail, and source/note views.
- Ship polished built-in modules for personal relationship management and reading/character maps.

## User Stories

### US-001: Initialize a privacy-first self-hosted knowledge base
**Description:** As a privacy-conscious user, I want my JotMind data stored in a user-controlled backend/database so that I can use the app without mandatory vendor cloud storage.

**Acceptance Criteria:**
- [ ] On first launch, the app creates or opens a self-hosted/local-server knowledge base without requiring cloud account sign-in.
- [ ] The knowledge base can store entities, claims, notes, sources, schemas, and rule definitions.
- [ ] The app displays where the active knowledge base database is hosted or how it can be backed up/exported.
- [ ] Typecheck/lint passes.

### US-002: Store typed entities and claim-based relations
**Description:** As a user, I want information represented as typed entities and claims so that fragmented notes can become a queryable graph.

**Acceptance Criteria:**
- [ ] The system supports at least Person, Event, Concept, Place, Note, and Source entity types.
- [ ] Claims can connect one or more entities using typed roles, e.g. subject, object, participant, place, source, or context.
- [ ] Claims include predicate, description, created timestamp, optional valid time range, confidence, and provenance fields.
- [ ] Entity records support name, aliases, description, tags/groups, and custom properties.
- [ ] Typecheck/lint passes.

### US-003: Manually manage entities
**Description:** As a user, I want to create and edit entities directly so that I can maintain my graph without relying on AI.

**Acceptance Criteria:**
- [ ] Users can create entities of supported built-in types.
- [ ] Users can edit entity name, aliases, description, tags/groups, and custom properties.
- [ ] Users can delete an entity after a confirmation step that explains affected claims.
- [ ] Users can merge duplicate entities and preserve aliases, properties, notes, and related claims.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-004: Manually manage claims
**Description:** As a user, I want to create and edit claims directly so that I can precisely record relationships and observations.

**Acceptance Criteria:**
- [ ] Users can create a claim by selecting predicate, description, confidence, optional valid time range, and entity arguments.
- [ ] Users can edit claim metadata and argument roles after creation.
- [ ] Users can delete a claim without deleting connected entities.
- [ ] Claim forms validate required predicate and entity-argument fields before saving.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-005: Capture fragmented text into a review queue
**Description:** As a user, I want to quickly enter a paragraph or note so that JotMind can propose graph updates from fragmented information.

**Acceptance Criteria:**
- [ ] Users can enter freeform text into a quick-capture input.
- [ ] The system stores the original captured text as a Note or Source before extraction.
- [ ] When a real or mock AI provider is configured, the system proposes candidate entities and claims extracted from the text.
- [ ] When no AI provider is configured, the capture flow stores the note/source and shows an AI setup/unavailable state without blocking manual review or search.
- [ ] Proposed graph updates are shown in a review queue and are not written until confirmed.
- [ ] Rejected proposals remain linked to the source note as rejected or dismissed extraction candidates.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-006: Confirm AI-suggested graph edits
**Description:** As a user, I want to review AI-suggested edits before they change my knowledge base so that I remain in control of private information.

**Acceptance Criteria:**
- [ ] AI-generated create/update/delete proposals are displayed as structured, human-readable changes.
- [ ] Each proposal shows affected entities, claims, predicates, arguments, confidence, and source citation.
- [ ] Users can accept, reject, or edit each proposal before applying it.
- [ ] The system never applies AI-suggested writes without explicit confirmation.
- [ ] Accepted AI-created claims preserve provenance, citation/source, timestamp, and confidence.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-007: Search and command through a universal AI interface
**Description:** As a user, I want one command/search box for natural-language queries, filters, and edit requests so that I can access the graph quickly.

**Acceptance Criteria:**
- [ ] Users can submit natural-language queries such as “Who did I meet at ICRA?” or “Find characters related to X.”
- [ ] The system constrains AI outputs to strict command schemas before presenting results or proposals.
- [ ] Invalid schema outputs are discarded and do not execute.
- [ ] Low-confidence or invalid structured parsing falls back to full-text or vector search results.
- [ ] Structured interpretations and fallback results are shown separately so users can choose what to inspect or apply.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-008: Provide provenance-aware AI answers
**Description:** As a user, I want AI answers to cite graph claims and source notes so that I can verify why an answer was produced.

**Acceptance Criteria:**
- [ ] When a real or mock AI provider is configured, AI answers include citations to claims and/or source notes used as evidence.
- [ ] When no AI provider is configured, answer generation shows an AI setup/unavailable state and offers search results where applicable.
- [ ] Each cited claim displays predicate, connected entities, confidence, and provenance metadata.
- [ ] Users can click a citation to open the relevant claim or source note detail view.
- [ ] Answers distinguish known facts, inferred facts, uncertain claims, and missing information.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-009: Configure local and remote AI/RAG behavior
**Description:** As a privacy-conscious user, I want AI disabled until explicitly configured and remote providers only by opt-in so that private graph content is not sent externally without consent.

**Acceptance Criteria:**
- [ ] The default fresh-install AI mode is `No AI`: manual graph workflows and full-text/graph search work, while local and remote AI providers must be configured explicitly.
- [ ] The default AI/RAG mode does not send knowledge-base content to remote AI provider services.
- [ ] Users can explicitly enable remote AI provider processing in settings, with separate consent for remote embeddings where applicable.
- [ ] Remote opt-in settings explain what content may be sent externally.
- [ ] Users can disable remote AI provider processing again.
- [ ] Command execution and answer generation respect the selected AI privacy mode.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-010: Build network, timeline/card, table, detail, and source views
**Description:** As a user, I want multiple views over the same graph so that I can explore relationships, chronology, structured data, and original sources.

**Acceptance Criteria:**
- [ ] Network view displays entities and claim-derived relationships for a selected module or filtered scope.
- [ ] Timeline/card view displays time-related notes, claims, and events in chronological order when dates exist.
- [ ] Table view displays entities or claims with sortable/filterable columns.
- [ ] Detail view displays a selected entity or claim with related claims, sources, and editable metadata.
- [ ] Source/note view displays original captured content and linked extracted claims.
- [ ] Clicking entities, claims, tags, or citations navigates to relevant detail or source context.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-011: Support personal relationship management module
**Description:** As a user managing relationships, I want a built-in module for people, interactions, events, and places so that I can remember social context over time.

**Acceptance Criteria:**
- [ ] The module includes default schemas for Person, Event, Place, Note, and relationship claims.
- [ ] Person profiles support names, aliases, birthday uncertainty, contact/social fields, notes, tags/groups, and relationship strength.
- [ ] Users can record events where people were met, introduced, interacted, or mentioned.
- [ ] Users can query location-aware recall, e.g. “Who do I know in Shanghai?”
- [ ] The module includes at least one rule pack for social-group or event-participation inference.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-012: Support reading and character-map module
**Description:** As a reader or writer, I want a built-in module for character maps so that I can track characters, plot events, and logical relationships in a book or manuscript.

**Acceptance Criteria:**
- [ ] The module includes default schemas for Character/Person, Event, Place, Concept, Source, and plot/relationship claims.
- [ ] Users can record first appearance, attributes, event participation, and character relationships.
- [ ] Network view can display a character relationship graph for a selected work or tag/filter.
- [ ] Timeline/card view can display plot events in chronological order when dates or sequence numbers exist.
- [ ] The module includes at least one rule pack for family/relationship inference or timeline consistency checks.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-013: Create lightweight custom schemas in-app
**Description:** As an advanced user, I want to define custom entity and claim schemas so that JotMind can adapt to new domains beyond the built-in modules.

**Acceptance Criteria:**
- [ ] Users can create a custom entity type with display name, description, default properties, and validation rules.
- [ ] Users can create a custom claim predicate with allowed argument roles and compatible entity types.
- [ ] Users can attach default views, filters, and extraction schema hints to a custom schema.
- [ ] The system validates new entities and claims against their custom schema before saving.
- [ ] Custom schema definitions are stored in the active knowledge base and can be exported.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-014: Author and run Prolog-like/Datalog-style restricted reasoning rules
**Description:** As an advanced user, I want to define restricted Datalog/Horn-clause rules over graph claims using a Prolog-like UI syntax so that I can infer relationships and query complex paths.

**Acceptance Criteria:**
- [ ] Users can view built-in rule packs attached to the personal relationship and reading modules.
- [ ] Users can create or edit lightweight custom rules associated with a schema or module.
- [ ] The system can run rules to produce inferred query results without overwriting source claims.
- [ ] Inferred results are labeled as inferred and show which rules/source claims produced them.
- [ ] Rule errors are displayed without corrupting stored claims or schemas.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-015: Import and export portable text/structured data
**Description:** As a user, I want to import and export portable graph data so that I can avoid lock-in and seed the app from existing notes.

**Acceptance Criteria:**
- [ ] Users can import plain text or Markdown as source notes.
- [ ] Users can import structured table data and map columns to entity fields or claim fields.
- [ ] Users can export graph data to JSON and Markdown.
- [ ] Exported data includes entities, claims, schemas, sources, provenance, and rule definitions.
- [ ] Imports generate reviewable changes before modifying the graph.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

## Functional Requirements

- FR-1: The system must create or open a privacy-first self-hosted knowledge base without requiring cloud sign-in.
- FR-2: The system must store entities, claims, notes, sources, schemas, and rules in the active knowledge base.
- FR-3: The system must support built-in entity types Person, Event, Concept, Place, Note, and Source.
- FR-4: The system must represent relationships and facts as claims with predicate, argument roles, metadata, confidence, and provenance.
- FR-5: The system must allow users to create, edit, delete, and merge entities.
- FR-6: The system must allow users to create, edit, and delete claims independently of connected entities.
- FR-7: The system must store original captured text before AI extraction occurs.
- FR-8: When a real or mock AI provider is configured, the system must extract candidate entities and claims from text/manual/Markdown/table input. Without an AI provider, the system must store inputs and expose manual review/search/setup states without fabricating AI output.
- FR-9: The system must present AI-generated graph updates for confirmation before applying them.
- FR-10: The system must preserve source/provenance/citation/confidence metadata on every AI-created claim.
- FR-11: The system must provide a universal command interface for search, filtering, question answering, and edit proposals.
- FR-12: The system must constrain AI command outputs to strict schemas and reject invalid outputs.
- FR-13: The system must provide fallback full-text or vector search when structured command parsing fails or has low confidence.
- FR-14: When a real or mock AI provider is configured, the system must provide provenance-aware AI answers with clickable citations to claims and source notes. Without an AI provider, the system must show an unavailable/setup state and fallback search where applicable.
- FR-15: The system must default to `No AI` on fresh installs, allow explicit local AI/RAG configuration, and require explicit opt-in before sending content to remote AI providers.
- FR-16: The system must provide network, timeline/card, table, detail, and source/note views over graph data.
- FR-17: The system must support filters by entity type, claim predicate, date range, place, person, tag, confidence, and provenance where data is available.
- FR-18: The system must include a personal relationship management module with default schemas, views, extraction hints, and social/event reasoning rules.
- FR-19: The system must include a reading/character-map module with default schemas, views, extraction hints, and relationship/timeline reasoning rules.
- FR-20: The system must allow advanced users to create lightweight custom entity types, claim predicates, properties, validation rules, view defaults, and extraction hints.
- FR-21: The system must support Prolog-like/Datalog-style restricted rule authoring/querying and label inferred results separately from stored claims.
- FR-22: The system must display contradictions or uncertainty when claims disagree or have low confidence.
- FR-23: The system must support import from plain text, Markdown, and structured tables.
- FR-24: The system must support owner/admin export of knowledge-base-scoped portable JSON and Markdown including graph data, schemas, rules, sources, and provenance.
- FR-25: The system must maintain an audit trail for AI proposals, accepted AI writes, rejected AI proposals, user edits, imports, and deletes.

## Non-Goals

- No public module marketplace in the first version.
- No real-time collaboration, public sharing platform, comments, presence, or fine-grained per-entity/claim permissions in the first version. V1 includes only coarse knowledge-base-level roles: owner, admin, editor, and viewer.
- No mandatory cloud account, mandatory third-party cloud storage, or cloud-first sync. Local/server user accounts may exist for access control and multi-user boundaries. Optional self-hosted or user-managed cloud/server deployment is allowed.
- No mobile-native offline sync implementation in the first version.
- No calendar, GPS, social-contact, or external contact integrations in the first version.
- No first-class cross-media ingestion for images, PDFs, web pages, calendar/GPS logs, or chat exports.
- No AI-generated writes that bypass user confirmation.
- No remote AI provider processing without explicit user opt-in.
- No fully unrestricted plugin system that can read or mutate user data without permission controls.

## Design Considerations

- The app should make graph structure visible without forcing users to think in database terms.
- AI proposals should be shown as clear diffs, e.g. “Create Person: Simon,” “Add Claim: Simon attended ICRA 2025,” or “Set Person.school = Tsinghua University.”
- Provenance should be visible wherever claims are displayed, but compact enough not to overwhelm normal browsing.
- Network view should support selecting nodes/edges and opening detail drawers without losing graph context.
- Timeline/card view should work for both life events and plot events.
- Table view should support bulk inspection and filtering for users who prefer structured editing.
- Custom schema creation should be lightweight and guided; it should not require plugin development.
- Reasoning output should distinguish stored claims from inferred results using labels or badges.

## Technical Considerations

- The first implementation must use a relational-graph hybrid data model backed by PostgreSQL plus Apache AGE as the source of truth for knowledge-base data.
- The app may use Dexie.js/IndexedDB only for non-canonical browser-local data such as UI preferences, temporary client cache, draft state, or offline-tolerant read caches. Dexie/IndexedDB must not be treated as the canonical v1 knowledge-base store.
- The data access layer must be isolated behind repository/service abstractions so graph storage, full-text/vector indexing, backup/restore, and future storage changes do not leak into UI components.
- Claims should be modeled as first-class records rather than only direct edges so they can carry confidence, time range, provenance, source citations, and multiple arguments.
- AI command parsing must use strict schemas and validation before proposals are displayed or executed.
- Local RAG should index entities, claims, notes, sources, aliases, tags, and recent activity.
- Remote LLM integration must be isolated behind explicit user settings and must expose clear consent copy.
- Prolog-like/Datalog-style restricted reasoning should be implemented in a way that can reference stored claims and return inferred results with traceability.
- Custom schemas should be versioned or otherwise migration-aware so future schema edits do not silently corrupt existing graph data.
- Import flows should generate reviewable proposed changes rather than directly mutating graph data.
- Export should be complete enough to reconstruct the knowledge base, including schemas and provenance. V1 must support portable JSON import/export, Markdown export, CSV/table import/export, and full database backup/restore where available through PostgreSQL-compatible dump/restore tooling.

### Resolved Platform and Runtime Decisions

- The first implementation must be a platform-agnostic webapp, not a desktop-only application.
- The v1 runtime requires a self-hostable web backend for serving the app, coordinating local or remote AI endpoints, exposing platform-neutral service APIs, and accessing the PostgreSQL plus Apache AGE database. The backend must be able to run on a user's local machine/LAN and should also be deployable to a user-managed cloud server or VPS.
- The v1 knowledge base source of truth must live in PostgreSQL plus Apache AGE, not in browser-managed storage. Browser storage may be used only for non-canonical UI preferences, drafts, or caches.
- Core manual graph workflows must work without third-party internet services when the web backend and database are running and reachable. V1 does not require fully disconnected browser-only operation when the backend/database are unavailable.
- The target browser scope is desktop and mobile browsers. Mobile browsers may use the web UI when connected to the local/server/cloud backend; full mobile-browser-local graph database operation is not required in v1. Implementation should avoid APIs that make the UI Chromium-desktop-only unless a standards-based fallback is provided.
- Local AI generation must not require bundled local model weights in v1. The app may support an optional user-installed local HTTP inference endpoint, such as an Ollama-compatible or OpenAI-compatible local server, while still functioning without it.
- The v1 architecture should not assume Electron, Tauri, native sidecars, or desktop-only packaging. Code may leave room for future desktop wrappers, but v1 acceptance criteria must be satisfiable as a webapp.

### Resolved Storage, Search, and Backup Decisions

- PostgreSQL plus Apache AGE is the v1 canonical storage engine and graph-query substrate.
- The repository/service layer must model the graph as a relational-graph hybrid: relational tables store canonical entity, claim, note, source, schema, rule, provenance, and audit metadata; Apache AGE stores or derives graph structures needed for graph traversal/querying.
- The app must provide Docker Compose or equivalent developer/user setup automation for PostgreSQL plus Apache AGE.
- V1 search without AI configured must support full-text token search, graph filters, and vector search when embeddings are available.
- Portable backup/export must include JSON import/export, Markdown export, and CSV/table import/export. Full database backup/restore must also be supported where available through PostgreSQL-compatible dump/restore tooling.
- Portable imports/exports are scoped to a knowledge base and available to knowledge-base owners/admins. Full database backup/restore is a server-operator/admin maintenance function, not a normal per-user action.
- The app should warn users that local/server database persistence depends on the configured database volume/backups and that browser site data or server volumes may be deleted outside the app.

### Resolved AI Provider, Embedding, and Test Decisions

- All LLM and embedding integrations must go through provider adapter interfaces. UI components and graph repositories must not call vendor SDKs or provider HTTP APIs directly.
- V1 local inference must support both Ollama-native HTTP APIs and OpenAI-compatible local HTTP endpoints behind one adapter layer.
- V1 remote LLM support must include OpenAI and Anthropic behind one adapter layer. Remote providers remain disabled until explicitly configured and allowed by the selected privacy mode.
- Provider settings may be configured through both environment variables and in-app settings. Environment variables override in-app settings when both are present.
- Secrets such as API keys must not be included in portable graph exports. If stored through in-app settings, they must be separated from exported knowledge-base data.
- When no local or remote LLM is configured, manual graph workflows, full-text search, graph-filter search, and vector search with existing embeddings must continue to work. Generated answers, LLM extraction proposals, and LLM command parsing must be disabled or shown as unavailable; the system must not fabricate AI output with hidden remote calls.
- Embeddings must be supported through both local and remote embedding providers behind one adapter. Remote embeddings require explicit opt-in and privacy handling as remote AI provider processing, with separate consent from remote LLM calls where configured.
- Vector embeddings must be stored in PostgreSQL using `pgvector`.
- Normal automated tests and CI must use deterministic mock LLM and embedding providers. Optional integration tests may call real local or remote providers only when the required endpoint configuration or API keys are explicitly present.

### Resolved AI Privacy and Consent Decisions

- V1 must expose four AI privacy modes: `No AI`, `Local AI`, `Remote per request`, and `Remote always allowed`.
- Fresh installs must default to `No AI`. Manual graph workflows and full-text/graph search must work in this mode; local and remote AI providers must be configured explicitly.
- Remote LLM processing requires both a global remote-enable setting and either per-request user confirmation (`Remote per request`) or an explicit always-allowed mode (`Remote always allowed`).
- Remote embeddings require separate consent from remote LLM calls because embedding jobs may batch-index larger portions of the knowledge base.
- Remote data sharing scope must be configurable between at least two options: minimal scope, which sends only the current user input and explicitly selected citations/context; and RAG context scope, which may send retrieved relevant notes, claims, entities, and source excerpts needed for the current task.
- The app must show visible badges or labels when an AI feature will use a remote provider.
- In `Remote per request` mode, confirmation dialogs must show the provider, model, feature being used, and categories of content that will be sent before the remote call is made.
- The audit trail must record remote AI call metadata including timestamp, provider, model, feature, selected privacy mode, and categories of content sent. The audit trail must not store full prompts, full note content, API keys, or full model responses by default.
- Accepted AI writes remain separately audited with proposal, provenance, citation, confidence, and user-confirmation metadata.

### Resolved Structured AI Output and Proposal Decisions

- Structured LLM outputs must be defined with Zod schemas in code. Schemas should be exported to JSON Schema where provider APIs, documentation, or validation tooling need JSON Schema.
- The shared schema layer must cover at minimum extraction candidates, graph edit proposals, command interpretations, answer-with-citations payloads, provider configuration, and audit metadata.
- When an LLM returns invalid or partially valid structured output, the system should retry once with a repair prompt. After the retry, valid items may be kept and invalid items must be discarded from executable proposals.
- Invalid or discarded structured-output items may be retained in debugging logs when the user or developer has enabled raw AI debug retention. They must not be executable and must not appear as normal pending graph proposals.
- LLM-generated graph edit proposals may include create, update, delete, and merge operations, but none may be applied without explicit user confirmation.
- The review UI must support both batch-level actions and item-level accept, reject, and edit actions.
- Confidence must store both model-provided confidence and system validation confidence when available. UI may display a derived low/medium/high label, but the underlying numeric scores should be retained.
- Accepted AI-created or AI-modified claims are stored as normal graph claims, while provenance must continue to show AI origin, source/citation, provider/model where available, timestamp, confidence, and user-confirmation metadata.
- Raw LLM prompt/response retention must be user-configurable. It must be disabled by default for privacy, may be enabled for debugging/reproducibility, and must never include API keys.

### Resolved Implementation Stack and Repository Decisions

- V1 must use TypeScript across the frontend, backend, and shared packages, running on Node.js for backend/server tooling.
- The frontend must use React plus Vite.
- The backend must use Express with a strict TypeScript/Zod project template. Agents must not implement free-form untyped Express routes; request bodies, query parameters, route params, and responses should be validated or typed through shared Zod schemas where practical.
- The repository should be organized as a monorepo with `apps/web`, `apps/api`, and `packages/shared` or equivalent package boundaries for shared schemas/types/utilities.
- The web UI must communicate with the backend through REST JSON APIs with Zod validation at API boundaries.
- PostgreSQL schema management must use Drizzle ORM and Drizzle migrations.
- Docker Compose must be provided for PostgreSQL plus Apache AGE, `pgvector`, and optional local inference services where practical. Manual installation/setup documentation must also be provided for users or developers who do not use Docker Compose.

### Resolved Access Control, Networking, and Knowledge-Base Scope Decisions

- V1 must support multi-user accounts on the local/server backend. These are local/server product accounts, not mandatory cloud accounts.
- The backend must bind to `localhost` by default. Users or administrators may explicitly opt into LAN-accessible binding for mobile or other-device browser access.
- LAN/mobile browser access requires full username/password account authentication. Trusted-LAN unauthenticated access is not acceptable in v1.
- HTTPS is not mandatory for localhost development/use. The backend should support HTTPS when the user or administrator provides certificates, and documentation should warn users about HTTP risks when enabling LAN access.
- V1 must support multiple knowledge bases selectable in the UI.
- The data model must include stable identifiers, ownership/scope fields where appropriate, timestamps, and audit metadata sufficient to support future cloud sync/account features, but v1 must not implement cloud sync UI or cloud sync APIs.

### Resolved Multi-User Permission and Account Decisions

- V1 must support role-based access per knowledge base.
- V1 roles must include owner, admin, editor, and viewer.
- Owners can manage the knowledge base, delete/archive it, assign roles, manage knowledge-base settings, and perform owner/admin exports.
- Admins can manage users/roles within the knowledge base, manage knowledge-base settings, inspect audit/job status, and perform admin exports, but cannot supersede the owner for destructive owner-only actions unless explicitly granted by the owner or server operator.
- Editors can create, edit, merge, and soft-delete graph content, run imports that generate reviewable changes, run AI-assisted proposal flows allowed by the knowledge-base/provider settings, and accept/reject proposals within their edit scope.
- Viewers can read/browse/search the knowledge base and view permitted provenance/audit-derived metadata, but cannot mutate graph content, accept proposals, manage users, change provider settings, or run imports. Viewer access to AI answer generation may be allowed only if it does not create graph writes and complies with privacy/provider settings.
- Full database backup/restore and server-global configuration remain server-operator/admin maintenance responsibilities outside normal knowledge-base role actions.
- AI provider settings and API keys must support server-global defaults plus per-user overrides. Environment-variable provider settings remain server-global overrides where configured.
- Audit logs must record which authenticated local/server user performed each auditable action.
- Raw AI debug logs, prompts, and responses are visible only to the user who generated them, unless a later explicit permission model changes this.
- First-run setup must create the initial admin user, and a settings UI must support basic user management and role assignment after setup.

### Resolved Self-Hosted and Cloud-Deployable Backend Direction

- The backend must be designed as a self-hostable service that can run locally, on a LAN server, or on a user-managed cloud server/VPS.
- The web client must be able to connect to a remotely hosted backend over HTTP(S), subject to authentication and deployment configuration.
- Optional cloud/server deployment must not change the privacy baseline: there is still no mandatory vendor-hosted account, no mandatory third-party storage, and no remote AI provider processing without the configured consent flow.
- Deployment documentation should distinguish local development, local/LAN production-style use, and user-managed cloud/VPS deployment.

### Resolved Deployment, Origin, and Operations Decisions

- V1 must provide a Docker Compose reference deployment for local, LAN, VPS, and self-hosted use. The reference deployment should include a single stateless Node API container and a PostgreSQL container with Apache AGE and `pgvector` enabled.
- The Node API container must be stateless and configurable through environment variables so future Kubernetes or platform-as-a-service deployments remain possible. V1 must not include Kubernetes manifests or provider-specific cloud integrations.
- The API must be able to serve the built frontend assets for simple single-origin deployments. The frontend must also be deployable separately as static assets configured with an API base URL.
- CORS must use configurable allowed origins with localhost-oriented defaults for development. V1 must not allow all origins by default.
- Server-global secrets and deployment configuration must be provided through environment variables. In-app settings may provide user-level provider overrides where allowed by the permissions model.
- V1 account recovery must not depend on email. Password/admin recovery should be handled through CLI, environment-seeded reset, or documented manual database procedure.
- Database migrations may run on startup only when explicitly enabled by configuration. Otherwise, deployments should use documented migration commands and fail safely when the schema is incompatible.
- Public internet exposure is supported only when the operator configures HTTPS or a trusted TLS-terminating reverse proxy, allowed origins, strong authentication, and deployment hardening. Documentation must warn against exposing an unsecured HTTP deployment publicly.

### Resolved Authentication, Session, and API Security Decisions

- Browser authentication must use server-side sessions with secure HTTP-only cookies. Cookie security settings must be configurable for localhost development versus HTTPS deployments.
- Server-side session state must be stored in a PostgreSQL session table. Production/reference deployments must not rely on in-memory session state, so the Node API container remains stateless.
- V1 must support personal access tokens per user for non-browser clients, import/export automation, or scripts. Token creation and revocation must be auditable.
- Passwords must be hashed with Argon2id.
- Cookie-authenticated mutation requests must include CSRF protection.
- The backend must implement general per-user and/or per-IP rate limiting for authentication routes and expensive endpoints, including AI, import/export, search, and backup/restore operations where appropriate.
- Account creation must be admin-controlled after first-run setup creates the initial admin. Public self-registration must not be enabled by default.
- Every knowledge-base API route must enforce role/permission checks on the backend. UI-only hiding of unauthorized actions is insufficient.

### Resolved Graph Persistence and Schema Representation Decisions

- Canonical knowledge-base data must live in relational PostgreSQL tables. Apache AGE is a projected graph query/index layer, not the canonical source of truth.
- Relational writes and `graph_outbox` events must be recorded in the same database transaction. A background projector must consume the outbox and update the AGE graph projection. The system must also support full graph projection rebuilds or on-demand repair from canonical relational tables.
- Multi-argument claims must be represented in the graph projection as claim nodes connected to entity nodes by role-labeled edges. Agents must not reduce canonical claims to direct binary entity-to-entity edges only.
- Custom entity and claim properties must be stored in JSONB columns with schema validation.
- Stable IDs must use UUIDv7.
- User and AI delete actions should soft-delete entities, claims, notes, sources, schemas, and rules by default while preserving auditability. Hard-delete should be reserved for explicit admin purge/maintenance flows.
- Schema definitions must be versioned, and stored data points must reference the schema version used for validation at creation/update time.

### Resolved Background Job and Worker Decisions

- V1 background work must use PostgreSQL-backed job and outbox tables. Agents must not introduce Redis or another required external queue service for v1.
- Workers must support both simple in-process execution inside the API process and a separate worker process mode for scaling or production-style deployments.
- Durable job state, queue state, retry state, and projection state must live in PostgreSQL. The API and worker containers must not depend on local disk state for correctness.
- V1 background jobs include at minimum Apache AGE graph projection, embedding indexing, AI extraction/answer jobs where asynchronous execution is useful, import/export jobs, and backup/restore jobs.
- Failed jobs must retry with capped exponential backoff and move to a dead-letter/failed state after a configured maximum number of attempts.
- The UI must show user-visible status for that user's imports, AI jobs, indexing tasks, and backup/export operations. Admins must be able to inspect global job status and failed/dead-letter jobs.

### Resolved Prolog-Style Reasoning Direction

- V1 reasoning must use a restricted Datalog/Horn-clause rule layer implemented in TypeScript, exposed through a Prolog-like syntax in the UI.
- The rule engine should compile rules to SQL and/or Apache AGE queries where practical. Agents must not introduce an unrestricted external Prolog runtime as a required v1 dependency.
- Rule execution should run on the backend for stored graph data. Browser-side execution may be used for editing previews, validation, or examples, but persisted graph reasoning must be backend-authoritative.
- User-authored rules must be sandboxed as pure declarative rules with no filesystem, network, process, arbitrary JavaScript, or provider API access.
- V1 rules should support Horn clauses over entities/claims plus comparison predicates for dates and numbers. More advanced Prolog features may be deferred.
- Normal inferred results may be cached as derived results with invalidation. When a user accepts an inferred result as a graph update, it must be materialized as a separate inferred/accepted claim distinct from original user-entered or AI-extracted claims.
- Rules may create reviewable graph edit proposals, but rules must not auto-write claims without user confirmation.
- Rule authoring must provide inline validation before save and a runtime error panel for execution failures.

### Resolved Rule Language Syntax and Compiler Decisions

- V1 must support both a text rule syntax and a guided builder UI. The canonical text syntax is Datalog-like with explicit variables, for example: `knows(?a, ?b) <- claim(?c, "knows"), arg(?c, "subject", ?a), arg(?c, "object", ?b).`
- Low-level graph predicates are canonical. At minimum, rules should be able to reference predicates equivalent to `entity(id, type, name)`, `claim(id, predicate)`, and `arg(claimId, role, entityId)`.
- The system may generate higher-level schema predicates, such as `met(?personA, ?personB, ?event)`, but generated predicates must compile down to canonical low-level facts.
- Arbitrary user recursion is out of scope for v1. V1 may provide built-in recursive templates such as path within a maximum depth, transitive closure, and related-within-N-hops.
- Built-in filters must include equality, date comparisons, number comparisons, string contains/prefix matching, and tag membership. Geospatial helper predicates may be deferred unless required by a core v1 scenario.
- Stratified negation with safety checks is the target negation model. If implementation risk is high, agents may initially ship no negation and add stratified negation after the compiler is stable, but they must not implement unrestricted Prolog negation-as-failure in v1.
- Invalid rules may be saved as drafts, but invalid rules cannot be enabled or executed against the knowledge base.
- Built-in rule packs must cover both personal relationship management and reading/character-map modules.

### Resolved Custom Schema Evolution and Migration Decisions

- When a custom schema changes, the user must be able to choose whether existing data keeps its old schema version, is migrated through a reviewable migration flow, or is left under the old schema while a new schema/version is used going forward.
- Compatible schema changes that may be applied without migrating existing data include adding optional fields, changing display labels/descriptions/view metadata, and loosening validation rules.
- Breaking schema changes should create or activate a new schema version. Existing data may remain on the old referenced schema version and should not be silently invalidated or rewritten.
- AI extraction must use the latest active schema version by default.
- Validation warnings for old or mismatched data should be visible in schema/admin views and on affected entity/claim detail pages, while preserving the fact that the data may still be valid under its referenced old schema version.
- AI may assist schema migrations by proposing reviewable migration plans or graph edit proposals, but AI-assisted migrations must never auto-apply without user confirmation.

### Resolved Implementation Staging and Autonomous Workflow Decisions

- V1 implementation should be staged through vertical, demoable milestones rather than purely backend-only or frontend-only phases: foundation, manual graph, AI/RAG, reasoning, and polish.
- The minimum first milestone is a bootable app with authentication, database connectivity, knowledge-base selection, and basic entity/claim CRUD.
- The first user-facing graph demo milestone is manual graph CRUD plus search and basic views.
- The first autonomous implementation wave may defer advanced implementations, but not their architecture. Full custom schema/rule UI, real remote/local AI providers, import/export/backup, and advanced multi-user UX may be deferred, while interfaces, tables, stubs, permission middleware, audit model, and outbox/job foundations must exist from the start where they affect later compatibility.
- Every implementation story must include API tests where applicable, UI browser verification where applicable, and typecheck/lint. Agents must update relevant tests and pass the standard verification commands before considering a story complete.
- Mock AI providers are allowed before real provider adapters are implemented, but only behind the final adapter interfaces and clearly marked as mock in the UI/configuration where exposed at runtime.
- The relational canonical model should be implemented first. Foundation and manual graph milestones may initially stub Apache AGE projection, but the projection interfaces, `graph_outbox`, and repair/rebuild boundaries must exist so later AGE implementation does not require changing canonical write paths. Before v1 completion, real AGE projection/querying must support graph traversal features that depend on it.

### Resolved Verification, Tooling, and Definition-of-Done Decisions

- The monorepo must use `pnpm` as the package manager.
- Standard package scripts must include `format`, `format:check`, `typecheck`, `lint`, `test`, `test:api`, `test:e2e`, `verify:quick`, and `verify`.
- `pnpm verify:quick` should run the fast checks suitable for most iteration, at minimum formatting check, typecheck, lint, and non-e2e tests.
- `pnpm verify` should run the full standard verification suite, including `format:check`, `typecheck`, `lint`, `test`, `test:api`, and `test:e2e`.
- Agents should auto-format changed code with the standard formatter before final verification.
- Critical UI flows must have Playwright e2e coverage. Stories with UI acceptance criteria must also be verified in a browser using the appropriate browser/dev-browser workflow.
- API tests must run against a test PostgreSQL container with migrations applied. Tests must not depend on a developer's manually populated local database.
- A story may be considered complete with AGE, AI, import/export, or backup subsystems stubbed only when the story is not specifically about that subsystem and the final interfaces/stubs are documented and tested.

## Success Metrics

- A new user can create or access a self-hosted/local-server knowledge base and add their first entity/claim without signing into a cloud service.
- With a real or mock AI provider configured, a user can capture a paragraph and review AI-proposed graph updates in under 60 seconds.
- 100% of AI-created claims include provenance/source, confidence, and creation metadata.
- 0 AI-generated writes occur without explicit user confirmation in default mode.
- Users can answer at least five representative questions across the two showcase domains using search/command/RAG:
  - “Who did I meet at this event?”
  - “Who do I know in this city?”
  - “What events involve this person?”
  - “How are these two characters connected?”
  - “Which claims support this answer?”
- Built-in Prolog-like/Datalog-style restricted rules can produce traceable inferred results for both relationship management and reading/character-map data.
- Users can create one custom entity type and one custom claim predicate in-app without editing code.
- Users can export their graph data and re-import it without losing entities, claims, sources, schemas, or provenance.

## Open Questions

- None currently. Reopen this section when new product or architecture decisions become ambiguous.
