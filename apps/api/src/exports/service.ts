import {
  JSON_EXPORT_LABEL,
  CSV_EXPORT_LABEL,
  MARKDOWN_EXPORT_LABEL,
  PORTABLE_EXPORT_FORMAT,
  PORTABLE_EXPORT_FORMAT_VERSION,
  PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS,
  findBuiltinRulePack,
  portableKnowledgeBaseExportSchema,
  predicateSpecSchema,
  type PortableClaim,
  type PortableImportResult,
  type PortableKnowledgeBaseExport,
  type PortableRule,
  type PortableSchemaDefinition,
  type PortableSchemaVersion,
} from '@jotmind/schemas';
import type {
  AuditEventRow,
  ClaimArgumentRow,
  EntityRow,
  NoteRow,
  SchemaVersionRow,
  SourceRow,
} from '../db/schema.js';
import type { KnowledgeBaseStore } from '../kb/store.js';
import type { EntityStore } from '../entities/store.js';
import type { ClaimStore, ClaimWithArguments } from '../claims/store.js';
import type { NoteStore } from '../notes/store.js';
import type { SourceStore } from '../sources/store.js';
import type { SourceExcerptStore, SourceExcerptWithClaim } from '../source-excerpts/store.js';
import type { SchemaStore } from '../schema-defs/store.js';
import { readAuthoredCap, readBuiltinMeta } from '../rules/store.js';
import type { RuleStore } from '../rules/store.js';

/** Stores needed to build a portable export of a Knowledge Base. */
export interface ExportStores {
  kbStore: KnowledgeBaseStore;
  entityStore: EntityStore;
  claimStore: ClaimStore;
  noteStore: NoteStore;
  sourceStore: SourceStore;
  sourceExcerptStore: SourceExcerptStore;
  schemaStore: SchemaStore;
  ruleStore: RuleStore;
}

const iso = (d: Date): string => d.toISOString();

/**
 * Deep-strip provider secret fields (e.g. `apiKey`, US-032 AC5) from a JSONB
 * value. Portable graph data never carries provider secrets, but we sanitize
 * defensively so a leaked key stashed in provenance/properties cannot escape.
 */
export function sanitizeJsonb<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonb(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS as readonly string[]).includes(k)) continue;
      out[k] = sanitizeJsonb(v);
    }
    return out as unknown as T;
  }
  return value;
}

function toRecord(v: unknown): Record<string, unknown> {
  return sanitizeJsonb((v as Record<string, unknown>) ?? {});
}

function entityToPortable(row: EntityRow) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    type: row.type,
    name: row.name,
    aliases: (row.aliases as string[]) ?? [],
    description: row.description,
    tags: (row.tags as string[]) ?? [],
    properties: toRecord(row.properties),
    schemaVersionId: row.schemaVersionId,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function argToPortable(arg: ClaimArgumentRow) {
  return {
    id: arg.id,
    role: arg.role,
    position: arg.position,
    argumentKind: arg.argumentKind as 'entity' | 'literal',
    entityId: arg.entityId,
    value: arg.value,
  };
}

function claimToPortable(claim: ClaimWithArguments): PortableClaim {
  return {
    id: claim.id,
    knowledgeBaseId: claim.knowledgeBaseId,
    predicate: claim.predicate,
    description: claim.description,
    confidence: claim.confidence,
    validStart: claim.validStart ? iso(claim.validStart) : null,
    validEnd: claim.validEnd ? iso(claim.validEnd) : null,
    properties: toRecord(claim.properties),
    provenance: toRecord(claim.provenance),
    schemaVersionId: claim.schemaVersionId,
    createdBy: claim.createdBy,
    createdAt: iso(claim.createdAt),
    updatedAt: iso(claim.updatedAt),
    arguments: [...claim.arguments].sort((a, b) => a.position - b.position).map(argToPortable),
  };
}

function noteToPortable(row: NoteRow) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    content: row.content,
    properties: toRecord(row.properties),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function sourceToPortable(row: SourceRow) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    sourceType: row.sourceType,
    uri: row.uri,
    content: row.content,
    metadata: toRecord(row.metadata),
    properties: toRecord(row.properties),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function citationToPortable(row: SourceExcerptWithClaim) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    sourceId: row.sourceId,
    noteId: row.noteId,
    claimId: row.claimId,
    excerpt: row.excerpt,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
    metadata: toRecord(row.metadata),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    claim: row.claim,
  };
}

