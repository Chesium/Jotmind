import {
  authStateSchema,
  publicUserSchema,
  setupStatusSchema,
  type AccountRole,
  type AuthState,
  type PublicUser,
  type SetupStatus,
} from '@jotmind/schemas';

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${String(res.status)})`;
  } catch {
    return `Request failed (${String(res.status)})`;
  }
}

/** Current authenticated session, or null when not logged in. */
export async function getMe(): Promise<AuthState | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

/** Whether the server still needs first-run admin setup. */
export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/auth/setup-status', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  return setupStatusSchema.parse(await res.json());
}

export async function setupAdmin(email: string, password: string): Promise<AuthState> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

export async function login(email: string, password: string): Promise<AuthState> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return authStateSchema.parse(await res.json());
}

export async function logout(csrfToken: string): Promise<void> {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function createAccount(
  input: { email: string; password: string; role: AccountRole },
  csrfToken: string,
): Promise<PublicUser> {
  const res = await fetch('/api/auth/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return publicUserSchema.parse(await res.json());
}
