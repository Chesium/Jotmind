import { and, desc, eq, isNull } from 'drizzle-orm';
import type { BuiltinRuleModule, BuiltinRulePack } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { auditEvents, ruleDefinitions, type RuleDefinitionRow } from '../db/schema.js';

/** Built-in provenance stashed in `rule_definitions.compiled` for installed packs. */
export interface BuiltinRuleMeta {
  moduleId: string;
  packId: string;
  ruleKey: string;
  packVersion: number;
}

export function readBuiltinMeta(compiled: unknown): BuiltinRuleMeta | null {
  if (!compiled || typeof compiled !== 'object') return null;
  const builtin = (compiled as { builtin?: unknown }).builtin;
  if (!builtin || typeof builtin !== 'object') return null;
  const m = builtin as Partial<BuiltinRuleMeta>;
  if (typeof m.moduleId === 'string' && typeof m.packId === 'string') {
    return {
      moduleId: m.moduleId,
      packId: m.packId,
      ruleKey: typeof m.ruleKey === 'string' ? m.ruleKey : '',
      packVersion: typeof m.packVersion === 'number' ? m.packVersion : 1,
    };
  }
  return null;
}

export interface InstallRulePackInput {
  knowledgeBaseId: string;
  module: BuiltinRuleModule;
  pack: BuiltinRulePack;
  actorUserId: string;
}

export interface SkippedRuleInfo {
  name: string;
  version: number;
  reason: string;
}

export interface InstallRulePackStoreResult {
  installed: RuleDefinitionRow[];
  skipped: SkippedRuleInfo[];
}

export interface SetRuleStatusInput {
  knowledgeBaseId: string;
  id: string;
  status: 'enabled' | 'disabled';
  actorUserId: string;
}

/**
 * Persistence boundary for rule definitions (US-022 install; US-023/024 build
 * on it). Defined as an interface so route handlers run against an in-memory
 * fake in unit tests (no live DB) while production uses the PostgreSQL impl.
 *
 * Rules are NOT graph projection targets — writes record an `audit_events` row
 * only (no `graph_outbox`). Built-in rules install with status `disabled` and
 * are auditable when enabled/disabled (AC4). Reads filter `deleted_at IS NULL`.
 */
export interface RuleStore {
  listRules(knowledgeBaseId: string): Promise<RuleDefinitionRow[]>;
  getRule(knowledgeBaseId: string, id: string): Promise<RuleDefinitionRow | undefined>;
  installRulePack(input: InstallRulePackInput): Promise<InstallRulePackStoreResult>;
  setRuleStatus(input: SetRuleStatusInput): Promise<RuleDefinitionRow | undefined>;
}

/** PostgreSQL-backed RuleStore. Resolves the Drizzle client per call. */
export const dbRuleStore: RuleStore = {
  async listRules(knowledgeBaseId) {
    return getDb()
      .select()
      .from(ruleDefinitions)
      .where(
        and(
          eq(ruleDefinitions.knowledgeBaseId, knowledgeBaseId),
          isNull(ruleDefinitions.deletedAt),
        ),
      )
      .orderBy(desc(ruleDefinitions.createdAt));
  },

  async getRule(knowledgeBaseId, id) {
    const rows = await getDb()
      .select()
      .from(ruleDefinitions)
      .where(
        and(
          eq(ruleDefinitions.id, id),
          eq(ruleDefinitions.knowledgeBaseId, knowledgeBaseId),
          isNull(ruleDefinitions.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async installRulePack(input) {
    return getDb().transaction(async (tx) => {
      const installed: RuleDefinitionRow[] = [];
      const skipped: SkippedRuleInfo[] = [];

      for (const rule of input.pack.rules) {
        // Idempotency: skip a rule already installed at this pack version.
        const existing = await tx
          .select()
          .from(ruleDefinitions)
          .where(
            and(
              eq(ruleDefinitions.knowledgeBaseId, input.knowledgeBaseId),
              eq(ruleDefinitions.name, rule.name),
              eq(ruleDefinitions.version, input.pack.version),
              isNull(ruleDefinitions.deletedAt),
            ),
          )
          .limit(1);
        if (existing[0]) {
          skipped.push({
            name: rule.name,
            version: input.pack.version,
            reason: 'already installed',
          });
          continue;
        }

        const meta: BuiltinRuleMeta = {
          moduleId: input.module.id,
          packId: input.pack.id,
          ruleKey: rule.key,
          packVersion: input.pack.version,
        };
        const rows = await tx
          .insert(ruleDefinitions)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            name: rule.name,
            description: rule.description,
            ruleText: rule.ruleText,
            compiled: { builtin: meta },
            status: 'disabled',
            version: input.pack.version,
            createdBy: input.actorUserId,
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('Failed to install rule');

        await tx.insert(auditEvents).values({
          knowledgeBaseId: input.knowledgeBaseId,
          actorUserId: input.actorUserId,
          action: 'rule.installed',
          targetType: 'rule',
          targetId: row.id,
          metadata: {
            name: rule.name,
            version: input.pack.version,
            moduleId: input.module.id,
            packId: input.pack.id,
          },
        });

        installed.push(row);
      }

      return { installed, skipped };
    });
  },

  async setRuleStatus(input) {
    return getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(ruleDefinitions)
        .where(
          and(
            eq(ruleDefinitions.id, input.id),
            eq(ruleDefinitions.knowledgeBaseId, input.knowledgeBaseId),
            isNull(ruleDefinitions.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return undefined;

      const now = new Date();
      const rows = await tx
        .update(ruleDefinitions)
        .set({ status: input.status, updatedAt: now })
        .where(
          and(
            eq(ruleDefinitions.id, input.id),
            eq(ruleDefinitions.knowledgeBaseId, input.knowledgeBaseId),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to update rule status');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: input.status === 'enabled' ? 'rule.enabled' : 'rule.disabled',
        targetType: 'rule',
        targetId: row.id,
        metadata: { name: row.name, version: row.version },
      });

      return row;
    });
  },
};
