import { and, eq, isNull } from 'drizzle-orm';
import {
  DEFAULT_AI_POLICY,
  type AiPolicy,
  type AiPolicyScope,
  type UpdateAiPolicy,
} from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { aiPolicies, auditEvents } from '../db/schema.js';

/** Identifies a single policy layer. `scopeId` is null only for the server scope. */
export interface PolicyKey {
  scope: AiPolicyScope;
  scopeId: string | null;
}

export interface UpdatePolicyInput extends PolicyKey {
  changes: UpdateAiPolicy;
  actorUserId: string;
}

/**
 * Persistence boundary for layered AI privacy policies (US-016). Defined as an
 * interface so route handlers can run against an in-memory fake in unit tests
 * (no live DB) while production uses the PostgreSQL-backed implementation.
 *
 * `get*` return {@link DEFAULT_AI_POLICY} (= No AI) when no row exists, so fresh
 * installs default to No AI (AC1).
 */
export interface AiPolicyStore {
  getPolicy(key: PolicyKey): Promise<AiPolicy>;
  /** Resolve every applicable layer at once. Returns DEFAULT for missing layers. */
  getPolicies(keys: PolicyKey[]): Promise<AiPolicy[]>;
  updatePolicy(input: UpdatePolicyInput): Promise<AiPolicy>;
}

function matchScope(key: PolicyKey) {
  if (key.scope === 'server') {
    return and(eq(aiPolicies.scope, 'server'), isNull(aiPolicies.scopeId));
  }
  return and(eq(aiPolicies.scope, key.scope), eq(aiPolicies.scopeId, key.scopeId as string));
}

function auditTargetId(key: PolicyKey): string {
  return key.scope === 'server' ? 'server' : `${key.scope}:${key.scopeId}`;
}

/** PostgreSQL-backed AiPolicyStore. Resolves the Drizzle client per call. */
export const dbAiPolicyStore: AiPolicyStore = {
  async getPolicy(key) {
    const rows = await getDb().select().from(aiPolicies).where(matchScope(key)).limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_AI_POLICY };
    return { mode: row.mode as AiPolicy['mode'], remoteEmbeddings: row.remoteEmbeddings };
  },

  async getPolicies(keys) {
    return Promise.all(keys.map((key) => this.getPolicy(key)));
  },

  async updatePolicy(input) {
    return getDb().transaction(async (tx) => {
      const existingRows = await tx.select().from(aiPolicies).where(matchScope(input)).limit(1);
      const existing = existingRows[0];
      const previous: AiPolicy = existing
        ? { mode: existing.mode as AiPolicy['mode'], remoteEmbeddings: existing.remoteEmbeddings }
        : { ...DEFAULT_AI_POLICY };

      const next: AiPolicy = {
        mode: input.changes.mode ?? previous.mode,
        remoteEmbeddings: input.changes.remoteEmbeddings ?? previous.remoteEmbeddings,
      };

      if (existing) {
        await tx
          .update(aiPolicies)
          .set({
            mode: next.mode,
            remoteEmbeddings: next.remoteEmbeddings,
            updatedBy: input.actorUserId,
            updatedAt: new Date(),
          })
          .where(eq(aiPolicies.id, existing.id));
      } else {
        await tx.insert(aiPolicies).values({
          scope: input.scope,
          scopeId: input.scopeId,
          mode: next.mode,
          remoteEmbeddings: next.remoteEmbeddings,
          updatedBy: input.actorUserId,
        });
      }

      // Security-relevant mutation: record an audit event in the same tx.
      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.scope === 'knowledge_base' ? input.scopeId : null,
        actorUserId: input.actorUserId,
        action: 'ai_policy.updated',
        targetType: 'ai_policy',
        targetId: auditTargetId(input),
        metadata: {
          scope: input.scope,
          previousMode: previous.mode,
          nextMode: next.mode,
          previousRemoteEmbeddings: previous.remoteEmbeddings,
          nextRemoteEmbeddings: next.remoteEmbeddings,
        },
      });

      return next;
    });
  },
};
