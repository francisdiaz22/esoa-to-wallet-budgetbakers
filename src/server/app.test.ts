import { describe, expect, it } from 'vitest';
import request from 'supertest';
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

  it('rejects non-loopback Host and Origin headers', async () => {
    expect(
      (await request(app).get('/api/health').set('Host', 'evil.test')).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/health')
          .set('Host', '127.0.0.1:4310')
          .set('Origin', 'https://evil.test')
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/health')
          .set('Host', '127.0.0.1:4310')
          .set('Origin', 'http://localhost:4300')
      ).status,
    ).toBe(200);
  });
});
