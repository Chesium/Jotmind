import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { findBuiltinRulePack } from '@jotmind/schemas';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { auditEvents, knowledgeBases, ruleDefinitions, users } from '../db/schema.js';
import { dbRuleStore } from './store.js';

/**
 * Integration tests for built-in rule pack install + enable/disable (US-022).
 * Skipped when DATABASE_URL is unset so default `pnpm test:api` stays green.
 * Run with `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${auditEvents}, ${ruleDefinitions}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('rule pack install integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'rules@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Rules KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('installs a rule pack as versioned disabled rules with audit events', async () => {
    const found = findBuiltinRulePack('personal-relationship', 'event-participation');
    expect(found).toBeTruthy();
    const result = await dbRuleStore.installRulePack({
      knowledgeBaseId: kbId,
      module: found!.module,
      pack: found!.pack,
      actorUserId: userId,
    });
    expect(result.installed.length).toBe(found!.pack.rules.length);
    for (const row of result.installed) {
      expect(row.status).toBe('disabled');
      expect(row.version).toBe(found!.pack.version);
      expect(row.knowledgeBaseId).toBe(kbId);
    }

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.knowledgeBaseId, kbId), eq(auditEvents.action, 'rule.installed')));
    expect(audits.length).toBe(found!.pack.rules.length);
  });

  it('is idempotent across re-installs (skips duplicates)', async () => {
    const found = findBuiltinRulePack('reading-character-map', 'family-relationship')!;
    await dbRuleStore.installRulePack({
      knowledgeBaseId: kbId,
      module: found.module,
      pack: found.pack,
      actorUserId: userId,
    });
    const again = await dbRuleStore.installRulePack({
      knowledgeBaseId: kbId,
      module: found.module,
      pack: found.pack,
      actorUserId: userId,
    });
    expect(again.installed).toHaveLength(0);
    expect(again.skipped.length).toBe(found.pack.rules.length);

    const rows = await getDb()
      .select()
      .from(ruleDefinitions)
      .where(eq(ruleDefinitions.knowledgeBaseId, kbId));
    expect(rows.length).toBe(found.pack.rules.length);
  });

  it('enables then disables a rule with audit events (AC4)', async () => {
    const found = findBuiltinRulePack('personal-relationship', 'event-participation')!;
    const { installed } = await dbRuleStore.installRulePack({
      knowledgeBaseId: kbId,
      module: found.module,
      pack: found.pack,
      actorUserId: userId,
    });
    const ruleId = installed[0]!.id;

    const enabled = await dbRuleStore.setRuleStatus({
      knowledgeBaseId: kbId,
      id: ruleId,
      status: 'enabled',
      actorUserId: userId,
    });
    expect(enabled?.status).toBe('enabled');

    const disabled = await dbRuleStore.setRuleStatus({
      knowledgeBaseId: kbId,
      id: ruleId,
      status: 'disabled',
      actorUserId: userId,
    });
    expect(disabled?.status).toBe('disabled');

    const audits = await getDb().select().from(auditEvents).where(eq(auditEvents.targetId, ruleId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('rule.enabled');
    expect(actions).toContain('rule.disabled');
  });
});
