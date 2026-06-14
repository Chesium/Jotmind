import type { RequestHandler } from 'express';

/**
 * Parse a comma/whitespace-separated list of allowed CORS origins from an env
 * value (US-033 AC5).
 *
 * Fails closed: an unset/empty value yields an EMPTY allowlist (no cross-origin
 * access), and a literal `*` is ignored — the middleware NEVER allows all
 * origins, which is also incompatible with credentialed (cookie) requests.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');
}

export interface CorsOptions {
  /** Exact-match allowlist of origins (scheme + host + port). */
  allowedOrigins: string[];
}

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'content-type,x-csrf-token';

/**
 * Strict, credential-aware CORS middleware.
 *
 * Only echoes `Access-Control-Allow-Origin` for an origin that EXACTLY matches
 * the configured allowlist; it never responds with `*`. Same-origin
 * deployments (the API serving the built web assets) need no allowlist at all.
 * Cookie auth requires `Access-Control-Allow-Credentials: true` plus an exact
 * origin (the wildcard is forbidden with credentials), which this enforces.
 */
export function createCorsMiddleware({ allowedOrigins }: CorsOptions): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    const isAllowed = typeof origin === 'string' && allowed.has(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
    }
    // Always vary on Origin so caches don't serve a CORS response to a
    // different origin.
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      // Preflight: allowed origins get 204 (with the CORS headers set above);
      // everything else is rejected without CORS headers.
      res.status(isAllowed ? 204 : 403).end();
      return;
    }
    next();
  };
}
