import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { auditEvents, knowledgeBases, notes, proposals, users } from '../db/schema.js';
import { dbNoteStore } from '../notes/store.js';
import { dbProposalStore } from './store.js';

/**
 * Integration tests for the AI proposal queue (US-017). Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${proposals}, ${auditEvents}, ${notes}, ${knowledgeBases}, ${users} CASCADE`,
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
});
