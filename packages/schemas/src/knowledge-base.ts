import { z } from 'zod';

/**
 * Knowledge-Base-scoped roles (US-004). These are separate from the system
 * account role (`admin`/`member`) in `auth.ts`: a `member` account can still be
 * an `owner` of a Knowledge Base they create. Ordered least → most privileged.
 */
export const KB_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export const kbRoleSchema = z.enum(KB_ROLES);
export type KbRole = z.infer<typeof kbRoleSchema>;

/**
 * Numeric privilege rank for each Knowledge Base role. Higher rank = more
 * privileged. Used by backend middleware to enforce "at least role X" checks.
 */
export const KB_ROLE_RANK: Record<KbRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/** True when `role` is at least as privileged as `required`. */
export function kbRoleSatisfies(role: KbRole, required: KbRole): boolean {
  return KB_ROLE_RANK[role] >= KB_ROLE_RANK[required];
}

/** Payload to create a new Knowledge Base. The creator becomes its owner. */
export const createKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export type CreateKnowledgeBase = z.infer<typeof createKnowledgeBaseSchema>;

/** A Knowledge Base record, annotated with the requesting user's role. */
export const knowledgeBaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().uuid(),
  role: kbRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

/** A list of Knowledge Bases (as returned by `GET /api/knowledge-bases`). */
export const knowledgeBaseListSchema = z.array(knowledgeBaseSchema);

/** A member of a Knowledge Base together with their role. */
export const kbMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: kbRoleSchema,
  createdAt: z.string().datetime(),
});
export type KbMember = z.infer<typeof kbMemberSchema>;

/** Assign (or change) a user's role within a Knowledge Base. */
export const assignKbRoleSchema = z.object({
  userId: z.string().uuid(),
  role: kbRoleSchema,
});
export type AssignKbRole = z.infer<typeof assignKbRoleSchema>;

/** An audit event recording a Knowledge-Base-scoped change. */
export const auditEventSchema = z.object({
  id: z.string().uuid(),
  knowledgeBaseId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
