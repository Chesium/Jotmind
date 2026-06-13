You are an expert technical product manager and systems architect. Your task is to update the provided "JotMind Graph-Note Redo" PRD to resolve several critical architectural ambiguities that would otherwise cause an autonomous coding agent (Ralph) to fail, hallucinate, or build brittle implementations.

Instructions:
Do not rewrite the PRD from scratch. Keep the existing structure, tone, and formatting intact. Inject the following specific technical constraints and structural rules into the appropriate sections of the PRD (e.g., Cross-Cutting Implementation Constraints, Glossary, Execution Model, and relevant User Stories).

Integrate these 8 exact technical mandates:

1. Merge Provenance Tracing (Archive & Pointer Pattern)

Where to update: Add to the "Glossary" (under Entity/Claim), "Cross-Cutting Implementation Constraints" (new subsection on Merges), and US-010.

Mandate: When entities merge, the system must not create nested compound nodes in the graph. Instead, implement an "Archive & Pointer" pattern. The relational entities table must use a nullable merged_into_id UUID column. When Entity A merges into Entity B, the system soft-deletes Entity A, sets its merged_into_id to Entity B, and updates the target IDs of all associated claims/edges to point to the surviving Entity B. To preserve provenance, the system must append a metadata object to those altered claims: provenance.historical_source_entities: [ "UUID-A" ].

2. Cross-Version Schema Queries (Conceptual String-Matching)

Where to update: Add to "Cross-Cutting Implementation Constraints" (under Custom schema v1 minimum) and US-028.

Mandate: For search and Datalog reasoning across different schema versions of the same entity (e.g., V1 and V2 of a "Person"), the system must enforce Conceptual String-Matching. Core lookups retrieve records by their conceptual string type (e.g., type = "Person"), ignoring the schema_version_id during retrieval. When evaluating JSONB fields within a rule or filter, properties that do not exist in older versions must be lazily evaluated as null rather than throwing validation or runtime errors.

3. AGE Projection Rebuilds (Read-Fallback State Machine)

Where to update: Add to "Cross-Cutting Implementation Constraints" (Source of truth and graph projection) and US-026.

Mandate: Rebuilding the Apache AGE projection must not lock the app or require complex blue/green swap architectures. Implement a Read-Fallback State Machine. Store a global graph_projection_status ('synchronized', 'rebuilding', 'failed') in PostgreSQL. During a 'rebuilding' state, the frontend must disable advanced AGE-dependent network views (displaying an "Indexing Graph..." UI state) and fall back entirely to raw relational PostgreSQL queries for core search, table views, and detail pages.

4. Reasoning Engine Constraints (Datalog Range-Restriction Safety)

Where to update: Add to "Cross-Cutting Implementation Constraints" (Reasoning v1 minimum) and US-023.

Mandate: To prevent infinite state explosion, the rule compiler must enforce strict Datalog Range-Restriction Safety. The parser must reject any rule where a variable appears in the head but does not appear in at least one positive, non-negated relational atom in the body. The creation of new existential tokens, skolem functions, or blank nodes in the head of a rule is strictly forbidden in V1. Rules may only infer new relations between already existing database entities.

5. Outbox Concurrency and Soft Deletes

Where to update: Add to "Cross-Cutting Implementation Constraints" (Source of truth and graph projection).

Mandate: The background projector worker must poll the graph_outbox using a single-threaded loop per knowledge_base_id via a SELECT ... FOR UPDATE SKIP LOCKED transaction block to guarantee deterministic FIFO ordering. For soft deletes: when a relational record sets deleted_at, the outbox event commands the projector to completely drop the corresponding node or edge from Apache AGE. Un-deleting a record pushes a brand-new insert event to the outbox.

6. Temporal and Soft-Deleted Data in Rules

Where to update: Add to "Cross-Cutting Implementation Constraints" (Reasoning v1 minimum) and US-024.

Mandate: The translation layer converting Datalog syntax into SQL/AGE queries must implement Compiler-Level Injection. It must automatically inject a hidden deleted_at IS NULL predicate onto every clause. Additionally, unless a rule explicitly references a valid time variable (e.g., valid_during(?claim, ?time)), the engine must automatically wrap the underlying query execution with a temporal bounds check: WHERE valid_start <= NOW() AND (valid_end IS NULL OR valid_end >= NOW()).

7. Workflow File Mutability (Monolithic Single-Writer Lock)

Where to update: Add to "Ralph Operating Model" (Execution Model and Subagent policy).

Mandate: Establish a strict Monolithic Single-Writer Lock for the Ralph operating files. Subagents spawned for code searching or writing files must operate as stateless execution units returning diffs. Only the primary monolithic loop agent is structurally permitted to read, edit, or write to fix_plan.md and AGENT.md. This write action must happen exactly once per cycle at the absolute end of the loop turnaround block to prevent race conditions.

8. CI Bloat and Adapter Tiering

Where to update: Add to "Ralph Operating Model" (Back-pressure and verification tiers) and US-034.

Mandate: To prevent CI timeouts from downloading large local LLMs during routine loops, testing must use strict Adapter Tiering. The pnpm verify command (the authoritative check for agent loop completions) must run in an isolated sandbox where all real AI adapter keys are blocked, executing 100% of assertions against the deterministic local mock provider. True local inference verification (testing against a running Ollama instance) is strictly isolated to a separate manual pnpm verify:local-ai command.