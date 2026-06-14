import {
  aiPolicySchema,
  answerResponseSchema,
  resolvedAiPolicySchema,
  auditEventSchema,
  authStateSchema,
  claimListSchema,
  claimSchema,
  commandResponseSchema,
  entityImpactSchema,
  entityListSchema,
  entitySchema,
  graphProjectionStatusSchema,
  acceptProposalResultSchema,
  captureResponseSchema,
  importEnqueueResponseSchema,
  knowledgeBaseListSchema,
  knowledgeBaseSchema,
  noteListSchema,
  noteSchema,
  proposalListSchema,
  proposalSchema,
  builtinRuleModuleListSchema,
  installModuleResultSchema,
  moduleStatusListSchema,
  acceptInferredResultResultSchema,
  installRulePackResultSchema,
  ruleDefinitionListSchema,
  ruleDefinitionSchema,
  ruleRunListSchema,
  ruleRunResultSchema,
  ruleValidationResultSchema,
  schemaDefinitionListSchema,
  schemaDefinitionSchema,
  schemaValidationReportSchema,
  updateSchemaResultSchema,
  publicJobSchema,
  publicUserSchema,
  setupStatusSchema,
  searchResponseSchema,
  sourceExcerptListSchema,
  sourceExcerptViewSchema,
  sourceListSchema,
  sourceSchema,
  type AccountRole,
  type AiPolicy,
  type AcceptProposalResult,
  type AnswerResponse,
  type CaptureRequest,
  type CaptureResponse,
  type CommandResponse,
  type Proposal,
  type ProposalChanges,
  type BuiltinRuleModule,
  type CreateRuleRequest,
  type InstallModuleResult,
  type ModuleStatus,
  type InstallRulePackResult,
  type RuleDefinition,
  type RuleRun,
  type RuleRunResult,
  type AcceptInferredResultResult,
  type RuleValidationResult,
  type UpdateRuleRequest,
  type ResolvedAiPolicy,
  type UpdateAiPolicy,
  type AuditEvent,
  type AuthState,
  type Claim,
  type CreateClaim,
  type CreateEntity,
  type CreateNote,
  type CreateSource,
  type CreateSourceExcerpt,
  type Entity,
  type EntityImpact,
  type GraphProjectionStatus,
  type ImportEnqueueResponse,
  type ImportRequest,
  type KnowledgeBase,
  type Note,
  type PublicJob,
  type PublicUser,
  type CreateSchemaDefinition,
  type SchemaDefinition,
  type SchemaValidationReport,
  type UpdateSchemaDefinition,
  type UpdateSchemaResult,
  type SearchQuery,
  type SearchResponse,
  type SetupStatus,
  type Source,
  type SourceExcerptView,
  type UpdateClaim,
  type UpdateEntity,
  type UpdateNote,
  type UpdateSource,
} from '@jotmind/schemas';

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${String(res.status)})`;
  } catch {
    return `Request failed (${String(res.status)})`;
  }
}

/** Current authenticated session, or null when not logged in. */
export async function getMe(): Promise<AuthState | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

/** Whether the server still needs first-run admin setup. */
export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/auth/setup-status', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  return setupStatusSchema.parse(await res.json());
}

export async function setupAdmin(email: string, password: string): Promise<AuthState> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

export async function login(email: string, password: string): Promise<AuthState> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

export async function logout(csrfToken: string): Promise<void> {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function createAccount(
  input: { email: string; password: string; role: AccountRole },
  csrfToken: string,
): Promise<PublicUser> {
  const res = await fetch('/api/auth/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return publicUserSchema.parse(await res.json());
}

/** List Knowledge Bases the current user is a member of. */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetch('/api/knowledge-bases', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  return knowledgeBaseListSchema.parse(await res.json());
}

/** Create a Knowledge Base; the current user becomes its owner. */
export async function createKnowledgeBase(
  input: { name: string; description?: string },
  csrfToken: string,
): Promise<KnowledgeBase> {
  const res = await fetch('/api/knowledge-bases', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return knowledgeBaseSchema.parse(await res.json());
}

/** List entities in a Knowledge Base. */
export async function listEntities(knowledgeBaseId: string): Promise<Entity[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entityListSchema.parse(await res.json());
}

/** Create an entity in a Knowledge Base (editor+). */
export async function createEntity(
  knowledgeBaseId: string,
  input: CreateEntity,
  csrfToken: string,
): Promise<Entity> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entitySchema.parse(await res.json());
}

/** Edit an entity in a Knowledge Base (editor+). */
export async function updateEntity(
  knowledgeBaseId: string,
  entityId: string,
  input: UpdateEntity,
  csrfToken: string,
): Promise<Entity> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities/${entityId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entitySchema.parse(await res.json());
}

/** Fetch the claims affected by deleting/merging an entity (US-010). */
export async function getEntityImpact(
  knowledgeBaseId: string,
  entityId: string,
): Promise<EntityImpact> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities/${entityId}/impact`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entityImpactSchema.parse(await res.json());
}

