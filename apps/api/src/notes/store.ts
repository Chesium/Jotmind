import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { auditEvents, notes, type NewNoteRow, type NoteRow } from '../db/schema.js';
import { enqueueGraphOutbox } from '../graph/outbox.js';

export interface CreateNoteInput {
  knowledgeBaseId: string;
  title?: string;
  content: string;
  properties?: Record<string, unknown>;
  actorUserId: string;
}

/** Mutable note fields an editor may change. */
export interface UpdateNoteFields {
  title?: string | null;
  content?: string;
  properties?: Record<string, unknown>;
}

export interface UpdateNoteInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
  fields: UpdateNoteFields;
}

export interface DeleteNoteInput {
  knowledgeBaseId: string;
  id: string;
  actorUserId: string;
}

/**
 * Persistence boundary for notes (US-011). Defined as an interface so route
 * handlers can run against an in-memory fake in unit tests (no live DB) while
 * production uses the PostgreSQL-backed impl.
 *
 * Notes are canonical graph records: writes append a `graph_outbox` projection
 * event (US-006) AND an `audit_events` row in the SAME transaction — mirroring
 * the entity/claim stores. Reads filter `deleted_at IS NULL` (soft-delete).
 */
export interface NoteStore {
  listNotes(knowledgeBaseId: string): Promise<NoteRow[]>;
  getNote(knowledgeBaseId: string, id: string): Promise<NoteRow | undefined>;
  createNote(input: CreateNoteInput): Promise<NoteRow>;
  updateNote(input: UpdateNoteInput): Promise<NoteRow | undefined>;
  /** Soft-delete a note (US-011). Returns undefined if it does not exist. */
  deleteNote(input: DeleteNoteInput): Promise<NoteRow | undefined>;
}

/** PostgreSQL-backed NoteStore. Resolves the Drizzle client per call. */
export const dbNoteStore: NoteStore = {
  async listNotes(knowledgeBaseId) {
    return getDb()
      .select()
      .from(notes)
      .where(and(eq(notes.knowledgeBaseId, knowledgeBaseId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.createdAt));
  },

  async getNote(knowledgeBaseId, id) {
    const rows = await getDb()
      .select()
      .from(notes)
      .where(
        and(eq(notes.id, id), eq(notes.knowledgeBaseId, knowledgeBaseId), isNull(notes.deletedAt)),
      )
      .limit(1);
    return rows[0];
  },

  async createNote(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(notes)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          title: input.title ?? null,
          content: input.content,
          properties: input.properties ?? {},
          createdBy: input.actorUserId,
        })
        .returning();
      const note = rows[0];
      if (!note) throw new Error('Failed to create note');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: note.knowledgeBaseId,
        eventType: 'created',
        targetType: 'note',
        targetId: note.id,
        payload: { title: note.title },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: note.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'note.created',
        targetType: 'note',
        targetId: note.id,
        metadata: { title: note.title },
      });

      return note;
    });
  },

  async updateNote(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.id, input.id),
            eq(notes.knowledgeBaseId, input.knowledgeBaseId),
            isNull(notes.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const set: Partial<NewNoteRow> = { updatedAt: new Date() };
      const { fields } = input;
      if (fields.title !== undefined) set.title = fields.title;
      if (fields.content !== undefined) set.content = fields.content;
      if (fields.properties !== undefined) set.properties = fields.properties;

      const rows = await tx
        .update(notes)
        .set(set)
        .where(and(eq(notes.id, input.id), eq(notes.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const note = rows[0];
      if (!note) throw new Error('Failed to update note');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: note.knowledgeBaseId,
        eventType: 'updated',
        targetType: 'note',
        targetId: note.id,
        payload: { title: note.title },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: note.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'note.updated',
        targetType: 'note',
        targetId: note.id,
        metadata: { changed: Object.keys(fields) },
      });

      return note;
    });
  },

  async deleteNote(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.id, input.id),
            eq(notes.knowledgeBaseId, input.knowledgeBaseId),
            isNull(notes.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(notes)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(notes.id, input.id), eq(notes.knowledgeBaseId, input.knowledgeBaseId)))
        .returning();
      const note = rows[0];
      if (!note) throw new Error('Failed to delete note');

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: note.knowledgeBaseId,
        eventType: 'deleted',
        targetType: 'note',
        targetId: note.id,
        payload: { title: note.title },
      });

      await tx.insert(auditEvents).values({
        knowledgeBaseId: note.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'note.deleted',
        targetType: 'note',
        targetId: note.id,
        metadata: { title: note.title },
      });

      return note;
    });
  },
};
