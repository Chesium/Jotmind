import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authStateSchema, publicUserSchema, setupStatusSchema } from '@jotmind/schemas';
import { createApp } from '../app.js';
import type { SessionRow, UserRow } from '../db/schema.js';
import { hashPassword, verifyPassword, type AuthStore } from './index.js';

function createMemoryStore(): AuthStore {
  const usersById = new Map<string, UserRow>();
  const usersByEmail = new Map<string, UserRow>();
  const sessionsById = new Map<string, SessionRow>();

  return {
    countUsers: () => Promise.resolve(usersById.size),
    getUserById: (id) => Promise.resolve(usersById.get(id)),
    getUserByEmail: (email) => Promise.resolve(usersByEmail.get(email)),
    createUser: ({ email, passwordHash, role }) => {
      const now = new Date();
      const row: UserRow = {
        id: randomUUID(),
        email,
        passwordHash,
        role,
        createdAt: now,
        updatedAt: now,
      };
      usersById.set(row.id, row);
      usersByEmail.set(email, row);
      return Promise.resolve(row);
    },
    createSession: ({ id, userId, csrfToken, expiresAt }) => {
      const row: SessionRow = { id, userId, csrfToken, expiresAt, createdAt: new Date() };
      sessionsById.set(id, row);
      return Promise.resolve(row);
    },
    getSession: (id) => Promise.resolve(sessionsById.get(id)),
    deleteSession: (id) => {
      sessionsById.delete(id);
      return Promise.resolve();
    },
  };
}

const ADMIN = { email: 'admin@example.com', password: 'sup3rsecret!' };

describe('auth: password hashing', () => {
  it('hashes with Argon2id and verifies round-trip', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('returns false (does not throw) for malformed hashes', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('auth: first-run setup', () => {
  let store: AuthStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = createMemoryStore();
    app = createApp({ authStore: store });
  });

  it('reports setup required when no users exist', async () => {
    const res = await request(app).get('/api/auth/setup-status');
    expect(res.status).toBe(200);
    expect(setupStatusSchema.parse(res.body).setupRequired).toBe(true);
  });

  it('creates the initial admin and starts a session', async () => {
    const res = await request(app).post('/api/auth/setup').send(ADMIN);
    expect(res.status).toBe(201);
    const state = authStateSchema.parse(res.body);
    expect(state.user.email).toBe(ADMIN.email);
    expect(state.user.role).toBe('admin');
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toMatch(/jm_session=/);
    expect(cookies).toMatch(/HttpOnly/i);

    const status = await request(app).get('/api/auth/setup-status');
    expect(setupStatusSchema.parse(status.body).setupRequired).toBe(false);
  });

  it('rejects a second setup once an admin exists', async () => {
    await request(app).post('/api/auth/setup').send(ADMIN);
    const res = await request(app).post('/api/auth/setup').send({
      email: 'other@example.com',
      password: 'anotherpass1',
    });
    expect(res.status).toBe(409);
  });

  it('rejects setup with an invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: ADMIN.email, password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('auth: login and session', () => {
  let store: AuthStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = createMemoryStore();
    app = createApp({ authStore: store });
    await request(app).post('/api/auth/setup').send(ADMIN);
  });

  it('rejects wrong credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'wrongpass1' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown user without leaking existence', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever12' });
    expect(res.status).toBe(401);
  });

  it('logs in and returns the authenticated user via /me', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send(ADMIN);
    expect(login.status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(authStateSchema.parse(me.body).user.email).toBe(ADMIN.email);
  });

  it('rejects /me without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('auth: CSRF and admin-controlled account creation', () => {
  let store: AuthStore;
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeEach(async () => {
    store = createMemoryStore();
    app = createApp({ authStore: store });
    agent = request.agent(app);
    const setup = await agent.post('/api/auth/setup').send(ADMIN);
    csrfToken = authStateSchema.parse(setup.body).csrfToken;
  });

  it('blocks mutations without a CSRF header', async () => {
    const res = await agent.post('/api/auth/users').send({
      email: 'new@example.com',
      password: 'newpass123',
      role: 'member',
    });
    expect(res.status).toBe(403);
  });

  it('allows an admin to create an account with a valid CSRF token', async () => {
    const res = await agent
      .post('/api/auth/users')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'new@example.com', password: 'newpass123', role: 'member' });
    expect(res.status).toBe(201);
    expect(publicUserSchema.parse(res.body).email).toBe('new@example.com');
  });

  it('rejects duplicate account emails', async () => {
    await agent
      .post('/api/auth/users')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'dup@example.com', password: 'newpass123', role: 'member' });
    const res = await agent
      .post('/api/auth/users')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'dup@example.com', password: 'newpass123', role: 'member' });
    expect(res.status).toBe(409);
  });

  it('forbids non-admin members from creating accounts', async () => {
    // Admin creates a member.
    await agent
      .post('/api/auth/users')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'member@example.com', password: 'memberpass1', role: 'member' });

    const memberAgent = request.agent(app);
    const login = await memberAgent
      .post('/api/auth/login')
      .send({ email: 'member@example.com', password: 'memberpass1' });
    const memberCsrf = authStateSchema.parse(login.body).csrfToken;

    const res = await memberAgent
      .post('/api/auth/users')
      .set('x-csrf-token', memberCsrf)
      .send({ email: 'another@example.com', password: 'anotherpass1', role: 'member' });
    expect(res.status).toBe(403);
  });

  it('logs out (with CSRF) and invalidates the session', async () => {
    const noCsrf = await agent.post('/api/auth/logout');
    expect(noCsrf.status).toBe(403);

    const res = await agent.post('/api/auth/logout').set('x-csrf-token', csrfToken);
    expect(res.status).toBe(204);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});
