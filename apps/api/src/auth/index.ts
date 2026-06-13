import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  authStateSchema,
  createAccountSchema,
  credentialsSchema,
  publicUserSchema,
  setupStatusSchema,
  type AccountRole,
  type PublicUser,
} from '@jotmind/schemas';
import type { SessionRow, UserRow } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';
import { dbAuthStore, type AuthStore } from './store.js';

export { hashPassword, verifyPassword } from './password.js';
export type { AuthStore } from './store.js';
export { dbAuthStore } from './store.js';

const SESSION_COOKIE = 'jm_session';
const CSRF_COOKIE = 'jm_csrf';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Authenticated request context attached by `requireAuth`. */
export interface AuthContext {
  user: UserRow;
  session: SessionRow;
}

// Augment Express's Request so handlers can read the authenticated context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function toPublicUser(row: UserRow): PublicUser {
  return publicUserSchema.parse({
    id: row.id,
    email: row.email,
    role: row.role as AccountRole,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Wrap an async handler so rejected promises reach Express error handling. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Create a session row + set the HTTP-only session and CSRF cookies. */
async function issueSession(store: AuthStore, res: Response, user: UserRow): Promise<string> {
  const id = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await store.createSession({ id, userId: user.id, csrfToken, expiresAt });

  const secure = cookieSecure();
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  // CSRF cookie is intentionally readable by JS (not HttpOnly) so the SPA can
  // echo it back in the x-csrf-token header (synchronizer-token pattern).
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return csrfToken;
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Resolve the authenticated context from the session cookie, if valid. */
async function authenticate(store: AuthStore, req: Request): Promise<AuthContext | undefined> {
  const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!sessionId) return undefined;

  const session = await store.getSession(sessionId);
  if (!session) return undefined;

  if (session.expiresAt.getTime() <= Date.now()) {
    await store.deleteSession(session.id);
    return undefined;
  }

  const user = await store.getUserById(session.userId);
  if (!user) return undefined;

  return { user, session };
}

export function requireAuth(store: AuthStore): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const ctx = await authenticate(store, req);
    if (!ctx) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.auth = ctx;
    next();
  });
}

/** CSRF guard for cookie-authenticated mutations (synchronizer-token check). */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('x-csrf-token');
  const expected = req.auth?.session.csrfToken;
  if (!header || !expected || !safeEqual(header, expected)) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next();
}

/** Require the authenticated account to have the system `admin` role. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin privileges required' });
    return;
  }
  next();
}

export interface AuthRouterOptions {
  store?: AuthStore;
}

/**
 * Build the `/api/auth` router. Accepts an injectable store so unit tests can
 * supply an in-memory implementation without a live PostgreSQL connection.
 */
export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const store = options.store ?? dbAuthStore;
  const router = Router();

  // Whether first-run setup is still required (no accounts exist yet).
  router.get(
    '/setup-status',
    asyncHandler(async (_req, res) => {
      const count = await store.countUsers();
      res.json(setupStatusSchema.parse({ setupRequired: count === 0 }));
    }),
  );

  // First-run setup: create the initial admin. Only allowed when no users exist.
  router.post(
    '/setup',
    asyncHandler(async (req, res) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid email or password' });
        return;
      }
      if ((await store.countUsers()) > 0) {
        res.status(409).json({ error: 'Setup has already been completed' });
        return;
      }
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await store.createUser({
        email: parsed.data.email,
        passwordHash,
        role: 'admin',
      });
      const csrfToken = await issueSession(store, res, user);
      res.status(201).json(authStateSchema.parse({ user: toPublicUser(user), csrfToken }));
    }),
  );

  // Login: verify credentials and start a session.
  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid email or password' });
        return;
      }
      const user = await store.getUserByEmail(parsed.data.email);
      // Always run a verification to reduce user-enumeration timing signal.
      const ok = user
        ? await verifyPassword(user.passwordHash, parsed.data.password)
        : await verifyPassword(
            '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA',
            parsed.data.password,
          );
      if (!user || !ok) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      const csrfToken = await issueSession(store, res, user);
      res.json(authStateSchema.parse({ user: toPublicUser(user), csrfToken }));
    }),
  );

  // Current authenticated user + a fresh CSRF token for the SPA.
  router.get('/me', requireAuth(store), (req, res) => {
    const ctx = req.auth as AuthContext;
    res.json(
      authStateSchema.parse({
        user: toPublicUser(ctx.user),
        csrfToken: ctx.session.csrfToken,
      }),
    );
  });

  // Logout: destroy the session (CSRF-protected mutation).
  router.post(
    '/logout',
    requireAuth(store),
    requireCsrf,
    asyncHandler(async (req, res) => {
      const ctx = req.auth as AuthContext;
      await store.deleteSession(ctx.session.id);
      clearAuthCookies(res);
      res.status(204).end();
    }),
  );

  // Admin-controlled account creation (after first-run setup).
  router.post(
    '/users',
    requireAuth(store),
    requireAdmin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid account details' });
        return;
      }
      if (await store.getUserByEmail(parsed.data.email)) {
        res.status(409).json({ error: 'An account with that email already exists' });
        return;
      }
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await store.createUser({
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
      });
      res.status(201).json(toPublicUser(user));
    }),
  );

  return router;
}
