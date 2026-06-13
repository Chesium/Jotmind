import { eq, sql } from 'drizzle-orm';
import type { AccountRole } from '@jotmind/schemas';
import { getDb } from '../db/client.js';
import { sessions, users, type SessionRow, type UserRow } from '../db/schema.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: AccountRole;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Persistence boundary for accounts and sessions. Defining it as an interface
 * lets route handlers run against an in-memory fake in unit tests (no live DB)
 * while production uses the PostgreSQL-backed implementation below.
 */
export interface AuthStore {
  countUsers(): Promise<number>;
  getUserById(id: string): Promise<UserRow | undefined>;
  getUserByEmail(email: string): Promise<UserRow | undefined>;
  createUser(input: CreateUserInput): Promise<UserRow>;
  createSession(input: CreateSessionInput): Promise<SessionRow>;
  getSession(id: string): Promise<SessionRow | undefined>;
  deleteSession(id: string): Promise<void>;
}

/** PostgreSQL-backed AuthStore. Resolves the Drizzle client lazily per call. */
export const dbAuthStore: AuthStore = {
  async countUsers() {
    const rows = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    return rows[0]?.count ?? 0;
  },

  async getUserById(id) {
    const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  },

  async getUserByEmail(email) {
    const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  },

  async createUser(input) {
    const rows = await getDb()
      .insert(users)
      .values({ email: input.email, passwordHash: input.passwordHash, role: input.role })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create user');
    return row;
  },

  async createSession(input) {
    const rows = await getDb()
      .insert(sessions)
      .values({
        id: input.id,
        userId: input.userId,
        csrfToken: input.csrfToken,
        expiresAt: input.expiresAt,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create session');
    return row;
  },

  async getSession(id) {
    const rows = await getDb().select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return rows[0];
  },

  async deleteSession(id) {
    await getDb().delete(sessions).where(eq(sessions.id, id));
  },
};
