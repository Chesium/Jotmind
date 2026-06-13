import { and, desc, eq } from 'drizzle-orm';
import type { KbRole } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import {
  auditEvents,
  knowledgeBaseMembers,
  knowledgeBases,
  users,
  type AuditEventRow,
  type KnowledgeBaseRow,
} from '../db/schema.js';

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string;
  createdBy: string;
}

/** A Knowledge Base joined with the requesting user's role within it. */
export interface KnowledgeBaseWithRole extends KnowledgeBaseRow {
  role: KbRole;
}

/** A Knowledge Base member joined with their account email. */
export interface KbMemberRecord {
  userId: string;
  email: string;
  role: KbRole;
  createdAt: Date;
}

export interface AssignRoleInput {
  knowledgeBaseId: string;
  userId: string;
  role: KbRole;
  actorUserId: string;
}

/**
 * Persistence boundary for Knowledge Bases, memberships, and audit events.
 * Defined as an interface so route handlers can run against an in-memory fake
 * in unit tests (no live DB) while production uses the PostgreSQL-backed impl.
 */
export interface KnowledgeBaseStore {
  createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseWithRole>;
  listForUser(userId: string): Promise<KnowledgeBaseWithRole[]>;
  getForUser(id: string, userId: string): Promise<KnowledgeBaseWithRole | undefined>;
  getRole(knowledgeBaseId: string, userId: string): Promise<KbRole | undefined>;
  listMembers(knowledgeBaseId: string): Promise<KbMemberRecord[]>;
  userExists(userId: string): Promise<boolean>;
  assignRole(input: AssignRoleInput): Promise<KbMemberRecord>;
  listAuditEvents(knowledgeBaseId: string): Promise<AuditEventRow[]>;
}

/** PostgreSQL-backed KnowledgeBaseStore. Resolves the Drizzle client per call. */
export const dbKnowledgeBaseStore: KnowledgeBaseStore = {
  async createKnowledgeBase(input) {
    return getDb().transaction(async (tx) => {
      const kbRows = await tx
        .insert(knowledgeBases)
        .values({
          name: input.name,
          description: input.description ?? null,
          createdBy: input.createdBy,
        })
        .returning();
      const kb = kbRows[0];
      if (!kb) throw new Error('Failed to create knowledge base');

      await tx.insert(knowledgeBaseMembers).values({
        knowledgeBaseId: kb.id,
        userId: input.createdBy,
        role: 'owner',
      });

      await tx.insert(auditEvents).values([
        {
          knowledgeBaseId: kb.id,
          actorUserId: input.createdBy,
          action: 'knowledge_base.created',
          targetType: 'knowledge_base',
          targetId: kb.id,
          metadata: { name: kb.name },
        },
        {
          knowledgeBaseId: kb.id,
          actorUserId: input.createdBy,
          action: 'knowledge_base.role_assigned',
          targetType: 'user',
          targetId: input.createdBy,
          metadata: { role: 'owner' },
        },
      ]);

      return { ...kb, role: 'owner' as KbRole };
    });
  },

  async listForUser(userId) {
    const rows = await getDb()
      .select({ kb: knowledgeBases, role: knowledgeBaseMembers.role })
      .from(knowledgeBaseMembers)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, knowledgeBaseMembers.knowledgeBaseId))
      .where(eq(knowledgeBaseMembers.userId, userId))
      .orderBy(desc(knowledgeBases.createdAt));
    return rows.map((r) => ({ ...r.kb, role: r.role as KbRole }));
  },

  async getForUser(id, userId) {
    const rows = await getDb()
      .select({ kb: knowledgeBases, role: knowledgeBaseMembers.role })
      .from(knowledgeBaseMembers)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, knowledgeBaseMembers.knowledgeBaseId))
      .where(
        and(eq(knowledgeBaseMembers.knowledgeBaseId, id), eq(knowledgeBaseMembers.userId, userId)),
      )
      .limit(1);
    const row = rows[0];
    return row ? { ...row.kb, role: row.role as KbRole } : undefined;
  },

  async getRole(knowledgeBaseId, userId) {
    const rows = await getDb()
      .select({ role: knowledgeBaseMembers.role })
      .from(knowledgeBaseMembers)
      .where(
        and(
          eq(knowledgeBaseMembers.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseMembers.userId, userId),
        ),
      )
      .limit(1);
    return rows[0]?.role as KbRole | undefined;
  },

  async listMembers(knowledgeBaseId) {
    const rows = await getDb()
      .select({
        userId: knowledgeBaseMembers.userId,
        email: users.email,
        role: knowledgeBaseMembers.role,
        createdAt: knowledgeBaseMembers.createdAt,
      })
      .from(knowledgeBaseMembers)
      .innerJoin(users, eq(users.id, knowledgeBaseMembers.userId))
      .where(eq(knowledgeBaseMembers.knowledgeBaseId, knowledgeBaseId))
      .orderBy(knowledgeBaseMembers.createdAt);
    return rows.map((r) => ({ ...r, role: r.role as KbRole }));
  },

  async userExists(userId) {
    const rows = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows.length > 0;
  },

  async assignRole(input) {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(knowledgeBaseMembers)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          userId: input.userId,
          role: input.role,
        })
        .onConflictDoUpdate({
          target: [knowledgeBaseMembers.knowledgeBaseId, knowledgeBaseMembers.userId],
          set: { role: input.role, updatedAt: new Date() },
        })
        .returning();
      const member = rows[0];
      if (!member) throw new Error('Failed to assign role');

      await tx.insert(auditEvents).values({
        knowledgeBaseId: input.knowledgeBaseId,
        actorUserId: input.actorUserId,
        action: 'knowledge_base.role_assigned',
        targetType: 'user',
        targetId: input.userId,
        metadata: { role: input.role },
      });

      const userRows = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      return {
        userId: member.userId,
        email: userRows[0]?.email ?? '',
        role: member.role as KbRole,
        createdAt: member.createdAt,
      };
    });
  },

  async listAuditEvents(knowledgeBaseId) {
    return getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.knowledgeBaseId, knowledgeBaseId))
      .orderBy(desc(auditEvents.createdAt));
  },
};
