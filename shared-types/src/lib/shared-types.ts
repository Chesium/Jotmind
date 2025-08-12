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

import { v4 as uuidv4 } from 'uuid';
export type Entity = EntityDTO

// FIXME currently we cannot edit the newly created entity's claims since
// it's not registered in the claim-args-node_uuid field 
export function defaultEntity(): z.infer<typeof ZEntityDTO2> {
  return {
    type: "Person",
    uuid: uuidv4(),
    name: "",
    description: ""
  }
}

export type NodeType = "Person" | "Place" | "Event" | "Concept";

export function toNodeType(value: string): NodeType {
  const allowed: NodeType[] = ["Person", "Place", "Event", "Concept"];
  if (!allowed.includes(value as NodeType)) {
    throw new Error(`Invalid node type: ${value}`);
  }
  return value as NodeType;
}

export type ClaimArg = ClaimArgDTO

export type Claim = ClaimDTO

export const ZClaimDTO = z.object({
  args: z.array(ZClaimArgDTO),
  uuid: z.string().optional(), // undefined => new Claim
  description: z.string(),
  predicate: z.string(),
  confidence: z.number(),
  value_str: z.string().optional(),
})

export const ZEntityDTO = z.object({
  type: z.enum(["Person", "Place", "Event", "Concept"]),
  uuid: z.string().optional(), // undefined => new Entity
  name: z.string(),
  description: z.string()
})

export const ZFormSchema = z.object({
  entity: ZEntityDTO,
  claims: z.array(ZClaimDTO)
})




export type EntityDTO = z.infer<typeof ZEntityDTO>;
export type ClaimDTO = z.infer<typeof ZClaimDTO>;
export type ClaimArgDTO = z.infer<typeof ZClaimArgDTO>;
export type FormValues = z.infer<typeof ZFormSchema>;

export function WithUUID(data: FormValues): UpdateData {
  return {
    entity: { uuid: data.entity.uuid ?? uuidv4(), ...data.entity },
    claims: data.claims.map(claim => {
      return {
        uuid: claim.uuid ?? uuidv4(),
        value_str: claim.value_str ?? "",
        ...claim
      }
    }),
  }
}