function versionToPortable(row: SchemaVersionRow): PortableSchemaVersion {
  return {
    id: row.id,
    schemaDefinitionId: row.schemaDefinitionId,
    knowledgeBaseId: row.knowledgeBaseId,
    version: row.version,
    propertySchema: (row.propertySchema as PortableSchemaVersion['propertySchema']) ?? {},
    spec: (row.spec as Record<string, unknown>) ?? {},
    isActive: row.isActive,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function auditToPortable(row: AuditEventRow) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: toRecord(row.metadata),
    createdAt: iso(row.createdAt),
  };
}

/**
 * Build the full-fidelity portable export of a Knowledge Base (US-032 AC1/AC2).
 * Reads all canonical graph content through the injected stores. Secret fields
 * (e.g. API keys) are stripped from every JSONB column (AC5).
 */
export async function buildPortableExport(
  stores: ExportStores,
  kb: { id: string; name: string; description: string | null; createdAt: Date; updatedAt: Date },
): Promise<PortableKnowledgeBaseExport> {
  const kbId = kb.id;
  const [entities, claims, notes, sources, citations, schemaDefs, rules, audit] = await Promise.all(
    [
      stores.entityStore.listEntities(kbId),
      stores.claimStore.listClaims(kbId),
      stores.noteStore.listNotes(kbId),
      stores.sourceStore.listSources(kbId),
      stores.sourceExcerptStore.listSourceExcerpts(kbId),
      stores.schemaStore.listDefinitionsWithVersions(kbId),
      stores.ruleStore.listRules(kbId),
      stores.kbStore.listAuditEvents(kbId),
    ],
  );

  const schemas: PortableSchemaDefinition[] = schemaDefs.map((def) => ({
    id: def.id,
    knowledgeBaseId: def.knowledgeBaseId,
    kind: def.kind as PortableSchemaDefinition['kind'],
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    createdBy: def.createdBy,
    createdAt: iso(def.createdAt),
    updatedAt: iso(def.updatedAt),
    activeVersionId: def.activeVersion?.id ?? null,
    versions: def.versions.map(versionToPortable),
  }));

  const portableRules: PortableRule[] = rules.map((row) => {
    const meta = readBuiltinMeta(row.compiled);
    const cap = readAuthoredCap(row.compiled);
    return {
      id: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      name: row.name,
      description: row.description,
      ruleText: row.ruleText,
      status: row.status as PortableRule['status'],
      version: row.version,
      moduleId: meta?.moduleId ?? null,
      packId: meta?.packId ?? null,
      recursionCap: cap ?? meta?.packVersion ?? 16,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  });

  const exported: PortableKnowledgeBaseExport = {
    format: PORTABLE_EXPORT_FORMAT,
    formatVersion: PORTABLE_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    fidelity: 'portable-graph',
    labels: {
      json: JSON_EXPORT_LABEL,
      markdown: MARKDOWN_EXPORT_LABEL,
      csv: CSV_EXPORT_LABEL,
    },
    secretPolicy: {
      excludesProviderSecrets: true,
      excludedSecretFields: [...PORTABLE_EXPORT_EXCLUDED_SECRET_FIELDS],
    },
    knowledgeBase: {
      id: kb.id,
      name: kb.name,
      description: kb.description,
      createdAt: iso(kb.createdAt),
      updatedAt: iso(kb.updatedAt),
    },
    data: {
      schemas,
      entities: entities.map(entityToPortable),
      claims: claims.map(claimToPortable),
      notes: notes.map(noteToPortable),
      sources: sources.map(sourceToPortable),
      citations: (citations as SourceExcerptWithClaim[]).map(citationToPortable),
      rules: portableRules,
    },
    audit: {
      note: 'Audit metadata is exported for reference only. Import generates its own audit events for the new Knowledge Base; it does not replay these rows.',
      events: audit.map(auditToPortable),
    },
  };

  // Validate the document against the shared schema before returning so callers
  // always get a well-formed export.
  return portableKnowledgeBaseExportSchema.parse(exported);
}

/** A reference-validation error thrown during import preflight. */
export class PortableImportError extends Error {}

/**
 * Import a portable export into a NEW Knowledge Base owned by `actorUserId`
 * (US-032 AC1). All IDs are regenerated through the canonical create paths and
 * cross-references (claim args, citation links, schema versions) are remapped.
 * The whole document is preflight-validated so a bad reference fails before any
 * KB is created. Audit rows are NOT replayed (the new records create their own).
 */
export async function importPortableKnowledgeBase(
  stores: ExportStores,
  actorUserId: string,
  exported: PortableKnowledgeBaseExport,
): Promise<PortableImportResult> {
  const warnings: string[] = [];
  const data = exported.data;

  // --- Preflight reference validation (before any write) ---
  const entityIds = new Set(data.entities.map((e) => e.id));
  const versionIds = new Set(data.schemas.flatMap((d) => d.versions.map((v) => v.id)));
  const noteIds = new Set(data.notes.map((n) => n.id));
  const sourceIds = new Set(data.sources.map((s) => s.id));
  const claimIds = new Set(data.claims.map((c) => c.id));

  for (const entity of data.entities) {
    if (entity.schemaVersionId && !versionIds.has(entity.schemaVersionId)) {
      throw new PortableImportError(`Entity ${entity.id} references unknown schema version`);
    }
  }
  for (const claim of data.claims) {
    if (claim.schemaVersionId && !versionIds.has(claim.schemaVersionId)) {
      throw new PortableImportError(`Claim ${claim.id} references unknown schema version`);
    }
    for (const arg of claim.arguments) {
      if (arg.argumentKind === 'entity' && (!arg.entityId || !entityIds.has(arg.entityId))) {
        throw new PortableImportError(
          `Claim ${claim.id} argument references unknown entity ${arg.entityId ?? '(null)'}`,
        );
      }
    }
  }
  for (const c of data.citations) {
    if (c.noteId && !noteIds.has(c.noteId)) {
      throw new PortableImportError(`Citation ${c.id} references unknown note`);
    }
    if (c.sourceId && !sourceIds.has(c.sourceId)) {
      throw new PortableImportError(`Citation ${c.id} references unknown source`);
    }
    if (c.claimId && !claimIds.has(c.claimId)) {
      throw new PortableImportError(`Citation ${c.id} references unknown claim`);
    }
  }

  // --- Create the target KB ---
  const kb = await stores.kbStore.createKnowledgeBase({
    name: exported.knowledgeBase.name,
    description: exported.knowledgeBase.description ?? undefined,
    createdBy: actorUserId,
  });

  const versionMap = new Map<string, string>(); // old version id -> new version id
  const entityMap = new Map<string, string>();
  const noteMap = new Map<string, string>();
  const sourceMap = new Map<string, string>();
  const claimMap = new Map<string, string>();
  const counts = {
    schemaDefinitions: 0,
    schemaVersions: 0,
    entities: 0,
    claims: 0,
    notes: 0,
    sources: 0,
    citations: 0,
    rules: 0,
  };

  // --- Schemas + version history ---
  for (const def of data.schemas) {
    const versions = [...def.versions].sort((a, b) => a.version - b.version);
    const v1 = versions[0];
    if (!v1) continue;
    const created = await stores.schemaStore.createDefinition({
      knowledgeBaseId: kb.id,
      kind: def.kind,
      name: def.name,
      displayName: def.displayName,
      description: def.description ?? undefined,
      propertySchema: v1.propertySchema,
      spec: predicateSpecSchema.parse(v1.spec),
      actorUserId,
    });
    if (!created.ok) {
      warnings.push(`Schema "${def.name}" skipped: ${created.reason}`);
      continue;
    }
    counts.schemaDefinitions += 1;
    counts.schemaVersions += 1;
    const newByNumber = new Map<number, string>();
    if (created.definition.activeVersion) {
      newByNumber.set(1, created.definition.activeVersion.id);
    }
    versionMap.set(v1.id, created.definition.activeVersion?.id ?? '');

    // Replay later versions (each stored version is a breaking change in this
    // dialect, so updateDefinition should add a new active version).
    for (const version of versions.slice(1)) {
      const updated = await stores.schemaStore.updateDefinition({
        knowledgeBaseId: kb.id,
        id: created.definition.id,
        propertySchema: version.propertySchema,
        spec: predicateSpecSchema.parse(version.spec),
        actorUserId,
      });
      if (updated.ok && updated.definition.activeVersion) {
        counts.schemaVersions += 1;
        newByNumber.set(
          updated.definition.activeVersion.version,
          updated.definition.activeVersion.id,
        );
      }
    }

    // Map every old version id to the new version id of the SAME version number.
    for (const version of versions) {
      const newId = newByNumber.get(version.version);
      if (newId) versionMap.set(version.id, newId);
      else if (!versionMap.has(version.id)) {
        warnings.push(
          `Schema "${def.name}" version ${version.version} could not be recreated; records referencing it will be unconstrained`,
        );
      }
    }
  }

  const mapVersion = (oldId: string | null): string | undefined => {
    if (!oldId) return undefined;
    const v = versionMap.get(oldId);
    return v && v.length > 0 ? v : undefined;
  };

  // --- Entities ---
  for (const entity of data.entities) {
    const created = await stores.entityStore.createEntity({
      knowledgeBaseId: kb.id,
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      description: entity.description ?? undefined,
      tags: entity.tags,
      properties: entity.properties,
      schemaVersionId: mapVersion(entity.schemaVersionId),
      actorUserId,
    });
    entityMap.set(entity.id, created.id);
    counts.entities += 1;
  }

  // --- Notes ---
  for (const note of data.notes) {
    const created = await stores.noteStore.createNote({
      knowledgeBaseId: kb.id,
      title: note.title ?? undefined,
      content: note.content,
      properties: note.properties,
      actorUserId,
    });
    noteMap.set(note.id, created.id);
    counts.notes += 1;
  }

  // --- Sources ---
  for (const source of data.sources) {
    const created = await stores.sourceStore.createSource({
      knowledgeBaseId: kb.id,
      title: source.title ?? 'Untitled source',
      sourceType: source.sourceType ?? undefined,
      uri: source.uri ?? undefined,
      content: source.content ?? undefined,
      metadata: source.metadata,
      properties: source.properties,
      actorUserId,
    });
    sourceMap.set(source.id, created.id);
    counts.sources += 1;
  }

  // --- Claims (after entities so entity-arg refs resolve) ---
  for (const claim of data.claims) {
    const created = await stores.claimStore.createClaim({
      knowledgeBaseId: kb.id,
      predicate: claim.predicate,
      description: claim.description ?? undefined,
      confidence: claim.confidence ?? undefined,
      validStart: claim.validStart ?? undefined,
      validEnd: claim.validEnd ?? undefined,
      properties: claim.properties,
      provenance: claim.provenance,
      schemaVersionId: mapVersion(claim.schemaVersionId),
      arguments: claim.arguments.map((arg) =>
        arg.argumentKind === 'entity'
          ? {
              role: arg.role,
              argumentKind: 'entity' as const,
              entityId: entityMap.get(arg.entityId as string),
            }
          : { role: arg.role, argumentKind: 'literal' as const, value: arg.value },
      ),
      actorUserId,
    });
    claimMap.set(claim.id, created.id);
    counts.claims += 1;
  }

  // --- Citations / source excerpts ---
  for (const citation of data.citations) {
    const result = await stores.sourceExcerptStore.createSourceExcerpt({
      knowledgeBaseId: kb.id,
      noteId: citation.noteId ? noteMap.get(citation.noteId) : undefined,
      sourceId: citation.sourceId ? sourceMap.get(citation.sourceId) : undefined,
      claimId: citation.claimId ? claimMap.get(citation.claimId) : undefined,
      excerpt: citation.excerpt ?? undefined,
      spanStart: citation.spanStart ?? undefined,
      spanEnd: citation.spanEnd ?? undefined,
      metadata: citation.metadata,
      actorUserId,
    });
    if (result.ok) counts.citations += 1;
    else warnings.push(`Citation ${citation.id} skipped: ${result.reason}`);
  }

  // --- Rules ---
  // Built-in rules whose pack still exists are reinstalled to preserve their
  // module/pack provenance; everything else is recreated as an authored rule.
  const installedPacks = new Set<string>();
  for (const rule of data.rules) {
    if (rule.moduleId && rule.packId) {
      const found = findBuiltinRulePack(rule.moduleId, rule.packId);
      if (found) {
        const packKey = `${rule.moduleId}/${rule.packId}`;
        if (!installedPacks.has(packKey)) {
          await stores.ruleStore.installRulePack({
            knowledgeBaseId: kb.id,
            module: found.module,
            pack: found.pack,
            actorUserId,
          });
          installedPacks.add(packKey);
        }
        const installed = (await stores.ruleStore.listRules(kb.id)).find(
          (r) => r.name === rule.name,
        );
        if (installed) {
          counts.rules += 1;
          if (rule.status === 'enabled' || rule.status === 'disabled') {
            await stores.ruleStore.setRuleStatus({
              knowledgeBaseId: kb.id,
              id: installed.id,
              status: rule.status,
              actorUserId,
            });
          }
        }
        continue;
      }
      warnings.push(`Rule "${rule.name}": built-in pack no longer exists; recreated as authored`);
    }
    const created = await stores.ruleStore.createRule({
      knowledgeBaseId: kb.id,
      name: rule.name,
      description: rule.description ?? undefined,
      ruleText: rule.ruleText,
      recursionCap: rule.recursionCap,
      actorUserId,
    });
    if (!created.ok) {
      warnings.push(`Rule "${rule.name}" skipped: ${created.reason}`);
      continue;
    }
    counts.rules += 1;
    if (rule.status === 'enabled' || rule.status === 'disabled') {
      await stores.ruleStore.setRuleStatus({
        knowledgeBaseId: kb.id,
        id: created.rule.id,
        status: rule.status,
        actorUserId,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    knowledgeBaseId: kb.id,
    knowledgeBaseName: kb.name,
    counts,
    warnings,
  };
}
