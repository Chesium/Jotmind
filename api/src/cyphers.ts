import { z } from "zod";
import { ZResClaimWithoutArg, ZResClaimArg, ZResEntity, ZClaimDTO2, ZEntityDTO2, ZResEntityWithoutLabel } from "@my-repo/shared-types";

export type AnyZodObject = z.ZodObject<any>;

export interface Cypher<P extends AnyZodObject, R extends z.ZodTypeAny | void = void> {
  code: string;
  parameters: P;        // runtime validator + static type source
  returns?: R;          // optional output schema if you want typed results
}

// 2) Helper to build typed Cypher objects
export function makeCypher<P extends AnyZodObject, R extends z.ZodTypeAny | void = void>(
  parameters: P,
  code: string,
  returns?: R
): Cypher<P, R> {
  return { code, parameters, ...(returns ? { returns } : {}) };
}

// 3) Your upsert example as a typed Cypher

// export const init = makeCypher(z.object({}),
//   `
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Person)  REQUIRE n.uuid IS UNIQUE;
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Event)   REQUIRE n.uuid IS UNIQUE;
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Concept) REQUIRE n.uuid IS UNIQUE;
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Place)   REQUIRE n.uuid IS UNIQUE;
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Claim)   REQUIRE n.uuid IS UNIQUE;
//     CREATE CONSTRAINT IF NOT EXISTS FOR (n:Predicate) REQUIRE n.key IS UNIQUE;
//     CREATE FULLTEXT INDEX entityText IF NOT EXISTS  FOR (n:Person|Event|Concept|Place) ON EACH [n.name, n.description];
//     CREATE FULLTEXT INDEX claimText IF NOT EXISTS  FOR (c:Claim) ON EACH [c.predicate, c.description, c.value_str];
//   `
// )

export const updateEntity = makeCypher(ZEntityDTO2,
  `
  WITH $type AS type, $uuid AS uuid, $name AS name, $description AS description
  CALL apoc.cypher.doIt(
    'MERGE (n:'+ type +' {uuid: $uuid})  ' +
    'ON CREATE SET n.created_at = datetime() ' +
    'SET n.name        = $name,              ' +
    '    n.description = $description        ' +
    'RETURN n                                ',
    {uuid: uuid, name: name, description: description}
  ) YIELD value
  RETURN value.n AS n
  `,
  z.array(z.object({
    n: ZResEntityWithoutLabel
  }))
)

export const updateClaim = makeCypher(ZClaimDTO2,
  `
  WITH
    $uuid        AS uuid,
    $predicate   AS predicate,
    $description AS description,
    $confidence  AS confidence,
    $value_str   AS value_str,
    coalesce($args, []) AS args

  // 1) upsert Claim
  MERGE (c:Claim {uuid: uuid})
    ON CREATE SET c.created_at = datetime()
  SET c.predicate   = predicate,
      c.description = description,
      c.confidence  = confidence,
      c.value_str   = value_str,
      c.updated_at  = datetime()

  // 2) clean ARG
  WITH c, args
  OPTIONAL MATCH (c)-[r:ARG]->()
  DELETE r

  // 3) rebuild ARG
  WITH c, args
  UNWIND args AS a
  MATCH (n {uuid: a.node_uuid})
  WHERE n:Person OR n:Event OR n:Concept OR n:Place
  MERGE (c)-[:ARG {role: a.role, position: a.position}]->(n)

  RETURN c;
  `,
  z.array(z.object({
    c: ZResClaimWithoutArg
  }))
)

export const deleteAllClaims = makeCypher(z.object({
  uuid: z.string()
}), `MATCH (c:Claim)-[:ARG]->(n {uuid:$uuid})
WHERE n:Person OR n:Event OR n:Concept OR n:Place
DETACH DELETE c`)