/** Soft-delete an entity in a Knowledge Base (editor+). */
export async function deleteEntity(
  knowledgeBaseId: string,
  entityId: string,
  csrfToken: string,
): Promise<void> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities/${entityId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/** Merge one entity (source) into another (survivor) in a Knowledge Base (editor+). */
export async function mergeEntity(
  knowledgeBaseId: string,
  sourceId: string,
  targetId: string,
  csrfToken: string,
): Promise<Entity> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities/${sourceId}/merge`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ targetId }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entitySchema.parse(await res.json());
}

/** List claims in a Knowledge Base. */
export async function listClaims(knowledgeBaseId: string): Promise<Claim[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/claims`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return claimListSchema.parse(await res.json());
}

/** Create a claim in a Knowledge Base (editor+). */
export async function createClaim(
  knowledgeBaseId: string,
  input: CreateClaim,
  csrfToken: string,
): Promise<Claim> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/claims`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return claimSchema.parse(await res.json());
}

/** Soft-delete a claim in a Knowledge Base (editor+). */
export async function deleteClaim(
  knowledgeBaseId: string,
  claimId: string,
  csrfToken: string,
): Promise<void> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/claims/${claimId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/** Edit a claim in a Knowledge Base (editor+). */
export async function updateClaim(
  knowledgeBaseId: string,
  claimId: string,
  input: UpdateClaim,
  csrfToken: string,
): Promise<Claim> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/claims/${claimId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return claimSchema.parse(await res.json());
}

// --- Notes (US-011) -------------------------------------------------------

/** List notes in a Knowledge Base. */
export async function listNotes(knowledgeBaseId: string): Promise<Note[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/notes`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return noteListSchema.parse(await res.json());
}

/** Create a note from freeform text (editor+). No AI provider required. */
export async function createNote(
  knowledgeBaseId: string,
  input: CreateNote,
  csrfToken: string,
): Promise<Note> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/notes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return noteSchema.parse(await res.json());
}

/** Edit a note (editor+). */
export async function updateNote(
  knowledgeBaseId: string,
  noteId: string,
  input: UpdateNote,
  csrfToken: string,
): Promise<Note> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/notes/${noteId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return noteSchema.parse(await res.json());
}

/** Soft-delete a note (editor+). */
export async function deleteNote(
  knowledgeBaseId: string,
  noteId: string,
  csrfToken: string,
): Promise<void> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/notes/${noteId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// --- Sources (US-011) -----------------------------------------------------

/** List sources in a Knowledge Base. */
export async function listSources(knowledgeBaseId: string): Promise<Source[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/sources`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return sourceListSchema.parse(await res.json());
}

/** Create a source for captured/imported material (editor+). */
export async function createSource(
  knowledgeBaseId: string,
  input: CreateSource,
  csrfToken: string,
): Promise<Source> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/sources`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return sourceSchema.parse(await res.json());
}

/** Edit a source (editor+). */
export async function updateSource(
  knowledgeBaseId: string,
  sourceId: string,
  input: UpdateSource,
  csrfToken: string,
): Promise<Source> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return sourceSchema.parse(await res.json());
}

