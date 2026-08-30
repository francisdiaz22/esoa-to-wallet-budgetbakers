/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, vi } from 'vitest';
import { WalletClient, FakeWalletClient, assertNotBrowser } from './client.js';
import { LIMITS } from '../ingestion/limits.js';

describe('wallet client', () => {
  it('fixed origin is enforced', () => {
    expect(() => new WalletClient('https://evil.com/wallet')).toThrow();
    expect(() => new WalletClient(LIMITS.WALLET_BASE_URL)).not.toThrow();
  });
  it('assertNotBrowser proves server-only', () => {
    expect(assertNotBrowser()).toBe(true);
  });
  it('fake client does not contact browser wallet', async () => {
    const fake = new FakeWalletClient({
      accounts: [{ id: 'a1', name: 'Main', currency: 'PHP', writable: true }],
      categories: [{ id: 'c1', name: 'Food' }],
    });
    const token = 'test-token-1234567890';
    const cat = await fake.fetchCatalog(token);
    expect(cat.accounts.length).toBe(1);
    expect(fake.capturedTokens[0]).toBe(token);
  });
  it('handles pagination limits and malformed body', async () => {
    // Use real WalletClient with mocked fetch
    const originalFetch = global.fetch;
    // Mock fetch to return malformed JSON for accounts
    // @ts-expect-error
    global.fetch = vi.fn(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = new WalletClient();
    await expect(client.listAccounts('tok-1234567890')).rejects.toMatchObject({
      code: 'malformed_response',
    });
    global.fetch = originalFetch;
  });
  it('handles 401/403 as unauthorized, 409 initial_sync, 429 rate_limited', async () => {
    const originalFetch = global.fetch;
    async function testStatus(status: number, expectedCode: string) {
      // @ts-expect-error
      global.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status,
            headers: status === 429 ? { 'Retry-After': '5' } : {},
          }),
      );
      const client = new WalletClient();
      try {
        await client.listAccounts('tok-1234567890');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as Error & { code?: string }).code).toBe(expectedCode);
      }
    }
    await testStatus(401, 'unauthorized');
    await testStatus(403, 'unauthorized');
    await testStatus(409, 'initial_sync_pending');
    await testStatus(429, 'rate_limited');
    global.fetch = originalFetch;
  });
  it('rejects redirect', async () => {
    const originalFetch = global.fetch;
    // @ts-expect-error
    global.fetch = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { Location: 'https://evil.com' },
        }),
    );
    const client = new WalletClient();
    await expect(client.listAccounts('tok-1234567890')).rejects.toMatchObject({
      code: 'unavailable',
    });
    global.fetch = originalFetch;
  });
  it('enforces response size bound', async () => {
    const originalFetch = global.fetch;
    const big = 'x'.repeat(LIMITS.MAX_WALLET_RESPONSE_BYTES + 1);
    // @ts-expect-error
    global.fetch = vi.fn(async () => new Response(big, { status: 200 }));
    const client = new WalletClient();
    await expect(client.listAccounts('tok-1234567890')).rejects.toMatchObject({
      code: 'malformed_response',
    });
    global.fetch = originalFetch;
  });
  it('honors pagination nextOffset and limits', async () => {
    const originalFetch = global.fetch;
    let call = 0;
    // @ts-expect-error
    global.fetch = vi.fn(async (_url: string) => {
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'a1', name: 'A1', currency: 'PHP', writable: true },
            ],
            pagination: { limit: 100, offset: 0, nextOffset: 1 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          accounts: [{ id: 'a2', name: 'A2', currency: 'PHP', writable: true }],
        }),
        { status: 200 },
      );
    });
    const client = new WalletClient();
    const accounts = await client.listAccounts('tok-1234567890');
    expect(accounts.length).toBe(2);
    global.fetch = originalFetch;
  });
});
