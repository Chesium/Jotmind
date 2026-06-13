import { getDb } from '../db/client.js';
import {
  claimArguments,
  claims,
  entities,
  notes,
  sources,
  type ClaimRow,
  type EntityRow,
  type NewClaimArgumentRow,
  type NoteRow,
  type SourceRow,
} from '../db/schema.js';
import { enqueueGraphOutbox } from './outbox.js';

export interface CreateEntityInput {
  knowledgeBaseId: string;
  type: string;
  name: string;
  aliases?: string[];
  description?: string;
  tags?: string[];
  properties?: Record<string, unknown>;
  schemaVersionId?: string;
  createdBy?: string;
}

export interface CreateNoteInput {
  knowledgeBaseId: string;
  title?: string;
  content: string;
  properties?: Record<string, unknown>;
  createdBy?: string;
}

export interface CreateSourceInput {
  knowledgeBaseId: string;
  title?: string;
  sourceType?: string;
  uri?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  createdBy?: string;
}

export interface ClaimArgumentInput {
  role: string;
  position?: number;
  argumentKind?: 'entity' | 'literal';
  entityId?: string;
  value?: unknown;
}

export interface CreateClaimInput {
  knowledgeBaseId: string;
  predicate: string;
  description?: string;
  confidence?: number;
  schemaVersionId?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  createdBy?: string;
  arguments?: ClaimArgumentInput[];
}

/**
 * Canonical graph write boundary (US-006). Every method writes the canonical
 * relational record(s) and the matching `graph_outbox` event in a single
 * transaction, so Apache AGE can stay a derived projection without rewriting
 * these write paths later. US-008/009/011 build their entity/claim/note/source
 * creation flows on top of this store.
 */
export interface GraphWriteStore {
  createEntity(input: CreateEntityInput): Promise<EntityRow>;
  createNote(input: CreateNoteInput): Promise<NoteRow>;
  createSource(input: CreateSourceInput): Promise<SourceRow>;
  createClaim(input: CreateClaimInput): Promise<ClaimRow>;
}

/** PostgreSQL-backed GraphWriteStore. */
export const dbGraphWriteStore: GraphWriteStore = {
  async createEntity(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(entities)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          type: input.type,
          name: input.name,
          aliases: input.aliases ?? [],
          description: input.description ?? null,
          tags: input.tags ?? [],
          properties: input.properties ?? {},
          schemaVersionId: input.schemaVersionId ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      const entity = rows[0];
      if (!entity) throw new Error('Failed to create entity');
      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: entity.knowledgeBaseId,
        eventType: 'created',
        targetType: 'entity',
        targetId: entity.id,
        payload: { type: entity.type, name: entity.name },
      });
      return entity;
    });
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
          createdBy: input.createdBy ?? null,
        })
        .returning();
      const note = rows[0];
      if (!note) throw new Error('Failed to create note');
      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: note.knowledgeBaseId,
        eventType: 'created',
        targetType: 'note',
        targetId: note.id,
      });
      return note;
    });
  },

  async createSource(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(sources)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          title: input.title ?? null,
          sourceType: input.sourceType ?? null,
          uri: input.uri ?? null,
          content: input.content ?? null,
          metadata: input.metadata ?? {},
          properties: input.properties ?? {},
          createdBy: input.createdBy ?? null,
        })
        .returning();
      const source = rows[0];
      if (!source) throw new Error('Failed to create source');
      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: source.knowledgeBaseId,
        eventType: 'created',
        targetType: 'source',
        targetId: source.id,
      });
      return source;
    });
  },

  async createClaim(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(claims)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          predicate: input.predicate,
          description: input.description ?? null,
          confidence: input.confidence ?? null,
          schemaVersionId: input.schemaVersionId ?? null,
          properties: input.properties ?? {},
          provenance: input.provenance ?? {},
          createdBy: input.createdBy ?? null,
        })
        .returning();
      const claim = rows[0];
      if (!claim) throw new Error('Failed to create claim');

      const argInputs = input.arguments ?? [];
      if (argInputs.length > 0) {
        const argRows: NewClaimArgumentRow[] = argInputs.map((a, i) => ({
          knowledgeBaseId: claim.knowledgeBaseId,
          claimId: claim.id,
          role: a.role,
          position: a.position ?? i,
          argumentKind: a.argumentKind ?? 'entity',
          entityId: a.entityId ?? null,
          value: a.value === undefined ? null : a.value,
        }));
        await tx.insert(claimArguments).values(argRows);
      }

      await enqueueGraphOutbox(tx, {
        knowledgeBaseId: claim.knowledgeBaseId,
        eventType: 'created',
        targetType: 'claim',
        targetId: claim.id,
        payload: { predicate: claim.predicate },
      });
      return claim;
    });
  },
};