/** Soft-delete a source (editor+). */
export async function deleteSource(
  knowledgeBaseId: string,
  sourceId: string,
  csrfToken: string,
): Promise<void> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/sources/${sourceId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// --- Source excerpts / citations (US-011) ---------------------------------

/** List source excerpts, optionally filtered by note/source/claim. */
export async function listSourceExcerpts(
  knowledgeBaseId: string,
  filter: { noteId?: string; sourceId?: string; claimId?: string } = {},
): Promise<SourceExcerptView[]> {
  const params = new URLSearchParams();
  if (filter.noteId) params.set('noteId', filter.noteId);
  if (filter.sourceId) params.set('sourceId', filter.sourceId);
  if (filter.claimId) params.set('claimId', filter.claimId);
  const qs = params.toString();
  const res = await fetch(
    `/api/knowledge-bases/${knowledgeBaseId}/source-excerpts${qs ? `?${qs}` : ''}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return sourceExcerptListSchema.parse(await res.json());
}

/**
 * Graph projection status (US-026): lifecycle state, projector identity, and
 * outbox backlog. Drives the "Indexing Graph..." network state and lag/failure
 * visibility.
 */
export async function getGraphProjectionStatus(): Promise<GraphProjectionStatus> {
  const res = await fetch('/api/graph/projection/status', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  return graphProjectionStatusSchema.parse(await res.json());
}

/** Create a source excerpt / citation referencing a note or source (editor+). */
export async function createSourceExcerpt(
  knowledgeBaseId: string,
  input: CreateSourceExcerpt,
  csrfToken: string,
): Promise<SourceExcerptView> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/source-excerpts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return sourceExcerptViewSchema.parse(await res.json());
}

/** Soft-delete a source excerpt (editor+). */
export async function deleteSourceExcerpt(
  knowledgeBaseId: string,
  excerptId: string,
  csrfToken: string,
): Promise<void> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/source-excerpts/${excerptId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// --- Manual search & filters (US-012) -------------------------------------

/**
 * Token + filter search across entities, claims, notes, and sources, scoped to
 * one Knowledge Base. Works without any AI provider; `vectorSearch.available`
 * reports whether semantic search is possible.
 */
export async function search(
  knowledgeBaseId: string,
  query: SearchQuery = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/search${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return searchResponseSchema.parse(await res.json());
}

// --- Universal command / search box (US-019) ------------------------------

/**
 * Run the command box: a natural-language query. Manual token search always
 * runs (`fallback`), so this works with AI disabled. When AI is configured and
 * permitted, the server additionally returns a structured `interpretation` and
 * its `interpretedResults`. Read-only (no mutation), so no CSRF token needed.
 */
export async function runCommand(knowledgeBaseId: string, q: string): Promise<CommandResponse> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/command`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return commandResponseSchema.parse(await res.json());
}

export async function answerQuestion(knowledgeBaseId: string, q: string): Promise<AnswerResponse> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/answers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return answerResponseSchema.parse(await res.json());
}

/** Knowledge Base audit summary (admin/owner only). Newest events first. */
export async function listKbAudit(knowledgeBaseId: string): Promise<AuditEvent[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/audit`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as unknown[];
  return body.map((e) => auditEventSchema.parse(e));
}

/** Background jobs scoped to a Knowledge Base (admin/owner only). */
export async function listKbJobs(knowledgeBaseId: string): Promise<PublicJob[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/jobs`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { jobs: unknown[] };
  return body.jobs.map((j) => publicJobSchema.parse(j));
}

// --- Layered AI privacy policy (US-016) ------------------------------------

export interface AiPolicyOverview {
  server: AiPolicy;
  user: AiPolicy;
  effective: ResolvedAiPolicy;
}

export interface KbAiPolicyView {
  policy: AiPolicy;
  server: AiPolicy;
  user: AiPolicy;
  effective: ResolvedAiPolicy;
}

/** The caller's effective non-KB AI policy (server + user layers). */
export async function getAiPolicyOverview(): Promise<AiPolicyOverview> {
  const res = await fetch('/api/ai/policy', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return {
    server: aiPolicySchema.parse(body.server),
    user: aiPolicySchema.parse(body.user),
    effective: resolvedAiPolicySchema.parse(body.effective),
  };
}

/** Set the server-wide AI policy layer (system admin only). */
export async function updateServerAiPolicy(
  changes: UpdateAiPolicy,
  csrfToken: string,
): Promise<AiPolicy> {
  const res = await fetch('/api/ai/policy/server', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return aiPolicySchema.parse(await res.json());
}

/** Set the caller's own user AI policy layer. */
export async function updateMyAiPolicy(
  changes: UpdateAiPolicy,
  csrfToken: string,
): Promise<AiPolicy> {
  const res = await fetch('/api/ai/policy/me', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return aiPolicySchema.parse(await res.json());
}

/** Knowledge-Base AI policy + effective policy (server + KB + user). */
export async function getKbAiPolicy(knowledgeBaseId: string): Promise<KbAiPolicyView> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/ai/policy`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return {
    policy: aiPolicySchema.parse(body.policy),
    server: aiPolicySchema.parse(body.server),
    user: aiPolicySchema.parse(body.user),
    effective: resolvedAiPolicySchema.parse(body.effective),
  };
}

/** Set the Knowledge-Base AI policy layer (KB admin/owner only). */
export async function updateKbAiPolicy(
  knowledgeBaseId: string,
  changes: UpdateAiPolicy,
  csrfToken: string,
): Promise<KbAiPolicyView> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/ai/policy`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return {
    policy: aiPolicySchema.parse(body.policy),
    server: aiPolicySchema.parse(body.server),
    user: aiPolicySchema.parse(body.user),
    effective: resolvedAiPolicySchema.parse(body.effective),
  };
}

/**
 * Quick-capture text into a Note/Source and (if AI is available) the AI proposal
 * review queue (US-017). The original text is always stored first; extraction
 * runs only when AI is configured and permitted by policy, otherwise the
 * response reports an `unavailable` extraction state.
 */
export async function quickCapture(
  knowledgeBaseId: string,
  input: CaptureRequest,
  csrfToken: string,
): Promise<CaptureResponse> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/capture`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return captureResponseSchema.parse(await res.json());
}

/** List AI/import proposals awaiting review in a Knowledge Base (viewer+). */
export async function listProposals(knowledgeBaseId: string, status?: string): Promise<Proposal[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/proposals${query}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return proposalListSchema.parse(await res.json());
}

/**
 * Accept a pending proposal (US-018). With no `itemIndexes` the whole batch is
 * applied; an `itemIndexes` array applies only those candidate changes. Returns
 * the updated proposal plus the ids of the created entities/claims.
 */
export async function acceptProposal(
  knowledgeBaseId: string,
  proposalId: string,
  body: { itemIndexes?: number[]; note?: string },
  csrfToken: string,
): Promise<AcceptProposalResult> {
  const res = await fetch(
    `/api/knowledge-bases/${knowledgeBaseId}/proposals/${proposalId}/accept`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return acceptProposalResultSchema.parse(await res.json());
}

/** Reject (or dismiss) a pending proposal; it stays linked to its source. */
export async function rejectProposal(
  knowledgeBaseId: string,
  proposalId: string,
  body: { reason?: string; dismiss?: boolean },
  csrfToken: string,
): Promise<Proposal> {
  const res = await fetch(
    `/api/knowledge-bases/${knowledgeBaseId}/proposals/${proposalId}/reject`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return proposalSchema.parse(await res.json());
}

/** Edit a pending proposal's structured changes before accepting (US-018). */
export async function editProposal(
  knowledgeBaseId: string,
  proposalId: string,
  changes: ProposalChanges,
  csrfToken: string,
): Promise<Proposal> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/proposals/${proposalId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ changes }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return proposalSchema.parse(await res.json());
}

/**
 * Enqueue a reviewable data import (US-031, editor+). Returns the durable job
 * id; the import is parsed into a pending proposal in the review queue (AC3).
 */
export async function createImport(
  knowledgeBaseId: string,
  request: ImportRequest,
  csrfToken: string,
): Promise<ImportEnqueueResponse> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/imports`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return importEnqueueResponseSchema.parse(await res.json());
}

/** List this Knowledge Base's import jobs + their status/failures (US-031, viewer+). */
export async function listImports(knowledgeBaseId: string): Promise<PublicJob[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/imports`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = (await res.json()) as { jobs: unknown[] };
  return body.jobs.map((j) => publicJobSchema.parse(j));
}

/** List built-in domain Modules with per-KB installed status (US-029, viewer+). */
export async function listModules(knowledgeBaseId: string): Promise<ModuleStatus[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/modules`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return moduleStatusListSchema.parse(await res.json());
}

/** Install a built-in Module's default schemas + rule packs (US-029, editor+). */
export async function installModule(
  knowledgeBaseId: string,
  moduleId: string,
  csrfToken: string,
): Promise<InstallModuleResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/modules/install`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ moduleId }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return installModuleResultSchema.parse(await res.json());
}

/** List the catalog of built-in Module rule packs (US-022, viewer+). */
export async function listBuiltinRulePacks(knowledgeBaseId: string): Promise<BuiltinRuleModule[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/packs`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return builtinRuleModuleListSchema.parse(await res.json());
}

/** List rules installed in a Knowledge Base (US-022, viewer+). */
export async function listRules(knowledgeBaseId: string): Promise<RuleDefinition[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleDefinitionListSchema.parse(await res.json());
}

/** Install a built-in rule pack into a Knowledge Base (US-022, editor+). */
export async function installRulePack(
  knowledgeBaseId: string,
  body: { moduleId: string; packId: string },
  csrfToken: string,
): Promise<InstallRulePackResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/install`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return installRulePackResultSchema.parse(await res.json());
}

/** Enable or disable an installed rule (US-022, editor+; auditable). */
export async function setRuleStatus(
  knowledgeBaseId: string,
  ruleId: string,
  status: 'enabled' | 'disabled',
  csrfToken: string,
): Promise<RuleDefinition> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/${ruleId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleDefinitionSchema.parse(await res.json());
}

/** Validate rule text without saving (US-023, viewer+; live preview). */
export async function validateRule(
  knowledgeBaseId: string,
  ruleText: string,
  recursionCap?: number,
): Promise<RuleValidationResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/validate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ruleText, recursionCap }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleValidationResultSchema.parse(await res.json());
}

/** Author a custom rule (US-023, editor+). Saved as a draft. */
export async function createRule(
  knowledgeBaseId: string,
  body: CreateRuleRequest,
  csrfToken: string,
): Promise<RuleDefinition> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleDefinitionSchema.parse(await res.json());
}

/** Edit an authored rule (US-023, editor+). */
export async function updateRule(
  knowledgeBaseId: string,
  ruleId: string,
  body: UpdateRuleRequest,
  csrfToken: string,
): Promise<RuleDefinition> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/${ruleId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleDefinitionSchema.parse(await res.json());
}

/** Run an enabled rule against stored data, returning the run + results (US-024, editor+). */
export async function runRule(
  knowledgeBaseId: string,
  ruleId: string,
  csrfToken: string,
): Promise<RuleRunResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/${ruleId}/run`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleRunResultSchema.parse(await res.json());
}

