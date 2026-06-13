import { z } from 'zod';

/**
 * System-level account role. Knowledge-Base-scoped roles (owner/admin/editor/
 * viewer) arrive in US-004 and are separate from this server account role.
 * `admin` accounts may create other accounts; `member` accounts cannot.
 */
export const accountRoleSchema = z.enum(['admin', 'member']);
export type AccountRole = z.infer<typeof accountRoleSchema>;

/** Email + password used for first-run setup and login. */
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(256),
});
export type Credentials = z.infer<typeof credentialsSchema>;

/** Admin-controlled account creation payload (after first-run setup). */
export const createAccountSchema = credentialsSchema.extend({
  role: accountRoleSchema.default('member'),
});
export type CreateAccount = z.infer<typeof createAccountSchema>;

/** Public-safe representation of a user account (never includes the hash). */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: accountRoleSchema,
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Whether the server still needs first-run admin setup (no users exist). */
export const setupStatusSchema = z.object({
  setupRequired: z.boolean(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

/**
 * Authenticated session state returned to the browser. `csrfToken` must be
 * echoed back in the `x-csrf-token` header on cookie-authenticated mutations.
 */
export const authStateSchema = z.object({
  user: publicUserSchema,
  csrfToken: z.string().min(1),
});
export type AuthState = z.infer<typeof authStateSchema>;
