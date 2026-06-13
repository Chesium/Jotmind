import type { GraphEventType, GraphTargetType } from '@jotmind/schemas';
import { graphOutbox, type NewGraphOutboxRow } from '../db/schema.js';
import type { Database } from '../db/client.js';

/**
 * A transaction-capable database handle. The canonical write helpers accept this
 * so the `graph_outbox` insert happens in the **same transaction** as the
 * canonical relational write (US-006 AC1) — either both commit or neither does.
 */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface GraphOutboxEventInput {
  knowledgeBaseId: string;
  eventType: GraphEventType;
  targetType: GraphTargetType;
  targetId: string;
  payload?: Record<string, unknown>;
}

/** Compose the canonical outbox `event_type` string, e.g. `entity.created`. */
export function outboxEventType(targetType: GraphTargetType, eventType: GraphEventType): string {
  return `${targetType}.${eventType}`;
}

/**
 * Enqueue one or more `graph_outbox` events. MUST be called with the same
 * transaction (`tx`) used for the canonical write so projection events and
 * canonical rows are atomic.
 */
export async function enqueueGraphOutbox(
  tx: DbExecutor,
  events: GraphOutboxEventInput | GraphOutboxEventInput[],
): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  const rows: NewGraphOutboxRow[] = list.map((e) => ({
    knowledgeBaseId: e.knowledgeBaseId,
    eventType: outboxEventType(e.targetType, e.eventType),
    targetType: e.targetType,
    targetId: e.targetId,
    payload: e.payload ?? {},
  }));
  await tx.insert(graphOutbox).values(rows);
}
