import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  knowledgeBases,
  notes,
  proposals,
  users,
} from '../db/schema.js';
import { dbNoteStore } from '../notes/store.js';
import { dbClaimStore } from '../claims/store.js';
import { dbProposalStore } from './store.js';

/**
 * Integration tests for the AI proposal queue (US-017). Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${proposals}, ${claimArguments}, ${claims}, ${entities}, ${auditEvents}, ${notes}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('proposals integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'proposals@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Proposals KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('creates a proposal linked to a source note with an audit event (no outbox)', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'Ada met Charles.',
      actorUserId: userId,
    });

    const proposal = await dbProposalStore.createProposal({
      knowledgeBaseId: kbId,
      kind: 'extraction',
      changes: {
        items: [{ op: 'create_entity', ref: 'ada', type: 'Person', name: 'Ada' }],
      },
      sourceNoteId: note.id,
      provider: 'Mock Extractor',
      model: 'mock',
      metadata: { demo: true },
      actorUserId: userId,
    });

    expect(proposal.id).toBeTruthy();
    expect(proposal.status).toBe('pending');
    expect(proposal.sourceNoteId).toBe(note.id);

    const stored = await dbProposalStore.getProposal(kbId, proposal.id);
    expect(stored?.changes).toEqual(proposal.changes);

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'proposal.created'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.targetId).toBe(proposal.id);
  });

  it('lists pending proposals filtered by status and source note', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'text',
      actorUserId: userId,
    });
    await dbProposalStore.createProposal({
      knowledgeBaseId: kbId,
      kind: 'extraction',
      changes: { items: [] },
      sourceNoteId: note.id,
      actorUserId: userId,
    });

    const pending = await dbProposalStore.listProposals(kbId, { status: 'pending' });
    expect(pending).toHaveLength(1);

    const byNote = await dbProposalStore.listProposals(kbId, { sourceNoteId: note.id });
    expect(byNote).toHaveLength(1);

    const otherKb = await dbProposalStore.listProposals('00000000-0000-0000-0000-000000000000');
    expect(otherKb).toHaveLength(0);
  });

  it('reviewProposal marks a proposal accepted with reviewer + audit (US-018)', async () => {
    const proposal = await dbProposalStore.createProposal({
      knowledgeBaseId: kbId,
      kind: 'extraction',
      changes: { items: [{ op: 'create_entity', ref: 'ada', type: 'Person', name: 'Ada' }] },
      actorUserId: userId,
    });

    const reviewed = await dbProposalStore.reviewProposal({
      knowledgeBaseId: kbId,
      id: proposal.id,
      status: 'accepted',
      metadata: { appliedItemCount: 1 },
      actorUserId: userId,
    });
    expect(reviewed?.status).toBe('accepted');
    expect(reviewed?.reviewedBy).toBe(userId);
    expect(reviewed?.reviewedAt).toBeTruthy();

    // Reviewing an already-reviewed proposal returns undefined (not pending).
    const again = await dbProposalStore.reviewProposal({
      knowledgeBaseId: kbId,
      id: proposal.id,
      status: 'rejected',
      actorUserId: userId,
    });
    expect(again).toBeUndefined();

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'proposal.accepted'));
    expect(audits).toHaveLength(1);
  });

  it('updateProposalChanges replaces changes only while pending', async () => {
    const proposal = await dbProposalStore.createProposal({
      knowledgeBaseId: kbId,
      kind: 'extraction',
      changes: { items: [] },
      actorUserId: userId,
    });

    const updated = await dbProposalStore.updateProposalChanges({
      knowledgeBaseId: kbId,
      id: proposal.id,
      changes: { items: [{ op: 'create_entity', ref: 'x', type: 'Concept', name: 'Edited' }] },
      actorUserId: userId,
    });
    expect(updated?.changes).toEqual({
      items: [{ op: 'create_entity', ref: 'x', type: 'Concept', name: 'Edited' }],
    });

    await dbProposalStore.reviewProposal({
      knowledgeBaseId: kbId,
      id: proposal.id,
      status: 'rejected',
      actorUserId: userId,
    });
    const afterReview = await dbProposalStore.updateProposalChanges({
      knowledgeBaseId: kbId,
      id: proposal.id,
      changes: { items: [] },
      actorUserId: userId,
    });
    expect(afterReview).toBeUndefined();
  });

  it('persists accepted-claim provenance to the claims table (US-018 AC3)', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'Ada studies mathematics.',
      actorUserId: userId,
    });
    const claim = await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'studies',
      confidence: 0.8,
      provenance: {
        origin: 'ai_proposal',
        sourceNoteId: note.id,
        provider: 'mock',
        acceptedBy: userId,
      },
      arguments: [{ role: 'topic', argumentKind: 'literal', value: 'mathematics' }],
      actorUserId: userId,
    });

    const [stored] = await getDb().select().from(claims).where(eq(claims.id, claim.id));
    expect((stored?.provenance as Record<string, unknown>).origin).toBe('ai_proposal');
    expect((stored?.provenance as Record<string, unknown>).sourceNoteId).toBe(note.id);
    expect((stored?.provenance as Record<string, unknown>).acceptedBy).toBe(userId);
  });
});
