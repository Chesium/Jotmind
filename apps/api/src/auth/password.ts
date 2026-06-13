import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Algorithm.Argon2id === 2. We reference it numerically because the enum is an
// ambient const enum, which cannot be value-imported under verbatimModuleSyntax.
const ARGON2ID: Algorithm = 2 as Algorithm;

/**
 * Argon2id parameters. These match the @node-rs/argon2 defaults (OWASP-aligned)
 * but are pinned explicitly so the hashing cost is deterministic and auditable.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password with Argon2id. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against an Argon2id hash. Returns false (rather
 * than throwing) on malformed hashes so callers can treat it as a failed login.
 */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
