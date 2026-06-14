import { Router, type RequestHandler } from 'express';
import {
  acceptProposalSchema,
  captureRequestSchema,
  editProposalSchema,
  kbRoleSatisfies,
  proposalChangesSchema,
  proposalSchema,
  rejectProposalSchema,
  resolveAiPolicy,
  type AcceptProposalResult,
  type CaptureExtractionResult,
  type CaptureResponse,
  type ExtractionAvailability,
  type KbRole,
  type Note,
  type ProposalChange,
  type Proposal,
  type Source,
} from '@jotmind/schemas';
import { noteSchema, sourceSchema } from '@jotmind/schemas';
import type { NoteRow, ProposalRow, SourceRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbNoteStore, type NoteStore } from '../notes/store.js';
import { dbSourceStore, type SourceStore } from '../sources/store.js';
import { dbEntityStore, type EntityStore } from '../entities/store.js';
import { dbClaimStore, type ClaimArgumentInput, type ClaimStore } from '../claims/store.js';
import { dbAiPolicyStore, type AiPolicyStore } from '../ai-policy/store.js';
import {
  MOCK_EXTRACTION_LABEL,
  isRemoteProviderKind,
  type GraphExtractor,
} from '../extraction/index.js';
import { dbProposalStore, type ProposalStore } from './store.js';

export type { ProposalStore } from './store.js';
export { dbProposalStore } from './store.js';

