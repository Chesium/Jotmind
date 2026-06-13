import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  claims,
  graphOutbox,
  knowledgeBases,
  notes,
  sourceExcerpts,
  sources,
  users,
} from '../db/schema.js';
import { dbNoteStore } from './store.js';
import { dbSourceStore } from '../sources/store.js';
import { dbSourceExcerptStore } from '../source-excerpts/store.js';

/**
 * Integration tests for Note/Source/Source-Excerpt capture (US-011). Skipped
 * when DATABASE_URL is unset so default `pnpm test:api` stays green. Run with:
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${sourceExcerpts}, ${graphOutbox}, ${auditEvents}, ${claims}, ${notes}, ${sources}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('capture (notes/sources/excerpts) integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'capture@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Capture KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('creates a note with audit + outbox events in one transaction', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      title: 'Idea',
      content: 'Freeform captured text.',
      actorUserId: userId,
    });
    expect(note.id).toBeTruthy();

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(eq(graphOutbox.targetId, note.id));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe('note.created');

    const audit = await getDb().select().from(auditEvents).where(eq(auditEvents.targetId, note.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('note.created');
  });

  it('creates a source with structured metadata', async () => {
    const source = await dbSourceStore.createSource({
      knowledgeBaseId: kbId,
      title: 'A Book',
      sourceType: 'book',
      uri: 'isbn:123',
      metadata: { authors: ['Author'] },
      actorUserId: userId,
    });
    expect(source.title).toBe('A Book');
    expect(source.metadata).toEqual({ authors: ['Author'] });

    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(eq(graphOutbox.targetId, source.id));
    expect(outbox[0]!.eventType).toBe('source.created');
  });

  it('cites a span in a note and links a claim, surfacing it in views', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'The quick brown fox.',
      actorUserId: userId,
    });
    const [claim] = await getDb()
      .insert(claims)
      .values({ knowledgeBaseId: kbId, predicate: 'mentions', createdBy: userId })
      .returning();

    const created = await dbSourceExcerptStore.createSourceExcerpt({
      knowledgeBaseId: kbId,
      noteId: note.id,
      claimId: claim!.id,
      spanStart: 4,
      spanEnd: 9,
      excerpt: 'quick',
      actorUserId: userId,
    });
    expect(created.ok).toBe(true);

    const list = await dbSourceExcerptStore.listSourceExcerpts(kbId, { noteId: note.id });
    expect(list).toHaveLength(1);
    expect(list[0]!.claim).toEqual({ id: claim!.id, predicate: 'mentions' });

    // No graph_outbox event for excerpts (not a projection target), audit only.
    const outbox = await getDb()
      .select()
      .from(graphOutbox)
      .where(eq(graphOutbox.targetId, list[0]!.id));
    expect(outbox).toHaveLength(0);
    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, list[0]!.id));
    expect(audit[0]!.action).toBe('source_excerpt.created');
  });

  it('rejects an excerpt whose origin note is in another (missing) KB', async () => {
    const result = await dbSourceExcerptStore.createSourceExcerpt({
      knowledgeBaseId: kbId,
      noteId: '00000000-0000-0000-0000-000000000000',
      excerpt: 'x',
      actorUserId: userId,
    });
    expect(result).toEqual({ ok: false, reason: 'note_not_found' });
  });

  it('soft-deletes a note and hides it from reads', async () => {
    const note = await dbNoteStore.createNote({
      knowledgeBaseId: kbId,
      content: 'temp',
      actorUserId: userId,
    });
    await dbNoteStore.deleteNote({ knowledgeBaseId: kbId, id: note.id, actorUserId: userId });
    const after = await dbNoteStore.getNote(kbId, note.id);
    expect(after).toBeUndefined();
  });
});
