import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { healthStatusSchema } from '@jotmind/schemas';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns a schema-valid health status', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(() => healthStatusSchema.parse(res.body)).not.toThrow();
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('jotmind-api');
  });
});
