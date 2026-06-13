import { Router, type RequestHandler } from 'express';
import {
  claimSchema,
  createClaimSchema,
  kbRoleSatisfies,
  updateClaimSchema,
  type Claim,
  type KbRole,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbClaimStore, type ClaimStore, type ClaimWithArguments } from './store.js';

export type { ClaimStore } from './store.js';
export { dbClaimStore } from './store.js';

function toClaim(row: ClaimWithArguments): Claim {
  return claimSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    predicate: row.predicate,
    description: row.description,
    confidence: row.confidence,
    validStart: row.validStart ? row.validStart.toISOString() : null,
    validEnd: row.validEnd ? row.validEnd.toISOString() : null,
    properties: row.properties,
    schemaVersionId: row.schemaVersionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    arguments: row.arguments.map((arg) => ({
      id: arg.id,
      role: arg.role,
      position: arg.position,
      argumentKind: arg.argumentKind,
      entityId: arg.entityId,
      value: arg.value,
    })),
  });
}

export interface ClaimRouterOptions {
  store?: ClaimStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
}

/**
 * Build the `/api/knowledge-bases/:kbId/claims` router (US-009). Mounted with
 * `mergeParams: true` so the parent `:kbId` is visible. Reads require `viewer`,
 * mutations require `editor` (so viewers are read-only). Non-members get 404 to
 * hide existence (mirrors the entity/KB routers). Claim writes emit audit +
 * graph outbox events inside the store transaction.
 */
export function createClaimRouter(options: ClaimRouterOptions = {}): Router {
  const store = options.store ?? dbClaimStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const router = Router({ mergeParams: true });
  const authed = requireAuth(authStore);

  /** Require the caller to have at least `min` role on the `:kbId` Knowledge Base. */
  function requireKbRole(min: KbRole): RequestHandler {
    return asyncHandler(async (req, res, next) => {
      const ctx = req.auth as AuthContext;
      const kbId = req.params.kbId;
      if (!kbId) {
        res.status(404).json({ error: 'Knowledge Base not found' });
        return;
      }
      const role = await kbStore.getRole(kbId, ctx.user.id);
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

  // List claims in the Knowledge Base (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listClaims(req.params.kbId as string);
      res.json(list.map(toClaim));
    }),
  );

  // Create a claim (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid claim details' });
        return;
      }
      const claim = await store.createClaim({
        knowledgeBaseId: req.params.kbId as string,
        predicate: parsed.data.predicate,
        description: parsed.data.description,
        confidence: parsed.data.confidence,
        validStart: parsed.data.validStart,
        validEnd: parsed.data.validEnd,
        properties: parsed.data.properties,
        arguments: parsed.data.arguments.map((arg) => ({
          role: arg.role,
          argumentKind: arg.argumentKind,
          entityId: arg.entityId,
          value: arg.value,
        })),
        actorUserId: ctx.user.id,
      });
      res.status(201).json(toClaim(claim));
    }),
  );

  // Read a single claim (viewer+).
  router.get(
    '/:claimId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const claim = await store.getClaim(req.params.kbId as string, req.params.claimId as string);
      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      res.json(toClaim(claim));
    }),
  );

  // Edit a claim (editor+).
  router.patch(
    '/:claimId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid claim details' });
        return;
      }
      const claim = await store.updateClaim({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.claimId as string,
        actorUserId: ctx.user.id,
        fields: {
          ...parsed.data,
          arguments: parsed.data.arguments?.map((arg) => ({
            role: arg.role,
            argumentKind: arg.argumentKind,
            entityId: arg.entityId,
            value: arg.value,
          })),
        },
      });
      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      res.json(toClaim(claim));
    }),
  );

  // Soft-delete a claim (editor+). Viewers are read-only (US-010 AC1/AC7).
  router.delete(
    '/:claimId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const claim = await store.deleteClaim({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.claimId as string,
        actorUserId: ctx.user.id,
      });
      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