/** Map a DB proposal row to its public API shape. */
export function toProposal(row: ProposalRow): Proposal {
  return proposalSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    kind: row.kind,
    status: row.status,
    changes: row.changes,
    sourceNoteId: row.sourceNoteId,
    sourceSourceId: row.sourceSourceId,
    sourceExcerptId: row.sourceExcerptId,
    provider: row.provider,
    model: row.model,
    reviewReason: row.reviewReason,
    metadata: row.metadata,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toNote(row: NoteRow): Note {
  return noteSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    content: row.content,
    properties: row.properties,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toSource(row: SourceRow): Source {
  return sourceSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    sourceType: row.sourceType,
    uri: row.uri,
    content: row.content,
    metadata: row.metadata,
    properties: row.properties,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

interface KbRouterDeps {
  kbStore: KnowledgeBaseStore;
}

function makeRequireKbRole({ kbStore }: KbRouterDeps): (min: KbRole) => RequestHandler {
  return (min: KbRole) =>
    asyncHandler(async (req, res, next) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId;
      if (!kbId) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      const role = await kbStore.getRole(kbId, ctx.user.id);
      if (!role) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      if (!kbRoleSatisfies(role, min)) {
        res.status(403).json({ error: 'Insufficient Knowledge Base role' });
        return;
      }
      req.kbRole = role;
      next();
    });
}

export interface ProposalRouterOptions {
  store?: ProposalStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  entityStore?: EntityStore;
  claimStore?: ClaimStore;
  noteStore?: NoteStore;
  sourceStore?: SourceStore;
}

/** Outcome of applying a proposal's selected changes (US-018/US-031). */
type ApplyResult =
  | {
      ok: true;
      createdEntityIds: string[];
      createdClaimIds: string[];
      createdNoteIds: string[];
      createdSourceIds: string[];
    }
  | { ok: false; reason: string };

/**
 * Apply the selected create-entity / create-claim items of a proposal as
 * canonical records (US-018 AC2/AC3/AC4). Entities are created first so claim
 * arguments can resolve their `ref` to the new id; an arg `ref` that is not a
 * created entity is treated as an existing entity id and must resolve to a real
 * entity in the KB (otherwise the apply is rejected — invalid payloads cannot
 * execute, AC4). Accepted claims carry provenance: source note/source,
 * provider/model, confidence, and user-confirmation metadata.
 */
async function applyProposalChanges(args: {
  kbId: string;
  proposal: ProposalRow;
  items: ProposalChange[];
  entityStore: EntityStore;
  claimStore: ClaimStore;
  noteStore: NoteStore;
  sourceStore: SourceStore;
  actorUserId: string;
  confirmationNote?: string;
}): Promise<ApplyResult> {
  const {
    kbId,
    proposal,
    items,
    entityStore,
    claimStore,
    noteStore,
    sourceStore,
    actorUserId,
    confirmationNote,
  } = args;

  const entityItems = items.filter((i) => i.op === 'create_entity');
  const claimItems = items.filter((i) => i.op === 'create_claim');
  const noteItems = items.filter((i) => i.op === 'create_note');
  const sourceItems = items.filter((i) => i.op === 'create_source');

  // Pre-validate every claim entity-arg ref resolves before mutating anything.
  const newRefs = new Set(entityItems.map((e) => e.ref));
  for (const claim of claimItems) {
    for (const arg of claim.arguments) {
      if (arg.kind !== 'entity') continue;
      const ref = arg.ref as string;
      if (newRefs.has(ref)) continue;
      const existing = await entityStore.getEntity(kbId, ref);
      if (!existing) {
        return { ok: false, reason: `Claim argument references unknown entity "${ref}"` };
      }
    }
  }

  // Create entities, mapping each local ref to its new id.
  const refToId = new Map<string, string>();
  const createdEntityIds: string[] = [];
  for (const item of entityItems) {
    const entity = await entityStore.createEntity({
      knowledgeBaseId: kbId,
      type: item.type,
      name: item.name,
      aliases: item.aliases ?? [],
      description: item.description,
      tags: item.tags ?? [],
      properties: item.properties ?? {},
      actorUserId,
    });
    refToId.set(item.ref, entity.id);
    createdEntityIds.push(entity.id);
  }

  // Create claims, resolving entity-arg refs and recording provenance (AC3).
  const acceptedAt = new Date().toISOString();
  const createdClaimIds: string[] = [];
  for (const item of claimItems) {
    const claimArgs: ClaimArgumentInput[] = item.arguments.map((arg) => {
      if (arg.kind === 'entity') {
        const ref = arg.ref as string;
        return {
          role: arg.role,
          argumentKind: 'entity' as const,
          entityId: refToId.get(ref) ?? ref,
        };
      }
      return { role: arg.role, argumentKind: 'literal' as const, value: arg.value };
    });

    const provenance: Record<string, unknown> = {
      origin: 'ai_proposal',
      proposalId: proposal.id,
      sourceNoteId: proposal.sourceNoteId,
      sourceSourceId: proposal.sourceSourceId,
      provider: proposal.provider,
      model: proposal.model,
      acceptedBy: actorUserId,
      acceptedAt,
    };
    if (confirmationNote) provenance.confirmationNote = confirmationNote;

    const created = await claimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: item.predicate,
      description: item.description,
      confidence: item.confidence,
      provenance,
      arguments: claimArgs,
      actorUserId,
    });
    createdClaimIds.push(created.id);
  }

  // Create notes/sources imported as content (US-031). These have no refs and
  // no dependencies, so order relative to entities/claims does not matter.
  const createdNoteIds: string[] = [];
  for (const item of noteItems) {
    const note = await noteStore.createNote({
      knowledgeBaseId: kbId,
      title: item.title,
      content: item.content,
      properties: item.properties ?? {},
      actorUserId,
    });
    createdNoteIds.push(note.id);
  }

  const createdSourceIds: string[] = [];
  for (const item of sourceItems) {
    const source = await sourceStore.createSource({
      knowledgeBaseId: kbId,
      title: item.title,
      sourceType: item.sourceType,
      uri: item.uri,
      content: item.content,
      properties: item.properties ?? {},
      actorUserId,
    });
    createdSourceIds.push(source.id);
  }

  return { ok: true, createdEntityIds, createdClaimIds, createdNoteIds, createdSourceIds };
}

/**
 * Build the `/api/knowledge-bases/:kbId/proposals` router (US-017/US-018).
 * Mounted with `mergeParams: true`, AFTER the KB router. Reads require `viewer`;
 * non-members get 404 to hide existence. Reviewing the queue
 * (edit/accept/reject) requires `editor` + CSRF, so viewers are read-only.
 */
