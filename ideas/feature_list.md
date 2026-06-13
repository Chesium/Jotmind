# JotMind Feature List Draft

This is a concise feature inventory for a later PRD/agent pass. It intentionally avoids implementation-level requirements, detailed acceptance criteria, and timeline planning.

## Product Direction

JotMind is a local-first, graph-based personal knowledge app for quickly capturing fragmented information, connecting it into typed entities/claims, visualizing relationships, and retrieving or editing knowledge through AI-assisted natural language commands. The first polished product should demonstrate the generalizability of the graph-note model across both **personal relationship management** and **reading/character maps**.

## Settled Design Choices

- **Initial showcase domains:** support personal relationship management and reading/character maps as parallel first-class use cases.
- **AI write safety:** AI proposes structured edits; users review and confirm before writes are applied.
- **Provenance:** every AI-created claim preserves source/provenance/citation/confidence metadata.
- **Reasoning:** Prolog-style/custom rule reasoning remains central, not a deferred extra.
- **Schema flexibility:** advanced users can create lightweight custom entity/claim schemas in-app.
- **Storage/privacy posture:** local-first knowledge base.
- **AI/RAG privacy model:** hybrid approach — local AI by default, remote LLMs only by explicit opt-in.
- **Cross-media ingestion:** defer images, PDFs, web pages, calendar/GPS logs, and chat exports beyond the first text/manual ingestion scope.

## Core Feature Areas

### 1. Knowledge Graph Foundation

- One private knowledge base per user.
- Typed entities such as Person, Event, Concept, Place, Task, Source, and Note.
- Claim-based relationship model for facts, observations, and uncertain information.
- Claims can connect multiple entities with typed roles, timestamps, confidence, and provenance.
- Entity aliases, tags/groups, custom properties, descriptions, and rich notes.
- Deletion, merge, deduplication, and edit history for entities and claims.

### 2. Fast Capture and Ingestion

- Quick-add text box for fragmented notes, people, events, tasks, ideas, and observations.
- Natural-language ingestion that extracts candidate entities and claims.
- Batch import from plain text/Markdown and structured tables.
- Capture provenance automatically so extracted knowledge links back to the original note/source.
- Inbox/review queue for ambiguous AI parses, unresolved entities, and duplicate candidates.
- Cross-media ingestion is deferred beyond the first serious version.

### 3. AI Command and RAG Layer

- Universal command interface for search, filtering, editing, and creation.
- LLM output constrained to strict JSON command schemas.
- Retrieval-augmented context from existing entities, claims, source notes, and recent activity.
- Multiple candidate interpretations shown to the user before execution.
- User confirmation required before applying AI-suggested writes.
- Fallback full-text/vector search when structured parsing is low-confidence or invalid.
- Entity resolution, alias matching, fuzzy matching, and duplicate detection.
- AI explanations that cite the claims/sources used to answer a question.
- Local AI/RAG by default, with remote LLM calls available only as explicit opt-in.

### 4. Search, Query, and Reasoning

- Global search across entities, claims, notes, properties, tags, and sources.
- Cluster/view-scoped search with filters for type, relation, date range, place, person, tag, confidence, and provenance.
- Natural-language questions over the knowledge graph, e.g. “Who did I meet at ICRA?” or “Who can I visit in Shanghai?”
- Structured graph queries for direct relationships and multi-hop paths.
- Rule-derived relationships such as group membership, event participation, kinship, dependency, or chronology.
- Prolog-style rule authoring/querying for advanced graph reasoning.
- Rule packs attached to schemas/modules, e.g. family relations for character maps or social-group inference for relationship management.
- Contradiction/uncertainty surfacing when claims disagree or have low confidence.

### 5. Views and Interaction

