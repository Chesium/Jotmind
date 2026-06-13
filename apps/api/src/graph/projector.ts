import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { GraphProjectionStatus, GraphTargetType, OutboxStatus } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import {
  claims,
  entities,
  graphOutbox,
  notes,
  sources,
  type GraphOutboxRow,
} from '../db/schema.js';

/** A canonical record to (re)project, identified by its kind + id. */
export interface ProjectionTarget {
  knowledgeBaseId: string;
  targetType: GraphTargetType;
  targetId: string;
}

/** A projection event handed to a {@link Projector}. */
export interface ProjectionEvent extends ProjectionTarget {
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Consumes outbox/projection events and applies them to the derived graph
 * projection (Apache AGE). Implementations declare `stubbed` so the projection
 * status/logs make clear when no real projection is happening (US-006 AC3).
 */
export interface Projector {
  readonly name: string;
  readonly stubbed: boolean;
  project(event: ProjectionEvent): Promise<void>;
}

/**
 * Default no-op projector. It does NOT write to Apache AGE yet; it only logs,
 * making the stubbed state visible in logs and via the projection status API.
 * The real AGE projector replaces this in a later story.
 */
export const stubProjector: Projector = {
  name: 'stub',
  stubbed: true,
  project(event: ProjectionEvent): Promise<void> {
    console.log(
      `[graph-projector:stub] (no-op) ${event.eventType} ${event.targetType}:${event.targetId} kb=${event.knowledgeBaseId}`,
    );
    return Promise.resolve();
  },
};

/**
 * Persistence boundary for the projection pipeline (US-006). Defined as an
 * interface so the projector/runner can be unit-tested with an in-memory fake.
 */
export interface ProjectionStore {
  /** Claim up to `limit` pending events in `(created_at, id)` order. */
  claimPendingEvents(limit: number): Promise<GraphOutboxRow[]>;
  markEventProcessed(id: string): Promise<void>;
  markEventFailed(id: string, error: string): Promise<void>;
  countByStatus(): Promise<Record<OutboxStatus, number>>;
  /** All non-deleted canonical records, for rebuild from relational tables. */
  listCanonicalTargets(knowledgeBaseId?: string): Promise<ProjectionTarget[]>;
}

/** PostgreSQL-backed ProjectionStore. */
export const dbProjectionStore: ProjectionStore = {
  async claimPendingEvents(limit) {
    return getDb()
      .select()
      .from(graphOutbox)
      .where(and(eq(graphOutbox.status, 'pending'), sql`${graphOutbox.runAfter} <= now()`))
      .orderBy(asc(graphOutbox.createdAt), asc(graphOutbox.id))
      .limit(limit)
      .for('update', { skipLocked: true });
  },

  async markEventProcessed(id) {
    await getDb()
      .update(graphOutbox)
      .set({ status: 'processed', processedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(graphOutbox.id, id));
  },

  async markEventFailed(id, error) {
    await getDb()
      .update(graphOutbox)
      .set({
        status: 'failed',
        attempts: sql`${graphOutbox.attempts} + 1`,
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(graphOutbox.id, id));
  },

  async countByStatus() {
    const rows = await getDb()
      .select({ status: graphOutbox.status, count: sql<number>`count(*)::int` })
      .from(graphOutbox)
      .groupBy(graphOutbox.status);
    const counts: Record<OutboxStatus, number> = { pending: 0, processed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === 'pending' || row.status === 'processed' || row.status === 'failed') {
        counts[row.status] = row.count;
      }
    }
    return counts;
  },

  async listCanonicalTargets(knowledgeBaseId) {
    const db = getDb();
    const tables = [
      { table: entities, type: 'entity' as const },
      { table: claims, type: 'claim' as const },
      { table: notes, type: 'note' as const },
      { table: sources, type: 'source' as const },
    ];
    const out: ProjectionTarget[] = [];
    for (const { table, type } of tables) {
      const where = knowledgeBaseId
        ? and(isNull(table.deletedAt), eq(table.knowledgeBaseId, knowledgeBaseId))
        : isNull(table.deletedAt);
      const rows = await db
        .select({ id: table.id, knowledgeBaseId: table.knowledgeBaseId })
        .from(table)
        .where(where)
        .orderBy(asc(table.createdAt), asc(table.id));
      for (const row of rows) {
        out.push({ knowledgeBaseId: row.knowledgeBaseId, targetType: type, targetId: row.id });
      }
    }
    return out;
  },
};

function toEvent(row: GraphOutboxRow): ProjectionEvent {
  return {
    knowledgeBaseId: row.knowledgeBaseId,
    eventType: row.eventType,
    targetType: row.targetType as GraphTargetType,
    targetId: row.targetId,
    payload: (row.payload as Record<string, unknown>) ?? {},
  };
}

export interface ProcessOutboxOptions {
  store?: ProjectionStore;
  projector?: Projector;
  /** Max events to process in this pass. */
  limit?: number;
}

export interface ProcessOutboxResult {
  processed: number;
  failed: number;
}

/**
 * Consume a batch of pending outbox events and apply them via the projector,
 * marking each processed or failed. Safe to call repeatedly (idempotent at the
 * batch level; each event transitions out of `pending`).
 */
export async function processOutbox(
  options: ProcessOutboxOptions = {},
): Promise<ProcessOutboxResult> {
  const store = options.store ?? dbProjectionStore;
  const projector = options.projector ?? stubProjector;
  const limit = options.limit ?? 100;

  const events = await store.claimPendingEvents(limit);
  let processed = 0;
  let failed = 0;
  for (const row of events) {
    try {
      await projector.project(toEvent(row));
      await store.markEventProcessed(row.id);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown projection error';
      await store.markEventFailed(row.id, message);
      console.error(
        `[graph-projector:${projector.name}] failed to project ${row.eventType} ${row.targetType}:${row.targetId}: ${message}`,
      );
      failed += 1;
    }
  }
  return { processed, failed };
}

export interface RebuildProjectionOptions {
  store?: ProjectionStore;
  projector?: Projector;
  /** Limit rebuild to a single Knowledge Base; omit to rebuild everything. */
  knowledgeBaseId?: string;
}

export interface RebuildProjectionResult {
  reprojected: number;
}

/**
 * Rebuild/repair interface (US-006 AC4): regenerate the derived projection
 * directly from the canonical relational tables, bypassing the outbox. Reads
 * every non-deleted canonical record and re-applies it via the projector.
 */
export async function rebuildProjection(
  options: RebuildProjectionOptions = {},
): Promise<RebuildProjectionResult> {
  const store = options.store ?? dbProjectionStore;
  const projector = options.projector ?? stubProjector;

  console.log(
    `[graph-projector:${projector.name}] rebuild started${
      options.knowledgeBaseId ? ` kb=${options.knowledgeBaseId}` : ' (all knowledge bases)'
    }${projector.stubbed ? ' (STUBBED — no AGE writes)' : ''}`,
  );

  const targets = await store.listCanonicalTargets(options.knowledgeBaseId);
  for (const target of targets) {
    await projector.project({ ...target, eventType: `${target.targetType}.rebuild`, payload: {} });
  }

  console.log(
    `[graph-projector:${projector.name}] rebuild complete: ${targets.length} record(s) reprojected`,
  );
  return { reprojected: targets.length };
}

export interface ProjectionStatusOptions {
  store?: ProjectionStore;
  projector?: Projector;
}

/** Report projector identity (incl. stubbed flag) and outbox backlog counts. */
export async function getProjectionStatus(
  options: ProjectionStatusOptions = {},
): Promise<GraphProjectionStatus> {
  const store = options.store ?? dbProjectionStore;
  const projector = options.projector ?? stubProjector;
  const counts = await store.countByStatus();
  return {
    projector: { name: projector.name, stubbed: projector.stubbed },
    counts,
  };
}