export function createProposalRouter(options: ProposalRouterOptions = {}): Router {
  const store = options.store ?? dbProposalStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const entityStore = options.entityStore ?? dbEntityStore;
  const claimStore = options.claimStore ?? dbClaimStore;
  const noteStore = options.noteStore ?? dbNoteStore;
  const sourceStore = options.sourceStore ?? dbSourceStore;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);
  const requireKbRole = makeRequireKbRole({ kbStore });

  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const filter = {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        sourceNoteId:
          typeof req.query.sourceNoteId === 'string' ? req.query.sourceNoteId : undefined,
        sourceSourceId:
          typeof req.query.sourceSourceId === 'string' ? req.query.sourceSourceId : undefined,
      };
      const list = await store.listProposals(req.params.kbId as string, filter);
      res.json(list.map(toProposal));
    }),
  );

  // Edit a pending proposal's structured changes before accepting (AC2). The
  // replacement is re-validated, so invalid payloads can never be saved (AC4).
  router.patch(
    '/:proposalId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const ctx = req.auth as AuthContext;
      const parsed = editProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid proposal changes' });
        return;
      }
      const updated = await store.updateProposalChanges({
        knowledgeBaseId: kbId,
        id: req.params.proposalId as string,
        changes: parsed.data.changes,
        actorUserId: ctx.user.id,
      });
      if (!updated) {
        res.status(404).json({ error: 'Pending proposal not found' });
        return;
      }
      res.json(toProposal(updated));
    }),
  );

  // Accept a pending proposal: apply selected items as canonical records (AC2/
  // AC3), then mark it accepted. Invalid stored payloads are rejected (AC4).
  router.post(
    '/:proposalId/accept',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const ctx = req.auth as AuthContext;
      const parsedBody = acceptProposalSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Invalid accept request' });
        return;
      }

      const proposal = await store.getProposal(kbId, req.params.proposalId as string);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (proposal.status !== 'pending') {
        res.status(409).json({ error: 'Proposal has already been reviewed' });
        return;
      }

      // Re-validate the stored payload so a malformed proposal cannot execute.
      const changesParsed = proposalChangesSchema.safeParse(proposal.changes);
      if (!changesParsed.success) {
        res.status(422).json({ error: 'Proposal payload is invalid and cannot be applied' });
        return;
      }
      const allItems = changesParsed.data.items;

      // Resolve item-level selection (AC2). Default = the whole batch.
      let items = allItems;
      if (parsedBody.data.itemIndexes) {
        const indexes = parsedBody.data.itemIndexes;
        if (indexes.some((i) => i >= allItems.length)) {
          res.status(400).json({ error: 'itemIndexes out of range' });
          return;
        }
        items = indexes.map((i) => allItems[i] as ProposalChange);
      }

      const applied = await applyProposalChanges({
        kbId,
        proposal,
        items,
        entityStore,
        claimStore,
        noteStore,
        sourceStore,
        actorUserId: ctx.user.id,
        confirmationNote: parsedBody.data.note,
      });
      if (!applied.ok) {
        res.status(422).json({ error: applied.reason });
        return;
      }

      const reviewed = await store.reviewProposal({
        knowledgeBaseId: kbId,
        id: proposal.id,
        status: 'accepted',
        metadata: {
          appliedItemCount: items.length,
          createdEntityIds: applied.createdEntityIds,
          createdClaimIds: applied.createdClaimIds,
          createdNoteIds: applied.createdNoteIds,
          createdSourceIds: applied.createdSourceIds,
        },
        actorUserId: ctx.user.id,
      });
      if (!reviewed) {
        res.status(409).json({ error: 'Proposal has already been reviewed' });
        return;
      }

      const result: AcceptProposalResult = {
        proposal: toProposal(reviewed),
        createdEntityIds: applied.createdEntityIds,
        createdClaimIds: applied.createdClaimIds,
        createdNoteIds: applied.createdNoteIds,
        createdSourceIds: applied.createdSourceIds,
      };
      res.status(201).json(result);
    }),
  );

  // Reject (or dismiss) a pending proposal; it stays linked to its source (AC2).
  router.post(
    '/:proposalId/reject',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const ctx = req.auth as AuthContext;
      const parsed = rejectProposalSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid reject request' });
        return;
      }
      const reviewed = await store.reviewProposal({
        knowledgeBaseId: kbId,
        id: req.params.proposalId as string,
        status: parsed.data.dismiss ? 'dismissed' : 'rejected',
        reviewReason: parsed.data.reason ?? null,
        actorUserId: ctx.user.id,
      });
      if (!reviewed) {
        res.status(404).json({ error: 'Pending proposal not found' });
        return;
      }
      res.json(toProposal(reviewed));
    }),
  );

  return router;
}

/**
 * Compute whether AI extraction is currently available for a capture, and why
 * not if it is not (US-017 AC3/AC4/AC6). Availability requires a configured
 * extractor AND an AI policy that permits it; remote extractors additionally
 * require the policy to allow remote calls.
 */
