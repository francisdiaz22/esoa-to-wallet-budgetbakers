import { describe, expect, it } from 'vitest';
import { app, healthState } from './app.js';

describe('local service', () => {
  it('defines a privacy-safe health state without opening a socket', () => {
    expect(healthState).toEqual({
      status: 'ok',
      storage: 'ephemeral',
      telemetry: false,
    });
    expect(app.get('x-powered-by')).toBe(false);
  });
});
