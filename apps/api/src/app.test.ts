import { describe, expect, it } from 'vitest';
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