export function computeExtractionAvailability(
  extractor: GraphExtractor | null,
  policy: { mode: string; remoteAllowed: boolean },
): ExtractionAvailability {
  const base = {
    provider: extractor?.name ?? null,
    model: extractor?.model ?? null,
    demo: extractor?.demo ?? false,
    verified: extractor?.verified ?? true,
    label: extractor?.demo ? MOCK_EXTRACTION_LABEL : null,
  };
  if (!extractor) {
    return { available: false, reason: 'No AI provider is configured', ...base };
  }
  if (policy.mode === 'off') {
    return { available: false, reason: 'AI is disabled by policy', ...base };
  }
  if (isRemoteProviderKind(extractor.providerKind) && !policy.remoteAllowed) {
    return {
      available: false,
      reason: 'Remote AI is not permitted by policy',
      ...base,
    };
  }
  return { available: true, reason: null, ...base };
}

export interface CaptureRouterOptions {
  proposalStore?: ProposalStore;
  noteStore?: NoteStore;
  sourceStore?: SourceStore;
  aiPolicyStore?: AiPolicyStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  /** Configured extractor, or null for a No-AI install (AC4). */
  extractor?: GraphExtractor | null;
}

/**
 * Build the `/api/knowledge-bases/:kbId/capture` router (US-017). `POST /`
 * stores the text as a Note or Source FIRST (AC1), then — if AI is available —
 * runs extraction and stores the candidates as a single pending proposal (AC2).
 * With no AI it returns the stored record and an `unavailable` extraction state
 * without blocking (AC4). Requires `editor` (+ CSRF); viewers are read-only.
 */
export function createCaptureRouter(options: CaptureRouterOptions = {}): Router {
  const proposalStore = options.proposalStore ?? dbProposalStore;
  const noteStore = options.noteStore ?? dbNoteStore;
  const sourceStore = options.sourceStore ?? dbSourceStore;
  const aiPolicyStore = options.aiPolicyStore ?? dbAiPolicyStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const extractor = options.extractor ?? null;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);
  const requireKbRole = makeRequireKbRole({ kbStore });

  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const parsed = captureRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid capture details' });
        return;
      }
      const { kind, title, content, sourceType, uri, extract } = parsed.data;

      // 1. Store the original text FIRST (AC1) — never lost, even if AI fails.
      let note: Note | null = null;
      let source: Source | null = null;
      let sourceNoteId: string | null = null;
      let sourceSourceId: string | null = null;
      if (kind === 'note') {
        const row = await noteStore.createNote({
          knowledgeBaseId: kbId,
          title,
          content,
          actorUserId: ctx.user.id,
        });
        note = toNote(row);
        sourceNoteId = row.id;
      } else {
        const row = await sourceStore.createSource({
          knowledgeBaseId: kbId,
          title: title ?? 'Captured source',
          sourceType,
          uri,
          content,
          actorUserId: ctx.user.id,
        });
        source = toSource(row);
        sourceSourceId = row.id;
      }

      // 2. Resolve AI availability from the layered policy (server + user + KB).
      const policies = await aiPolicyStore.getPolicies([
        { scope: 'server', scopeId: null },
        { scope: 'user', scopeId: ctx.user.id },
        { scope: 'knowledge_base', scopeId: kbId },
      ]);
      const resolved = resolveAiPolicy(policies);
      const availability = computeExtractionAvailability(extractor, resolved);

      // 3. Extract (when available and not explicitly skipped) and queue a proposal.
      let extraction: CaptureExtractionResult;
      if (!availability.available || extract === false || !extractor) {
        extraction = {
          status: 'unavailable',
          availability,
          proposal: null,
          error: extract === false && availability.available ? 'Extraction skipped' : null,
        };
      } else {
        try {
          const changes: ProposalChange[] = await extractor.extract(content);
          if (changes.length === 0) {
            extraction = { status: 'empty', availability, proposal: null, error: null };
          } else {
            const row = await proposalStore.createProposal({
              knowledgeBaseId: kbId,
              kind: 'extraction',
              changes: { items: changes },
              sourceNoteId,
              sourceSourceId,
              provider: extractor.name,
              model: extractor.model,
              metadata: availability.demo ? { label: MOCK_EXTRACTION_LABEL, demo: true } : {},
              actorUserId: ctx.user.id,
            });
            extraction = {
              status: 'created',
              availability,
              proposal: toProposal(row),
              error: null,
            };
          }
        } catch (err) {
          extraction = {
            status: 'error',
            availability,
            proposal: null,
            error: err instanceof Error ? err.message : 'Extraction failed',
          };
        }
      }

      const response: CaptureResponse = { kind, note, source, extraction };
      res.status(201).json(response);
    }),
  );

  return router;
}
