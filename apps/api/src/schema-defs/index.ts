import { Router, type RequestHandler } from 'express';
import {
  createSchemaDefinitionSchema,
  kbRoleSatisfies,
  predicateSpecSchema,
  schemaDefinitionSchema,
  updateSchemaDefinitionSchema,
  validateEntityProperties,
  validatePredicateArguments,
  type ClaimArgumentForValidation,
  type KbRole,
  type PropertySchema,
  type SchemaDefinition,
  type SchemaRecordWarning,
  type SchemaValidationIssue,
  type SchemaValidationReport,
} from '@jotmind/schemas';
import { asyncHandler, requireAuth, requireCsrf, type AuthContext } from '../auth/index.js';
import { dbAuthStore, type AuthStore } from '../auth/store.js';
import { dbKnowledgeBaseStore, type KnowledgeBaseStore } from '../kb/store.js';
import { dbEntityStore, type EntityStore } from '../entities/store.js';
import { dbClaimStore, type ClaimStore } from '../claims/store.js';
import type { SchemaVersionRow } from '../db/schema.js';
import { dbSchemaStore, type SchemaDefinitionWithVersion, type SchemaStore } from './store.js';

export type { SchemaStore } from './store.js';
export { dbSchemaStore } from './store.js';

function toSchemaVersion(row: SchemaVersionRow) {
  return {
    id: row.id,
    schemaDefinitionId: row.schemaDefinitionId,
    knowledgeBaseId: row.knowledgeBaseId,
    version: row.version,
    propertySchema: row.propertySchema as PropertySchema,
    spec: row.spec as Record<string, unknown>,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSchemaDefinition(row: SchemaDefinitionWithVersion): SchemaDefinition {
  return schemaDefinitionSchema.parse({
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    kind: row.kind,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    activeVersion: row.activeVersion ? toSchemaVersion(row.activeVersion) : null,
  });
}

/** A claim argument as supplied by the claim router (US-009 shape). */
export interface ClaimArgForSchema {
  role: string;
  argumentKind: 'entity' | 'literal';
  entityId?: string | undefined;
}

export type SchemaCheckResult =
  | { ok: true; schemaVersionId: string | undefined }
  | { ok: false; issues: SchemaValidationIssue[] };

/**
 * Validate an entity's properties against the active entity-type schema and
 * resolve the `schemaVersionId` to stamp on the record (US-027 AC3/AC5). When no
 * custom schema constrains the type, the entity is unconstrained
 * (`schemaVersionId: undefined`).
 */
export async function checkEntityAgainstSchema(
  schemaStore: SchemaStore,
  knowledgeBaseId: string,
  type: string,
  properties: Record<string, unknown>,
): Promise<SchemaCheckResult> {
  const version = await schemaStore.getActiveVersionByName(knowledgeBaseId, 'entity_type', type);
  if (!version) return { ok: true, schemaVersionId: undefined };
  const result = validateEntityProperties(
    (version.propertySchema as PropertySchema) ?? {},
    properties,
  );
  if (!result.valid) return { ok: false, issues: result.issues };
  return { ok: true, schemaVersionId: version.id };
}

/**
 * Validate a claim's arguments against the active claim-predicate schema and
 * resolve the `schemaVersionId` to stamp (US-027 AC2/AC3/AC5). `getEntityType`
 * resolves the conceptual type of an entity argument so compatible-entity-type
 * rules can be enforced. Unconstrained when no custom schema exists.
 */
export async function checkClaimAgainstSchema(
  schemaStore: SchemaStore,
  knowledgeBaseId: string,
  predicate: string,
  args: ClaimArgForSchema[],
  getEntityType: (entityId: string) => Promise<string | null>,
): Promise<SchemaCheckResult> {
  const version = await schemaStore.getActiveVersionByName(
    knowledgeBaseId,
    'claim_predicate',
    predicate,
  );
  if (!version) return { ok: true, schemaVersionId: undefined };
  const spec = predicateSpecSchema.parse((version.spec as Record<string, unknown>) ?? {});
  const forValidation: ClaimArgumentForValidation[] = [];
  for (const arg of args) {
    let entityType: string | null = null;
    if (arg.argumentKind === 'entity' && arg.entityId) {
      entityType = await getEntityType(arg.entityId);
    }
    forValidation.push({ role: arg.role, argumentKind: arg.argumentKind, entityType });
  }
  const result = validatePredicateArguments(spec, forValidation);
  if (!result.valid) return { ok: false, issues: result.issues };
  return { ok: true, schemaVersionId: version.id };
}

export interface SchemaRouterOptions {
  store?: SchemaStore;
  kbStore?: KnowledgeBaseStore;
  authStore?: AuthStore;
  /** Used by the validation report (US-028 AC6) to scan existing records. */
  entityStore?: EntityStore;
  claimStore?: ClaimStore;
}

/**
 * Build the validation report for a schema definition (US-028 AC6): scan
 * existing records of the conceptual type against the ACTIVE version and report
 * those that don't validate, plus how many reference an older schema version.
 * Properties/roles absent from older versions are treated as `null`/missing by
 * the validators rather than throwing (AC5).
 */
async function buildValidationReport(
  def: SchemaDefinitionWithVersion,
  entityStore: EntityStore,
  claimStore: ClaimStore,
): Promise<SchemaValidationReport> {
  const activeVersionId = def.activeVersion?.id ?? null;
  const warnings: SchemaRecordWarning[] = [];
  let totalRecords = 0;
  let onOldVersionRecords = 0;

  if (def.kind === 'entity_type') {
    const propertySchema = (def.activeVersion?.propertySchema as PropertySchema) ?? {};
    const entities = (await entityStore.listEntities(def.knowledgeBaseId)).filter(
      (e) => e.type === def.name,
    );
    for (const e of entities) {
      totalRecords += 1;
      const onActiveVersion = e.schemaVersionId === activeVersionId;
      if (!onActiveVersion && e.schemaVersionId !== null) onOldVersionRecords += 1;
      const result = validateEntityProperties(
        propertySchema,
        (e.properties as Record<string, unknown>) ?? {},
      );
      if (!result.valid) {
        warnings.push({
          recordId: e.id,
          label: e.name,
          schemaVersionId: e.schemaVersionId,
          onActiveVersion,
          issues: result.issues,
        });
      }
    }
  } else {
    const spec = predicateSpecSchema.parse(
      (def.activeVersion?.spec as Record<string, unknown>) ?? {},
    );
    const entityTypeById = new Map<string, string | null>();
    const resolveType = async (entityId: string): Promise<string | null> => {
      if (entityTypeById.has(entityId)) return entityTypeById.get(entityId) ?? null;
      const entity = await entityStore.getEntity(def.knowledgeBaseId, entityId);
      const type = entity?.type ?? null;
      entityTypeById.set(entityId, type);
      return type;
    };
    const claims = (await claimStore.listClaims(def.knowledgeBaseId)).filter(
      (c) => c.predicate === def.name,
    );
    for (const c of claims) {
      totalRecords += 1;
      const onActiveVersion = c.schemaVersionId === activeVersionId;
      if (!onActiveVersion && c.schemaVersionId !== null) onOldVersionRecords += 1;
      const forValidation: ClaimArgumentForValidation[] = [];
      for (const arg of c.arguments) {
        let entityType: string | null = null;
        if (arg.argumentKind === 'entity' && arg.entityId) {
          entityType = await resolveType(arg.entityId);
        }
        forValidation.push({
          role: arg.role,
          argumentKind: arg.argumentKind as 'entity' | 'literal',
          entityType,
        });
      }
      const result = validatePredicateArguments(spec, forValidation);
      if (!result.valid) {
        warnings.push({
          recordId: c.id,
          label: c.predicate,
          schemaVersionId: c.schemaVersionId,
          onActiveVersion,
          issues: result.issues,
        });
      }
    }
  }

  return {
    definitionId: def.id,
    kind: def.kind as SchemaValidationReport['kind'],
    name: def.name,
    activeVersionId,
    totalRecords,
    invalidRecords: warnings.length,
    onOldVersionRecords,
    warnings,
  };
}

/**
 * Build the `/api/knowledge-bases/:kbId/schema` router (US-027). Mounted with
 * `mergeParams: true` AFTER the KB router. Reads require `viewer`, mutations
 * require `editor` (viewers are read-only). Non-members get 404 to hide
 * existence. Schema writes record audit events inside the store transaction.
 */
export function createSchemaRouter(options: SchemaRouterOptions = {}): Router {
  const store = options.store ?? dbSchemaStore;
  const kbStore = options.kbStore ?? dbKnowledgeBaseStore;
  const authStore = options.authStore ?? dbAuthStore;
  const entityStore = options.entityStore ?? dbEntityStore;
  const claimStore = options.claimStore ?? dbClaimStore;
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

  // List schema definitions (viewer+).
  router.get(
    '/',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const list = await store.listDefinitions(req.params.kbId as string);
      res.json(list.map(toSchemaDefinition));
    }),
  );

  // Portable JSON export of the KB's custom schemas (viewer+, US-027 AC4).
  router.get(
    '/export',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const kbId = req.params.kbId as string;
      const list = await store.listDefinitions(kbId);
      res.json({
        knowledgeBaseId: kbId,
        exportedAt: new Date().toISOString(),
        schemaDefinitions: list.map(toSchemaDefinition),
      });
    }),
  );

  // Create a schema definition + its initial active version (editor+).
  router.post(
    '/',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = createSchemaDefinitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid schema definition' });
        return;
      }
      const result = await store.createDefinition({
        knowledgeBaseId: req.params.kbId as string,
        kind: parsed.data.kind,
        name: parsed.data.name,
        displayName: parsed.data.displayName,
        description: parsed.data.description,
        propertySchema: parsed.data.propertySchema,
        spec: parsed.data.spec,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        res.status(409).json({ error: 'A schema with that name already exists' });
        return;
      }
      res.status(201).json(toSchemaDefinition(result.definition));
    }),
  );

  // Read a single schema definition (viewer+).
  router.get(
    '/:defId',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const def = await store.getDefinition(req.params.kbId as string, req.params.defId as string);
      if (!def) {
        res.status(404).json({ error: 'Schema definition not found' });
        return;
      }
      res.json(toSchemaDefinition(def));
    }),
  );

  // Validation report over existing records (viewer+, US-028 AC6).
  router.get(
    '/:defId/validation',
    authed,
    requireKbRole('viewer'),
    asyncHandler(async (req, res) => {
      const def = await store.getDefinition(req.params.kbId as string, req.params.defId as string);
      if (!def) {
        res.status(404).json({ error: 'Schema definition not found' });
        return;
      }
      res.json(await buildValidationReport(def, entityStore, claimStore));
    }),
  );

  // Update a schema definition (editor+, US-028). Compatible changes update the
  // active version in place; breaking changes create + activate a new version.
  router.put(
    '/:defId',
    authed,
    requireKbRole('editor'),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      const parsed = updateSchemaDefinitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid schema update' });
        return;
      }
      const result = await store.updateDefinition({
        knowledgeBaseId: req.params.kbId as string,
        id: req.params.defId as string,
        displayName: parsed.data.displayName,
        description: parsed.data.description,
        propertySchema: parsed.data.propertySchema,
        spec: parsed.data.spec,
        actorUserId: ctx.user.id,
      });
      if (!result.ok) {
        res.status(404).json({ error: 'Schema definition not found' });
        return;
      }
      res.json({
        changeType: result.classification.changeType,
        reasons: result.classification.reasons,
        definition: toSchemaDefinition(result.definition),
      });
    }),
  );

  return router;
}
