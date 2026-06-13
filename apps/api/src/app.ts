import express, { type Express } from 'express';
import { healthStatusSchema, parseOrThrow, type HealthStatus } from '@jotmind/schemas';

export const SERVICE_NAME = 'jotmind-api';
export const SERVICE_VERSION = '0.0.0';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const payload: HealthStatus = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    };
    // Validate outgoing response against the shared schema.
    res.json(parseOrThrow(healthStatusSchema, payload));
  });

  return app;
}
