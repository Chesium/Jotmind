import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCorsMiddleware, parseAllowedOrigins } from './cors.js';

describe('parseAllowedOrigins', () => {
  it('returns an empty list for unset/empty values (deny by default)', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('splits and trims a comma-separated list', () => {
    expect(parseAllowedOrigins('https://a.example.com, https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('never honors a wildcard origin', () => {
    expect(parseAllowedOrigins('*')).toEqual([]);
    expect(parseAllowedOrigins('https://a.example.com,*')).toEqual(['https://a.example.com']);
  });
});

function appWith(allowedOrigins: string[]) {
  const app = express();
  app.use(createCorsMiddleware({ allowedOrigins }));
  app.get('/thing', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createCorsMiddleware', () => {
  it('echoes the origin and allows credentials for an allowlisted origin', async () => {
    const app = appWith(['https://app.example.com']);
    const res = await request(app).get('/thing').set('Origin', 'https://app.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toContain('Origin');
  });

  it('never responds with a wildcard origin', async () => {
    const app = appWith(['https://app.example.com']);
    const res = await request(app).get('/thing').set('Origin', 'https://app.example.com');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('does not set CORS headers for a disallowed origin', async () => {
    const app = appWith(['https://app.example.com']);
    const res = await request(app).get('/thing').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight from an allowed origin with 204 + CORS headers', async () => {
    const app = appWith(['https://app.example.com']);
    const res = await request(app)
      .options('/thing')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('x-csrf-token');
  });

  it('rejects a preflight from a disallowed origin with 403 and no CORS headers', async () => {
    const app = appWith(['https://app.example.com']);
    const res = await request(app)
      .options('/thing')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects ALL cross-origin preflights when the allowlist is empty', async () => {
    const app = appWith([]);
    const res = await request(app)
      .options('/thing')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('passes through same-origin requests (no Origin header)', async () => {
    const app = appWith([]);
    const res = await request(app).get('/thing');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
