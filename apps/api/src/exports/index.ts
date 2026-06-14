import { Router, type RequestHandler } from 'express';
import { kbRoleSatisfies, portableKnowledgeBaseExportSchema, type KbRole } from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbEntityStore, type EntityStore } from '../entities/store.js';
import { dbClaimStore, type ClaimStore } from '../claims/store.js';
import { dbNoteStore, type NoteStore } from '../notes/store.js';
import { dbSourceStore, type SourceStore } from '../sources/store.js';
import { dbSourceExcerptStore, type SourceExcerptStore } from '../source-excerpts/store.js';
import { dbSchemaStore, type SchemaStore } from '../schema-defs/store.js';
import { dbRuleStore, type RuleStore } from '../rules/store.js';
import {
  buildPortableExport,
  importPortableKnowledgeBase,
  PortableImportError,
  type ExportStores,
} from './service.js';
import { renderEntitiesCsv, renderMarkdownExport } from './render.js';

export interface ExportRouterOptions {
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  entityStore?: EntityStore;
  claimStore?: ClaimStore;
  noteStore?: NoteStore;
  sourceStore?: SourceStore;
  sourceExcerptStore?: SourceExcerptStore;
  schemaStore?: SchemaStore;
  ruleStore?: RuleStore;
}

function resolveStores(options: ExportRouterOptions): ExportStores {
  return {
    kbStore: options.kbStore ?? dbKnowledgeBaseStore,
    entityStore: options.entityStore ?? dbEntityStore,
    claimStore: options.claimStore ?? dbClaimStore,
    noteStore: options.noteStore ?? dbNoteStore,
    sourceStore: options.sourceStore ?? dbSourceStore,
    sourceExcerptStore: options.sourceExcerptStore ?? dbSourceExcerptStore,
    schemaStore: options.schemaStore ?? dbSchemaStore,
    ruleStore: options.ruleStore ?? dbRuleStore,
  };
}

/**
 * Build the `/api/knowledge-bases/:kbId/export` router (US-032). Exports require
 * an admin/owner KB role (backup is an admin operation). Mounted with
 * `mergeParams: true` AFTER the KB router. Non-members get 404 to hide existence.
 */
export function createKbExportRouter(options: ExportRouterOptions = {}): Router {
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const stores = resolveStores(options);
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
      next();
    });
  }

  async function loadExport(kbId: string, userId: string) {
    const kb = await kbStore.getForUser(kbId, userId);
    if (!kb) return null;
    return buildPortableExport(stores, {
      id: kb.id,
      name: kb.name,
      description: kb.description,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    });
  }

  // Full-fidelity portable JSON export (AC1/AC2/AC5).
  router.get(
    '/json',
    authed,
    requireKbRole('admin'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const exported = await loadExport(kbId, ctx.user.id);
      if (!exported) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      res.setHeader('Content-Disposition', `attachment; filename="kb-${kbId}.json"`);
      res.json(exported);
    }),
  );

  // Human-readable Markdown export (AC3).
  router.get(
    '/markdown',
    authed,
    requireKbRole('admin'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const exported = await loadExport(kbId, ctx.user.id);
      if (!exported) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="kb-${kbId}.md"`);
      res.send(renderMarkdownExport(exported));
    }),
  );

  // Structured subset CSV export (AC4).
  router.get(
    '/csv',
    authed,
    requireKbRole('admin'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId as string;
      const exported = await loadExport(kbId, ctx.user.id);
      if (!exported) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="kb-${kbId}-entities.csv"`);
      res.send(renderEntitiesCsv(exported));
    }),
  );

  return router;
}

/**
 * Build the portable-import router (US-032 AC1). Mounted at
 * `/api/knowledge-bases/import-portable` AFTER the KB router (the KB router has
 * no matching POST route, so it falls through). Any authenticated user may
 * import a portable export; it always creates a NEW Knowledge Base they own.
 */
export function createPortableImportRouter(options: ExportRouterOptions = {}): Router {
  const authStore = options.authStore ?? dbAuthStore;
  const stores = resolveStores(options);
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);

  router.post(
    '/',
    authed,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = portableKnowledgeBaseExportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid portable export document' });
        return;
      }
      try {
        const result = await importPortableKnowledgeBase(stores, ctx.user.id, parsed.data);
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof PortableImportError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}
