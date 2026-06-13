import express, { type Express } from 'express';
import {
  healthStatusSchema,
  parseOrThrow,
  type DatabaseHealth,
  type HealthStatus,
} from '@jotmind/schemas';
import { checkDatabaseHealth, isDatabaseHealthy } from './db/health.js';

export const SERVICE_NAME = 'jotmind-api';
export const SERVICE_VERSION = '0.0.0';

export interface AppOptions {
  /**
   * Database health probe. Injectable so unit tests can supply a deterministic
   * result without a live PostgreSQL connection. Defaults to the real probe.
   */
  checkDatabase?: () => Promise<DatabaseHealth>;
}

export function createApp(options: AppOptions = {}): Express {
  const { checkDatabase = checkDatabaseHealth } = options;
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res, next) => {
    void (async () => {
      try {
        const database = await checkDatabase();
        const payload: HealthStatus = {
          status: isDatabaseHealthy(database) ? 'ok' : 'degraded',
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          timestamp: new Date().toISOString(),
          database,
        };
        // Validate outgoing response against the shared schema.
        res.json(parseOrThrow(healthStatusSchema, payload));
      } catch (err) {
        next(err);
      }
    })();
  });

  return app;
}
