import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { healthStatusSchema, type DatabaseHealth } from '@jotmind/schemas';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns a schema-valid health status', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(() => healthStatusSchema.parse(res.body)).not.toThrow();
    expect(res.body.service).toBe('jotmind-api');
  });

  it('reports ok with a healthy database and required extensions', async () => {
    const database: DatabaseHealth = {
      configured: true,
      connected: true,
      extensions: { age: true, vector: true },
    };
    const app = createApp({ checkDatabase: () => Promise.resolve(database) });
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toEqual(database);
  });

  it('reports ok when the database is not configured', async () => {
    const database: DatabaseHealth = {
      configured: false,
      connected: false,
      extensions: { age: false, vector: false },
    };
    const app = createApp({ checkDatabase: () => Promise.resolve(database) });
    const res = await request(app).get('/api/health');

    expect(res.body.status).toBe('ok');
    expect(res.body.database.configured).toBe(false);
  });

  it('reports degraded when a required extension is missing', async () => {
    const database: DatabaseHealth = {
      configured: true,
      connected: true,
      extensions: { age: true, vector: false },
    };
    const app = createApp({ checkDatabase: () => Promise.resolve(database) });
    const res = await request(app).get('/api/health');

    expect(res.body.status).toBe('degraded');
  });

  it('reports degraded when the database is unreachable', async () => {
    const database: DatabaseHealth = {
      configured: true,
      connected: false,
      extensions: { age: false, vector: false },
      error: 'connection refused',
    };
    const app = createApp({ checkDatabase: () => Promise.resolve(database) });
    const res = await request(app).get('/api/health');

    expect(res.body.status).toBe('degraded');
    expect(res.body.database.error).toBe('connection refused');
  });
});

describe('CORS (US-033)', () => {
  it('does not set CORS headers by default (deny-by-default allowlist)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health').set('Origin', 'https://app.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes an allowlisted origin and allows credentials', async () => {
    const app = createApp({ allowedOrigins: ['https://app.example.com'] });
    const res = await request(app).get('/api/health').set('Origin', 'https://app.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('unknown /api routes (US-033)', () => {
  it('returns a JSON 404 (not swallowed by the SPA fallback)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('static web asset serving (US-033)', () => {
  let webDistPath: string;

  beforeAll(() => {
    webDistPath = mkdtempSync(path.join(tmpdir(), 'jotmind-web-'));
    writeFileSync(path.join(webDistPath, 'index.html'), '<!doctype html><title>JotMind</title>');
    writeFileSync(path.join(webDistPath, 'app.js'), 'console.log("app");');
  });

  afterAll(() => {
    rmSync(webDistPath, { recursive: true, force: true });
  });

  it('serves a built static asset', async () => {
    const app = createApp({ webDistPath });
    const res = await request(app).get('/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
  });

  it('falls back to index.html for client-side routes', async () => {
    const app = createApp({ webDistPath });
    const res = await request(app).get('/some/spa/route');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>JotMind</title>');
  });

  it('does not serve index.html for unknown /api routes', async () => {
    const app = createApp({ webDistPath });
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('still serves the API health route when static serving is enabled', async () => {
    const app = createApp({ webDistPath });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('jotmind-api');
  });
});