export const upsertClaim = makeCypher(z.object({
  uuid: z.string().optional(),
  predicate: z.string(),
  description: z.string(),
  meta: z.object({
    confidence: z.number(),
    valid_from: z.string(),
    valid_to: z.string(),
    value_str: z.string(),
  }),
  args: z.array(z.object({
    role: z.string(),
    uuid: z.string()
  }))
}),
  `
    CALL apoc.create.uuids(1) YIELD uuid AS gen
    WITH gen, $predicate AS predicate, $uuid AS uuid, $meta AS meta, $args AS args
    CALL apoc.do.when(uuid IS NOT NULL,
      "MERGE (c:Claim {uuid:$uuid}) " +
      "SET c.predicate = $predicate, " +
      "    c.created_at = datetime(), " +
      "    c.confidence = coalesce($meta.confidence, 0.8), " +
      "    c.valid_from = $meta.valid_from, " +
      "    c.valid_to   = $meta.valid_to, " +
      "    c.description= $meta.description " +
      "    c.value_str  = $meta.value_str " +
      "WITH c " +
      "MATCH (c)-[r:ARG]->(u) " +
      "    DELETE r " +
      "WITH c, $args AS args " +
      "UNWIND args AS a " +
      "CALL { " +
      "  WITH a " +
      "  MATCH (n) WHERE n.uuid = a.uuid " +
      "  RETURN n " +
      "} " +
      "MERGE (c)-[:ARG {role:a.role}]->(n) " +
      "RETURN c;",
      "MERGE (c:Claim {uuid:$gen}) " +
      "SET c.predicate = $predicate, " +
      "    c.created_at = datetime(), " +
      "    c.confidence = coalesce($meta.confidence, 0.8), " +
      "    c.valid_from = $meta.valid_from, " +
      "    c.valid_to   = $meta.valid_to, " +
      "    c.description= $meta.description " +
      "    c.value_str  = $meta.value_str " +
      "WITH c, $args AS args " +
      "UNWIND args AS a " +
      "CALL { " +
      "  WITH a " +
      "  MATCH (n) WHERE n.uuid = a.uuid " +
      "  RETURN n " +
      "} " +
      "MERGE (c)-[:ARG {role:a.role}]->(n) " +
      "RETURN c;",{gen:gen,predicate:predicate,meta:meta,args:args,uuid:uuid}
    ) YIELD value
    RETURN value.c AS c
  `
)

export const entityFulltextSearch = makeCypher(z.object({
  q: z.string(),
  offset: z.number(),
  limit: z.number(),
}),
  `
    CALL db.index.fulltext.queryNodes('entityText', $q) YIELD node, score
    RETURN node{.*, labels:labels(node)} AS entity, score
    ORDER BY score DESC SKIP $offset LIMIT $limit;
  `
)

export const claimFulltextSearch = makeCypher(z.object({
  q: z.string(),
  offset: z.number(),
  limit: z.number(),
}),
  `
    CALL db.index.fulltext.queryNodes('claimText', $q) YIELD node, score
    RETURN node{.*, labels:labels(node)} AS entity, score
    ORDER BY score DESC SKIP $offset LIMIT $limit;
  `
)

export const _getEntityClaims = makeCypher(z.object({
  uuid: z.string()
}), `
    MATCH (e {uuid:$uuid})
    OPTIONAL MATCH (c:Claim)-[r:ARG]->(e)
    OPTIONAL MATCH (c)-[a:ARG]->(other) WHERE other <> e
    RETURN e, collect(DISTINCT {
      claim_uuid: c.uuid,
      predicate: c.predicate,
      created_at: c.created_at,
      confidence: c.confidence,
      description: c.description
    }) AS claims ORDER BY e.uuid;
  `
)

export const _getAll = makeCypher(z.object({}),
  `
    MATCH (e) WHERE e:Person OR e:Event OR e:Concept OR e:Place
    OPTIONAL MATCH (c:Claim)-[:ARG]->(e)
    OPTIONAL MATCH (c)-[a:ARG]->(other)
    WHERE other IS NOT NULL AND other <> e
    WITH count(other) as num, a as a, other as other, e as e, c as c
    WITH collect(DISTINCT CASE num WHEN 0 THEN NULL ELSE { role: a.role, position: a.position, node: other{.*, labels: labels(other)} } END) AS others, e as e, c as c
    WITH e,
         [x IN collect(DISTINCT
              CASE WHEN c IS NULL THEN NULL ELSE
                {
                  claim_uuid:  c.uuid,
                  predicate:   c.predicate,
                  created_at:  c.created_at,
                  confidence:  c.confidence,
                  description: c.description,
                  others:      others
                }
              END
            ) WHERE x IS NOT NULL] AS claims
    RETURN e{.*, labels: labels(e)} AS entity, claims
    ORDER BY toLower(coalesce(entity.name,'')), entity.uuid;
  `,
  z.array(z.object({
    entity: ZResEntity,
    claims: z.array(ZResClaimWithoutArg)
  }))
)

export const getEntities = makeCypher(z.object({}),
  `
    MATCH (e) WHERE e:Person OR e:Event OR e:Concept OR e:Place
    RETURN e{.*,labels:labels(e)} as entity;
  `,
  z.array(z.object({
    entity: ZResEntity
  }))
)

export const getClaims = makeCypher(z.object({}),
  `
    MATCH (c:Claim)-[a:ARG]->(e)
    RETURN c{.*} as claim,collect(a{.*,node_uuid:e.uuid}) AS args
  `,
  z.array(z.object({
    claim: ZResClaimWithoutArg,
    args: z.array(ZResClaimArg)
  }))
)

export default {
  upsertClaim,
  entityFulltextSearch,
  claimFulltextSearch,
  _getEntityClaims,
  _getAll,
  getEntities,
  getClaims, updateEntity, updateClaim, deleteAllClaims
}