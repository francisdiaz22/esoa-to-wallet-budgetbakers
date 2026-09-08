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
    const urls: string[] = [];
    // @ts-expect-error
    global.fetch = vi.fn(async (url: string) => {
      urls.push(url);
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'a1', name: 'A1', currencyCode: 'PHP', isBankSync: false },
            ],
            limit: 100,
            offset: 0,
            nextOffset: 1,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          accounts: [
            { id: 'a2', name: 'A2', currencyCode: 'PHP', isBankSync: true },
          ],
          limit: 100,
          offset: 1,
        }),
        { status: 200 },
      );
    });
    const client = new WalletClient();
    const accounts = await client.listAccounts('tok-1234567890');
    expect(accounts.length).toBe(2);
    expect(accounts[0]?.writable).toBe(true);
    expect(accounts[1]?.writable).toBe(false);
    expect(urls[0]).toContain('/wallet/v1/api/accounts?');
    expect(urls[1]).toContain('offset=1');
    global.fetch = originalFetch;
  });

  it('maps record payloads and write results to the live Wallet API contract', async () => {
    const originalFetch = global.fetch;
    let capturedUrl = '';
    let capturedBody: unknown;
    // @ts-expect-error
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          summary: {
            total: 1,
            succeeded: 1,
            clientErrors: 0,
            serverErrors: 0,
            documentsWritten: 1,
          },
          results: [{ inputIndex: 0, success: true, id: 'record-1' }],
        }),
        { status: 200 },
      );
    });
    const client = new WalletClient();
    const result = await client.createRecords('tok-1234567890', [
      {
        accountId: 'account-1',
        categoryId: 'category-1',
        amount: -12345,
        currency: 'PHP',
        date: '2026-08-31',
        description: 'Dinner',
        payee: 'Restaurant',
      },
    ]);
    expect(capturedUrl).toBe(
      'https://rest.budgetbakers.com/wallet/v1/api/records',
    );
    expect(capturedBody).toEqual([
      {
        accountId: 'account-1',
        amount: { value: -123.45, currencyCode: 'PHP' },
        categoryId: 'category-1',
        recordDate: '2026-08-31T12:00:00.000Z',
        note: 'Dinner',
        counterParty: 'Restaurant',
      },
    ]);
    expect(result.results[0]).toMatchObject({
      status: 'succeeded',
      walletRecordId: 'record-1',
    });
    global.fetch = originalFetch;
  });
});
