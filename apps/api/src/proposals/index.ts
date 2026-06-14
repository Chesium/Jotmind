import { Router, type RequestHandler } from 'express';
import {
  captureRequestSchema,
  kbRoleSatisfies,
  proposalSchema,
  resolveAiPolicy,
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
}

/**
 * Build the `/api/knowledge-bases/:kbId/proposals` router (US-017). Mounted with
 * `mergeParams: true`, AFTER the KB router. Reads require `viewer`; non-members
 * get 404 to hide existence (mirrors the other KB-scoped routers). Mutating the
 * queue (accept/reject) arrives in US-018.
 */
export function createProposalRouter(options: ProposalRouterOptions = {}): Router {
  const store = options.store ?? dbProposalStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
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
