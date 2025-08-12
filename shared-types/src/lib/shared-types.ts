export function sharedTypes(): string {
  return 'shared-types';
}

import z from "zod"

export const ZEntityType = z.enum(["Person", "Event", "Concept", "Place"]);
export type EntityType = z.infer<typeof ZEntityType>

// 查询所得的 Entity Type
export const ZResEntity = z.object({
  description: z.string(),
  labels: z.array(ZEntityType).length(1),
  name: z.string(),
  uuid: z.string(),
})

export const ZResEntityWithoutLabel = z.object({
  description: z.string(),
  name: z.string(),
  uuid: z.string(),
})

export type ResEntity = z.infer<typeof ZResEntity>

export const ZResClaimArg = z.object({
  position: z.coerce.number(),
  node_uuid: z.string(),
  role: z.string(),
})
export type ResClaimArg = z.infer<typeof ZResClaimArg>

export const ZResClaimWithoutArg = z.object({
  // others: z.array(ZResClaimArg),
  description: z.string(),
  predicate: z.string(),
  created_at: z.object({
    year: z.string(),
    month: z.string(),
    day: z.string(),
  }),
  confidence: z.number(),
  uuid: z.string(),
  value_str: z.string().optional(),
})
export type ResClaimWithoutArg = z.infer<typeof ZResClaimWithoutArg>

export const ZResClaim = z.object({
  args: z.array(ZResClaimArg),
  description: z.string(),
  predicate: z.string(),
  created_at: z.object({
    year: z.string(),
    month: z.string(),
    day: z.string(),
  }),
  confidence: z.number(),
  uuid: z.string(),
  value_str: z.string().optional(),
})
export type ResClaim = z.infer<typeof ZResClaim>

export const ZResAll = z.object({
  entities: z.array(ZResEntity),
  claims: z.array(ZResClaim),
})
export type ResAll = z.infer<typeof ZResAll>

export const ZClaimArgDTO = z.object({
  role: z.string(),
  node_uuid: z.string(),
  position: z.number().int(),
})

export const ZClaimDTO2 = z.object({
  args: z.array(ZClaimArgDTO),
  uuid: z.string(),
  description: z.string(),
  predicate: z.string(),
  confidence: z.number(),
  value_str: z.string(),
})

export const ZEntityDTO2 = z.object({
  type: z.enum(["Person", "Place", "Event", "Concept"]),
  uuid: z.string(),
  name: z.string(),
  description: z.string()
})

export const ZUpdateData = z.object({
  entity: ZEntityDTO2,
  claims: z.array(ZClaimDTO2)
})

export type UpdateData = z.infer<typeof ZUpdateData>