import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ProposalChanges } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { auditEvents, proposals, type ProposalRow } from '../db/schema.js';

export interface CreateProposalInput {
  knowledgeBaseId: string;
  kind: string;
  changes: ProposalChanges;
  sourceNoteId?: string | null;
  sourceSourceId?: string | null;
  sourceExcerptId?: string | null;
  provider?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
  actorUserId: string;
}

export interface ListProposalsFilter {
  status?: string;
  sourceNoteId?: string;
  sourceSourceId?: string;
}

/** Replace a pending proposal's structured changes (US-018 AC2). */
export interface UpdateProposalChangesInput {
  knowledgeBaseId: string;
  id: string;
  changes: ProposalChanges;
  actorUserId: string;
}

/** Terminal review states a proposal can move to (US-018). */
export type ProposalReviewStatus = 'accepted' | 'rejected' | 'dismissed';

/** Record the outcome of reviewing a proposal (accept/reject/dismiss, US-018). */
export interface ReviewProposalInput {
  knowledgeBaseId: string;
  id: string;
  status: ProposalReviewStatus;
  reviewReason?: string | null;
  /** Provenance/context recorded on the audit event (e.g. applied item count). */
  metadata?: Record<string, unknown>;
  actorUserId: string;
}

/**
 * Persistence boundary for AI/import proposals (US-017). Defined as an interface
 * so route handlers can run against an in-memory fake in unit tests (no live DB)
 * while production uses the PostgreSQL-backed impl.
 *
 * Proposals do NOT mutate canonical records and are NOT graph projection targets
 * — they sit in a review queue until accepted (US-018). Creating one records an
 * `audit_events` row (proposal.created) but no `graph_outbox` event. Reads
 * filter `deleted_at IS NULL`.
 */
export interface ProposalStore {
  listProposals(knowledgeBaseId: string, filter?: ListProposalsFilter): Promise<ProposalRow[]>;
  getProposal(knowledgeBaseId: string, id: string): Promise<ProposalRow | undefined>;
  createProposal(input: CreateProposalInput): Promise<ProposalRow>;
  /** Replace a pending proposal's changes (US-018). Undefined if not found. */
  updateProposalChanges(input: UpdateProposalChangesInput): Promise<ProposalRow | undefined>;
  /**
   * Mark a proposal accepted/rejected/dismissed and record the reviewer + an
   * audit event (US-018). Returns the updated row, or undefined if not found.
   */
  reviewProposal(input: ReviewProposalInput): Promise<ProposalRow | undefined>;
}

/** PostgreSQL-backed ProposalStore. Resolves the Drizzle client per call. */
export const dbProposalStore: ProposalStore = {
  async listProposals(knowledgeBaseId, filter) {
    const conditions = [
      eq(proposals.knowledgeBaseId, knowledgeBaseId),
      isNull(proposals.deletedAt),
    ];
    if (filter?.status) conditions.push(eq(proposals.status, filter.status));
    if (filter?.sourceNoteId) conditions.push(eq(proposals.sourceNoteId, filter.sourceNoteId));
    if (filter?.sourceSourceId) {
      conditions.push(eq(proposals.sourceSourceId, filter.sourceSourceId));
    }
    return getDb()
      .select()
      .from(proposals)
      .where(and(...conditions))
      .orderBy(desc(proposals.createdAt));
  },

  async getProposal(knowledgeBaseId, id) {
    const rows = await getDb()
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.id, id),
          eq(proposals.knowledgeBaseId, knowledgeBaseId),
          isNull(proposals.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async createProposal(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(proposals)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          kind: input.kind,
          status: 'pending',
          changes: input.changes,
          sourceNoteId: input.sourceNoteId ?? null,
          sourceSourceId: input.sourceSourceId ?? null,
          sourceExcerptId: input.sourceExcerptId ?? null,
          provider: input.provider ?? null,
          model: input.model ?? null,
          metadata: input.metadata ?? {},
          createdBy: input.actorUserId,
        })
        .returning();
      const proposal = rows[0];
      if (!proposal) throw new Error('Failed to create proposal');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: proposal.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'proposal.created',
        targetType: 'proposal',
        targetId: proposal.id,
        metadata: {
          kind: proposal.kind,
          provider: proposal.provider,
          itemCount: input.changes.items.length,
        },
      });

      return proposal;
    });
  },

  async updateProposalChanges(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.id),
            eq(proposals.knowledgeBaseId, input.knowledgeBaseId),
            eq(proposals.status, 'pending'),
            isNull(proposals.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const rows = await tx
        .update(proposals)
        .set({ changes: input.changes, updatedAt: new Date() })
        .where(
          and(eq(proposals.id, input.id), eq(proposals.knowledgeBaseId, input.knowledgeBaseId)),
        )
        .returning();
      const proposal = rows[0];
      if (!proposal) throw new Error('Failed to update proposal');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: proposal.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'proposal.updated',
        targetType: 'proposal',
        targetId: proposal.id,
        metadata: { itemCount: input.changes.items.length },
      });

      return proposal;
    });
  },

  async reviewProposal(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.id),
            eq(proposals.knowledgeBaseId, input.knowledgeBaseId),
            eq(proposals.status, 'pending'),
            isNull(proposals.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(proposals)
        .set({
          status: input.status,
          reviewReason: input.reviewReason ?? null,
          reviewedBy: input.actorUserId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(proposals.id, input.id), eq(proposals.knowledgeBaseId, input.knowledgeBaseId)),
        )
        .returning();
      const proposal = rows[0];
      if (!proposal) throw new Error('Failed to review proposal');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: proposal.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: `proposal.${input.status}`,
        targetType: 'proposal',
        targetId: proposal.id,
        metadata: input.metadata ?? {},
      });

      return proposal;
    });
  },
};
