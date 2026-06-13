import { describe, expect, it } from 'vitest';
import { healthStatusSchema, parseOrThrow } from './index.js';

describe('healthStatusSchema', () => {
  it('accepts a valid health status', () => {
    const value = {
      status: 'ok',
      service: 'api',
      version: '0.0.0',
      timestamp: new Date().toISOString(),
    };
    expect(() => parseOrThrow(healthStatusSchema, value)).not.toThrow();
  });

  it('rejects an invalid status', () => {
    const value = {
      status: 'broken',
      service: 'api',
      version: '0.0.0',
      timestamp: new Date().toISOString(),
    };
    expect(() => parseOrThrow(healthStatusSchema, value)).toThrow(/Validation failed/);
  });
});
