import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDatabaseUrl, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  auditEvents,
  knowledgeBases,
  schemaDefinitions,
  schemaVersions,
  users,
} from '../db/schema.js';
import { dbSchemaStore } from './store.js';

/**
 * Integration tests for custom schema definitions (US-027). Skipped when
 * DATABASE_URL is unset so default `pnpm test:api` stays green. Run with
 * `DATABASE_URL=... pnpm --filter @jotmind/api test`.
 */
const hasDatabase = Boolean(getDatabaseUrl());

async function truncateAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE ${auditEvents}, ${schemaVersions}, ${schemaDefinitions}, ${knowledgeBases}, ${users} CASCADE`,
  );
}

describe.skipIf(!hasDatabase)('schema definitions integration', () => {
  let kbId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    const [owner] = await getDb()
      .insert(users)
      .values({ email: 'schema@integration.test', passwordHash: 'x' })
      .returning();
    userId = owner!.id;
    const [kb] = await getDb()
      .insert(knowledgeBases)
      .values({ name: 'Schema KB', createdBy: userId })
      .returning();
    kbId = kb!.id;
  });

  afterAll(async () => {
    await truncateAll();
    await closeDb();
  });

  it('creates a definition with a v1 active version + audit, retrievable by name', async () => {
    const result = await dbSchemaStore.createDefinition({
      knowledgeBaseId: kbId,
      kind: 'entity_type',
      name: 'Person',
      displayName: 'Person',
      description: 'A human',
      propertySchema: { born: { type: 'number', required: true } },
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.activeVersion?.version).toBe(1);
    expect(result.definition.activeVersion?.isActive).toBe(true);

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.knowledgeBaseId, kbId), eq(auditEvents.action, 'schema.created')));
    expect(audits.length).toBe(1);

    const active = await dbSchemaStore.getActiveVersionByName(kbId, 'entity_type', 'Person');
    expect(active?.id).toBe(result.definition.activeVersion?.id);
    expect((active?.propertySchema as Record<string, unknown>).born).toBeTruthy();
  });

  it('rejects a duplicate (kind, name) within the KB', async () => {
    const input = {
      knowledgeBaseId: kbId,
      kind: 'claim_predicate' as const,
      name: 'knows',
      displayName: 'knows',
      spec: { argumentRoles: [{ name: 'subject', required: true }] },
      actorUserId: userId,
    };
    const first = await dbSchemaStore.createDefinition(input);
    expect(first.ok).toBe(true);
    const second = await dbSchemaStore.createDefinition(input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('duplicate_name');
  });

  it('lists definitions scoped to the KB with their active versions', async () => {
    await dbSchemaStore.createDefinition({
      knowledgeBaseId: kbId,
      kind: 'entity_type',
      name: 'Place',
      displayName: 'Place',
      actorUserId: userId,
    });
    const list = await dbSchemaStore.listDefinitions(kbId);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Place');
    expect(list[0]?.activeVersion?.version).toBe(1);
  });

  it('updates the active version in place for a compatible change (US-028 AC1)', async () => {
    const created = await dbSchemaStore.createDefinition({
      knowledgeBaseId: kbId,
      kind: 'entity_type',
      name: 'Person',
      displayName: 'Person',
      propertySchema: { born: { type: 'number', required: true } },
      actorUserId: userId,
    });
    if (!created.ok) throw new Error('setup failed');
    const v1Id = created.definition.activeVersion!.id;

    const result = await dbSchemaStore.updateDefinition({
      knowledgeBaseId: kbId,
      id: created.definition.id,
      displayName: 'People',
      propertySchema: { born: { type: 'number' }, city: { type: 'string' } },
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.classification.changeType).toBe('compatible');
    expect(result.definition.displayName).toBe('People');
    // Same version row, updated in place.
    expect(result.definition.activeVersion?.id).toBe(v1Id);
    expect(result.definition.activeVersion?.version).toBe(1);

    const versionRows = await getDb()
      .select()
      .from(schemaVersions)
      .where(eq(schemaVersions.schemaDefinitionId, created.definition.id));
    expect(versionRows).toHaveLength(1);
  });

  it('creates a new active version for a breaking change, old data stays valid (US-028 AC2/AC3)', async () => {
    const created = await dbSchemaStore.createDefinition({
      knowledgeBaseId: kbId,
      kind: 'entity_type',
      name: 'Place',
      displayName: 'Place',
      propertySchema: { region: { type: 'string' } },
      actorUserId: userId,
    });
    if (!created.ok) throw new Error('setup failed');
    const v1Id = created.definition.activeVersion!.id;

    const result = await dbSchemaStore.updateDefinition({
      knowledgeBaseId: kbId,
      id: created.definition.id,
      // Tighten: make `region` required.
      propertySchema: { region: { type: 'string', required: true } },
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.classification.changeType).toBe('breaking');
    expect(result.definition.activeVersion?.version).toBe(2);
    expect(result.definition.activeVersion?.id).not.toBe(v1Id);

    // Both versions persist; only the new one is active. Existing records still
    // reference v1 (AC3) which remains a valid row.
    const versionRows = await getDb()
      .select()
      .from(schemaVersions)
      .where(eq(schemaVersions.schemaDefinitionId, created.definition.id));
    expect(versionRows).toHaveLength(2);
    const v1 = versionRows.find((v) => v.id === v1Id);
    expect(v1?.isActive).toBe(false);
    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.knowledgeBaseId, kbId),
          eq(auditEvents.action, 'schema.version_created'),
        ),
      );
    expect(audits.length).toBe(1);
  });

  it('returns not_found when updating a missing definition', async () => {
    const result = await dbSchemaStore.updateDefinition({
      knowledgeBaseId: kbId,
      id: '00000000-0000-0000-0000-000000000000',
      displayName: 'Nope',
      actorUserId: userId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});
