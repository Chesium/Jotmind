import {
  authStateSchema,
  entityListSchema,
  entitySchema,
  knowledgeBaseListSchema,
  knowledgeBaseSchema,
  publicUserSchema,
  setupStatusSchema,
  type AccountRole,
  type AuthState,
  type CreateEntity,
  type Entity,
  type KnowledgeBase,
  type PublicUser,
  type SetupStatus,
  type UpdateEntity,
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

/** List Knowledge Bases the current user is a member of. */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetch('/api/knowledge-bases', { credentials: 'include' });
  if (!res.ok) throw new Error(await errorMessage(res));
  return knowledgeBaseListSchema.parse(await res.json());
}

/** Create a Knowledge Base; the current user becomes its owner. */
export async function createKnowledgeBase(
  input: { name: string; description?: string },
  csrfToken: string,
): Promise<KnowledgeBase> {
  const res = await fetch('/api/knowledge-bases', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return knowledgeBaseSchema.parse(await res.json());
}

/** List entities in a Knowledge Base. */
export async function listEntities(knowledgeBaseId: string): Promise<Entity[]> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entityListSchema.parse(await res.json());
}

/** Create an entity in a Knowledge Base (editor+). */
export async function createEntity(
  knowledgeBaseId: string,
  input: CreateEntity,
  csrfToken: string,
): Promise<Entity> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entitySchema.parse(await res.json());
}

/** Edit an entity in a Knowledge Base (editor+). */
export async function updateEntity(
  knowledgeBaseId: string,
  entityId: string,
  input: UpdateEntity,
  csrfToken: string,
): Promise<Entity> {
  const res = await fetch(`/api/knowledge-bases/${knowledgeBaseId}/entities/${entityId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return entitySchema.parse(await res.json());
}
