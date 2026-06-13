import { Router, type RequestHandler } from 'express';
import {
  assignKbRoleSchema,
  auditEventSchema,
  createKnowledgeBaseSchema,
  kbMemberSchema,
  kbRoleSatisfies,
  knowledgeBaseSchema,
  type KbRole,
  type KnowledgeBase,
} from '@jotmind/schemas';
import type { AuditEventRow } from '../db/schema.js';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import {
  dbKnowledgeBaseStore,
  type KbMemberRecord,
  type KnowledgeBaseStore,
  type KnowledgeBaseWithRole,
} from './store.js';

export type { KnowledgeBaseStore } from './store.js';
export { dbKnowledgeBaseStore } from './store.js';

// Extend the request with the resolved Knowledge Base role for the route param.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      kbRole?: KbRole;
    }
  }
}

function toKnowledgeBase(row: KnowledgeBaseWithRole): KnowledgeBase {
  return knowledgeBaseSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    createdBy: row.createdBy,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toMember(record: KbMemberRecord) {
  return kbMemberSchema.parse({
    userId: record.userId,
    email: record.email,
    role: record.role,
    createdAt: record.createdAt.toISOString(),
  });
}

function toAuditEvent(row: AuditEventRow) {
  return auditEventSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  });
}

export interface KnowledgeBaseRouterOptions {
  store?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases` router. Every route requires authentication.
 * Knowledge-Base-scoped routes additionally enforce a minimum role via
 * `requireKbRole`, which loads the caller's membership for the `:id` param.
 */
export function createKnowledgeBaseRouter(options: KnowledgeBaseRouterOptions = {}): Router {
  const store = options.store ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router();
  const authed = requireAuth(authStore);

  /** Require the caller to have at least `min` role on the `:id` Knowledge Base. */
  function requireKbRole(min: KbRole): RequestHandler {
    return asyncHandler(async (req, res, next) => {
      const ctx = req.auth as AuthContext;
      const id = req.params.id;
      if (!id) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      const role = await store.getRole(id, ctx.user.id);
      // Hide existence from non-members: 404 rather than 403.
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

  // List Knowledge Bases the caller is a member of.
  router.get(
    '/',
    authed,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const list = await store.listForUser(ctx.user.id);
      res.json(list.map(toKnowledgeBase));
    }),
  );

  // Create a Knowledge Base; the creator becomes its owner.
  router.post(
    '/',
    authed,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createKnowledgeBaseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid Knowledge Base details' });
        return;
      }
      const kb = await store.createKnowledgeBase({
        name: parsed.data.name,
        description: parsed.data.description,
        createdBy: ctx.user.id,
      });
      res.status(201).json(toKnowledgeBase(kb));
    }),
  );

  // Read a single Knowledge Base (any member role).
  router.get(
    '/:id',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const kb = await store.getForUser(req.params.id as string, ctx.user.id);
      if (!kb) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      res.json(toKnowledgeBase(kb));
    }),
  );

  // List members (admin/owner only).
  router.get(
    '/:id/members',
    authed,
    requireKbRole('admin'),
    asyncHandler(async (req, res) => {
      const members = await store.listMembers(req.params.id as string);
      res.json(members.map(toMember));
    }),
  );

  // Assign or change a member's role (admin/owner only).
  router.post(
    '/:id/members',
    authed,
    requireKbRole('admin'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = assignKbRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid role assignment' });
        return;
      }
      if (!(await store.userExists(parsed.data.userId))) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const member = await store.assignRole({
        knowledgeBaseId: req.params.id as string,
        userId: parsed.data.userId,
        role: parsed.data.role,
        actorUserId: ctx.user.id,
      });
      res.status(201).json(toMember(member));
    }),
  );

  // Knowledge Base audit summary (admin/owner only).
  router.get(
    '/:id/audit',
    authed,
    requireKbRole('admin'),
    asyncHandler(async (req, res) => {
      const events = await store.listAuditEvents(req.params.id as string);
      res.json(events.map(toAuditEvent));
    }),
  );

  return router;
}