/** List recorded rule runs for a Knowledge Base (US-024, viewer+). */
export async function listRuleRuns(knowledgeBaseId: string): Promise<RuleRun[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/runs`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleRunListSchema.parse(await res.json());
}

/** Get a single rule run plus its inferred results (US-024, viewer+). */
export async function getRuleRun(knowledgeBaseId: string, runId: string): Promise<RuleRunResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/rules/runs/${runId}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ruleRunResultSchema.parse(await res.json());
}

/** Accept an inferred result as a stored claim (US-025, editor+). */
export async function acceptInferredResult(
  knowledgeBaseId: string,
  runId: string,
  resultId: string,
  csrfToken: string,
  confirmationNote?: string,
): Promise<AcceptInferredResultResult> {
  const res = await fetch(
    `/api/knowledge-bases/${knowledgeBaseId}/rules/runs/${runId}/results/${resultId}/accept`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(confirmationNote ? { confirmationNote } : {}),
    },
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return acceptInferredResultResultSchema.parse(await res.json());
}

/** List custom schema definitions in a Knowledge Base (US-027, viewer+). */
export async function listSchemaDefinitions(knowledgeBaseId: string): Promise<SchemaDefinition[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/schema`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return schemaDefinitionListSchema.parse(await res.json());
}

/** Create a custom schema definition + its initial active version (US-027, editor+). */
export async function createSchemaDefinition(
  knowledgeBaseId: string,
  body: CreateSchemaDefinition,
  csrfToken: string,
): Promise<SchemaDefinition> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/schema`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return schemaDefinitionSchema.parse(await res.json());
}

/** Update a schema definition (US-028, editor+). Classified compatible vs breaking. */
export async function updateSchemaDefinition(
  knowledgeBaseId: string,
  defId: string,
  body: UpdateSchemaDefinition,
  csrfToken: string,
): Promise<UpdateSchemaResult> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/schema/${defId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return updateSchemaResultSchema.parse(await res.json());
}

/** Validation report over existing records for a schema definition (US-028 AC6, viewer+). */
export async function getSchemaValidation(
  knowledgeBaseId: string,
  defId: string,
): Promise<SchemaValidationReport> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/schema/${defId}/validation`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return schemaValidationReportSchema.parse(await res.json());
}
