import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claimArguments,
  claims,
  entities,
  graphOutbox,
  knowledgeBases,
  notes,
  sources,
  users,
} from '../db/schema.js';
import { dbClaimStore } from '../claims/store.js';
import { dbEntityStore } from '../entities/store.js';
import { dbAnswerEvidenceStore } from './evidence.js';

/**
 * Integration tests for the answer evidence store (US-020). Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${claimArguments}, ${claims}, ${notes}, ${sources}, ${graphOutbox}, ${auditEvents}, ${entities}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('answer evidence integration (US-020)', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'answers@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Answers KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it('enriches a cited claim with predicate, entities, confidence, and provenance (AC3)', async () => {
    const ada = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Ada Lovelace',
      actorUserId: userId,
    });
    const charles = await dbEntityStore.createEntity({
      knowledgeBaseId: kbId,
      type: 'Person',
      name: 'Charles Babbage',
      actorUserId: userId,
    });
    await dbClaimStore.createClaim({
      knowledgeBaseId: kbId,
      predicate: 'knows',
      confidence: 0.9,
      provenance: { origin: 'manual' },
      arguments: [
        { role: 'subject', argumentKind: 'entity', entityId: ada.id },
        { role: 'object', argumentKind: 'entity', entityId: charles.id },
      ],
      actorUserId: userId,
    });

    const citations = await dbAnswerEvidenceStore.gatherEvidence(kbId, 'knows', 10);
    const claimCitation = citations.find((c) => c.kind === 'claim');
    expect(claimCitation).toBeDefined();
    expect(claimCitation?.predicate).toBe('knows');
    expect(claimCitation?.confidence).toBe(0.9);
    expect(claimCitation?.provenance).toEqual({ origin: 'manual' });
    expect(claimCitation?.entities.map((e) => e.name).sort()).toEqual([
      'Ada Lovelace',
      'Charles Babbage',
    ]);
    // Each citation has a stable, 0-based ref index.
    citations.forEach((c, i) => expect(c.ref).toBe(i));
  });

  it('cites notes by title and snippet', async () => {
    await getDb().insert(notes).values({
      knowledgeBaseId: kbId,
      title: 'Meeting note',
      content: 'Ada discussed the analytical engine.',
      createdBy: userId,
    });

    const citations = await dbAnswerEvidenceStore.gatherEvidence(kbId, 'analytical', 10);
    const noteCitation = citations.find((c) => c.kind === 'note');
    expect(noteCitation?.title).toBe('Meeting note');
    expect(noteCitation?.predicate).toBeNull();
    expect(noteCitation?.entities).toEqual([]);
  });
});
