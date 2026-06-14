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
};
