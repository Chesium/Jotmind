import { Router, type RequestHandler } from 'express';
import {
  createNoteSchema,
  kbRoleSatisfies,
  noteSchema,
  updateNoteSchema,
  type KbRole,
  type Note,
} from '@jotmind/schemas';
import type { NoteRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbNoteStore, type NoteStore } from './store.js';

export type { NoteStore } from './store.js';
export { dbNoteStore } from './store.js';

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

export interface NoteRouterOptions {
  store?: NoteStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/notes` router (US-011). Mounted with
 * `mergeParams: true` so the parent `:kbId` is visible. Reads require `viewer`,
 * mutations require `editor` (so viewers are read-only). Non-members get 404 to
 * hide existence (mirrors the entity/claim routers). No AI provider is required
 * to capture a note.
 */
export function createNoteRouter(options: NoteRouterOptions = {}): Router {
  const store = options.store ?? dbNoteStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);

  function requireKbRole(min: KbRole): RequestHandler {
    return asyncHandler(async (req, res, next) => {
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

  // List notes in the Knowledge Base (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listNotes(req.params.kbId as string);
      res.json(list.map(toNote));
    }),
  );

  // Create a note (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid note details' });
        return;
      }
      const note = await store.createNote({
        knowledgeBaseId: req.params.kbId as string,
        title: parsed.data.title,
        content: parsed.data.content,
        properties: parsed.data.properties,
        actorUserId: ctx.user.id,
      });
      res.status(201).json(toNote(note));
    }),
  );

  // Read a single note (viewer+).
  router.get(
    '/:noteId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const note = await store.getNote(req.params.kbId as string, req.params.noteId as string);
      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json(toNote(note));
    }),
  );

  // Edit a note (editor+).
  router.patch(
    '/:noteId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid note details' });
        return;
      }
      const note = await store.updateNote({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.noteId as string,
        actorUserId: ctx.user.id,
        fields: parsed.data,
      });
      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json(toNote(note));
    }),
  );

  // Soft-delete a note (editor+). Viewers are read-only.
  router.delete(
    '/:noteId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const note = await store.deleteNote({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.noteId as string,
        actorUserId: ctx.user.id,
      });
      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