- Network view for relationship-centric exploration and editing.
- Timeline/card view for events, diary-like capture, and chronological browsing.
- Table view for bulk inspection, sorting, filtering, and editing.
- Detail drawer/profile page for every entity and claim.
- Source/note view showing original captured content and linked extracted claims.
- Optional statistics/dashboard view for summaries and activity insights.
- Cross-view navigation where clicking an entity, claim, tag, or source jumps to relevant context.

### 6. Templates, Modules, and Extensibility

- Built-in modules for personal relationships, events/life log, concepts/tools, reading/character maps, and tasks.
- Each module bundles entity types, claim predicates, default views, filters, and AI extraction schemas.
- Advanced users can create lightweight custom entity types, claim predicates, properties, and schema-level validation rules in-app.
- Custom schemas can define default views, extraction prompts/schemas, and optional reasoning rules.
- Singleton core clusters by default, with tags/filters used for subdomains where appropriate.
- Static/read-only nodes for predefined reference data where useful.
- Later developer-facing plugin/module API for custom views, schemas, importers, exporters, and rule packs.

### 7. Personal Relationship Management

- Person profiles with names, aliases, contact/social info, birthday uncertainty, notes, tags, and relationship strength.
- Events where people were met, interacted, introduced, or mentioned.
- Relationship claims between people with provenance and confidence.
- Location-aware recall such as “people I know in this city.”
- Reminder/reconnect suggestions, anniversaries, and follow-up notes as later-stage features.

### 8. Reading and Knowledge-Work Use Cases

- Character/entity maps for books, histories, manuscripts, and research domains.
- Record first appearance, plot/event participation, attributes, and character relationships.
- Track concepts, tools, papers, links, and learning notes with relationships.
- Consistency checking for stories/manuscripts via graph contradictions, Prolog-style relationship rules, and timeline conflicts.

### 9. Tasks, Events, and Life Log

- Task nodes with status, priority, due dates, dependencies, owners, and related people/events.
- Event nodes with participants, place, time range/uncertainty, sub-events, notes, and sources.
- Calendar/timeline planning and drag-to-schedule as a later-stage view.
- Daily/recent activity feed showing captured notes, created claims, and accessed entities.

### 10. Export, Sharing, and Interoperability

- Export views as image/PDF for sharing and presentation.
- Export/import graph data in portable formats such as Markdown, JSON, CSV, and possibly Cypher.
- Share read-only or restricted views later, with explicit privacy controls.
- Bidirectional references to external files, documents, images, videos, and web links.

### 11. Privacy, Accounts, and Safety

- Local-first private workspace.
- Optional account/sync layer later, without making cloud storage mandatory.
- Explicit confirmation for AI-generated writes unless a future trusted mode is chosen.
- Provenance, citation, and confidence metadata attached to AI-created claims.
- Local AI/RAG by default; remote LLM processing requires explicit user opt-in.
- Permission boundaries for plugins/importers/exporters.
- Audit trail for AI actions, user edits, and imported data.
- Data backup/export to avoid lock-in.

## Suggested First Redo Scope

- Knowledge graph with Person/Event/Concept/Place/Note/Source plus claim-based relations.
- Manual CRUD for entities and claims.
- Quick natural-language ingest that proposes entities/claims and requires confirmation.
- RAG-backed universal search/command box with strict schema outputs and fallback search.
- Provenance/citation/confidence metadata for AI-generated claims.
- Local-first storage and local AI/RAG default, with remote LLM opt-in.
- Lightweight in-app schema builder for advanced users.
- Prolog-style rule reasoning as a core capability.
- Network, timeline/card, table, and detail/source views.
- Provenance-aware AI answers over the graph.
- Personal relationship and reading/character-map modules as the first polished templates.

## Explicitly Later / Not PRD-Ready Yet

- Public module marketplace.
- Mobile-native offline sync details.
- Full calendar/GPS/social/contact integrations.
- Cross-media ingestion for images, PDFs, web pages, calendar/GPS logs, and chat exports.
- Collaborative sharing platform with granular permissions.
