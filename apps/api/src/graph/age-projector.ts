import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { claimArguments, claims, entities } from '../db/schema.js';
import { AGE_GRAPH_NAME, withAge, type AgeSession } from './age.js';
import type { ProjectionEvent, Projector } from './projector.js';

/**
 * Real Apache AGE projector (US-026).
 *
 * Projects canonical entity/claim/argument structures into the derived AGE graph
 * from `graph_outbox` events (AC1). It always loads the *current* canonical row
 * from the relational tables (never trusting the minimal outbox payload), so the
 * same code path serves create/update/delete and rebuild events idempotently.
 *
 * Graph model (AC2):
 *   - (:Entity {id,kbId,kind,type,name,aliases,description,tags,updatedAt})
 *   - (:Claim  {id,kbId,kind,predicate,description,confidence,validStart,
 *               validEnd,literalArgs,updatedAt})
 *   - (:Claim)-[:ARGUMENT {argumentId,role,position}]->(:Entity) for every
 *     entity-typed argument — multi-argument claims become a claim node linked
 *     to entity nodes by role-labeled edges. Literal arguments are stored on the
 *     claim node's `literalArgs` property.
 *
 * Notes and Sources are canonical records but are not (yet) traversal targets,
 * so their events are accepted as successful no-ops.
 */

async function deleteEntityNode(age: AgeSession, id: string): Promise<void> {
  await age.cypher('MATCH (e:Entity {id: $id}) DETACH DELETE e', 'deleted agtype', { id });
}

async function deleteClaimNode(age: AgeSession, id: string): Promise<void> {
  await age.cypher('MATCH (c:Claim {id: $id}) DETACH DELETE c', 'deleted agtype', { id });
}

async function upsertEntity(age: AgeSession, id: string): Promise<void> {
  const rows = await getDb()
    .select()
    .from(entities)
    .where(and(eq(entities.id, id), isNull(entities.deletedAt)))
    .limit(1);
  const entity = rows[0];
  if (!entity) {
    // Missing or soft-deleted: ensure the projection has no stale node.
    await deleteEntityNode(age, id);
    return;
  }
  await age.cypher(
    `MERGE (e:Entity {id: $id})
     SET e.kbId = $kbId,
         e.kind = 'entity',
         e.type = $type,
         e.name = $name,
         e.aliases = $aliases,
         e.description = $description,
         e.tags = $tags,
         e.updatedAt = $updatedAt`,
    'e agtype',
    {
      id: entity.id,
      kbId: entity.knowledgeBaseId,
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases ?? [],
      description: entity.description ?? null,
      tags: entity.tags ?? [],
      updatedAt: entity.updatedAt.toISOString(),
    },
  );
}

async function upsertClaim(age: AgeSession, id: string): Promise<void> {
  const rows = await getDb()
    .select()
    .from(claims)
    .where(and(eq(claims.id, id), isNull(claims.deletedAt)))
    .limit(1);
  const claim = rows[0];

  // Always clear the existing projection first so re-projecting is idempotent
  // (edges are recreated rather than duplicated).
  await deleteClaimNode(age, id);
  if (!claim) return;

  const args = await getDb()
    .select()
    .from(claimArguments)
    .where(and(eq(claimArguments.claimId, id), isNull(claimArguments.deletedAt)))
    .orderBy(asc(claimArguments.position));

  const literalArgs = args
    .filter((a) => a.argumentKind === 'literal')
    .map((a) => ({ id: a.id, role: a.role, position: a.position, value: a.value }));

  await age.cypher(
    `CREATE (c:Claim {
       id: $id, kbId: $kbId, kind: 'claim', predicate: $predicate,
       description: $description, confidence: $confidence,
       validStart: $validStart, validEnd: $validEnd,
       literalArgs: $literalArgs, updatedAt: $updatedAt
     })`,
    'c agtype',
    {
      id: claim.id,
      kbId: claim.knowledgeBaseId,
      predicate: claim.predicate,
      description: claim.description ?? null,
      confidence: claim.confidence ?? null,
      validStart: claim.validStart ? claim.validStart.toISOString() : null,
      validEnd: claim.validEnd ? claim.validEnd.toISOString() : null,
      literalArgs,
      updatedAt: claim.updatedAt.toISOString(),
    },
  );

  for (const arg of args) {
    if (arg.argumentKind !== 'entity' || !arg.entityId) continue;
    // Ensure the entity node exists so the edge can attach even if the entity's
    // own event has not been projected yet; its props are filled by its event.
    await age.cypher('MERGE (e:Entity {id: $id})', 'e agtype', { id: arg.entityId });
    await age.cypher(
      `MATCH (c:Claim {id: $cid}), (e:Entity {id: $eid})
       CREATE (c)-[r:ARGUMENT {argumentId: $aid, role: $role, position: $position}]->(e)`,
      'r agtype',
      {
        cid: claim.id,
        eid: arg.entityId,
        aid: arg.id,
        role: arg.role,
        position: arg.position,
      },
    );
  }
}

async function clearProjection(age: AgeSession, knowledgeBaseId?: string): Promise<void> {
  if (knowledgeBaseId) {
    await age.cypher('MATCH (n) WHERE n.kbId = $kbId DETACH DELETE n', 'deleted agtype', {
      kbId: knowledgeBaseId,
    });
  } else {
    await age.cypher('MATCH (n) DETACH DELETE n', 'deleted agtype');
  }
}

/** PostgreSQL + Apache AGE projector. */
export const ageProjector: Projector = {
  name: `age:${AGE_GRAPH_NAME}`,
  stubbed: false,

  async project(event: ProjectionEvent): Promise<void> {
    await withAge(async (age) => {
      switch (event.targetType) {
        case 'entity':
          await upsertEntity(age, event.targetId);
          return;
        case 'claim':
          await upsertClaim(age, event.targetId);
          return;
        case 'note':
        case 'source':
          // Canonical records, but not traversal targets yet: accept as no-op.
          return;
      }
    });
  },

  async prepareRebuild(knowledgeBaseId?: string): Promise<void> {
    await withAge((age) => clearProjection(age, knowledgeBaseId));
  },
};
