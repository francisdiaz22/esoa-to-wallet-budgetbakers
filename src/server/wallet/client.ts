import { LIMITS } from '../ingestion/limits.js';
import {
  WalletAccountListEnvelopeSchema,
  WalletCategoryListEnvelopeSchema,
  WalletWriteEnvelopeSchema,
  type WalletAccount,
  type WalletCategory,
  type WalletRecordCreate,
  type WalletWriteEnvelope,
} from './contracts.js';

export const WALLET_BASE_URL = LIMITS.WALLET_BASE_URL;
export const ALLOWED_PATHS = new Set(['/accounts', '/categories', '/records']);
export const ALLOWED_ORIGIN = 'https://rest.budgetbakers.com';

export type WalletClientErrorCode =
  | 'unauthorized'
  | 'initial_sync_pending'
  | 'rate_limited'
  | 'unavailable'
  | 'malformed_response'
  | 'timeout'
  | 'transport_error';

export type WalletClientError = {
  code: WalletClientErrorCode;
  status?: number;
  message: string;
  retryAfterMs?: number;
  retryMinutes?: number;
};

export interface WalletClientInterface {
  listAccounts(token: string, signal?: AbortSignal): Promise<WalletAccount[]>;
  listCategories(
    token: string,
    signal?: AbortSignal,
  ): Promise<WalletCategory[]>;
  createRecords(
    token: string,
    records: WalletRecordCreate[],
    signal?: AbortSignal,
  ): Promise<WalletWriteEnvelope>;
  // For discovery combined
  fetchCatalog(
    token: string,
    signal?: AbortSignal,
  ): Promise<{ accounts: WalletAccount[]; categories: WalletCategory[] }>;
}

function assertFixedUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw Object.assign(new Error('invalid url'), { code: 'unavailable' });
  }
  if (url.origin !== ALLOWED_ORIGIN) {
    throw Object.assign(new Error('origin not allowed'), {
      code: 'unavailable',
    });
  }
  if (!url.pathname.startsWith('/wallet')) {
    throw Object.assign(new Error('path not allowed'), { code: 'unavailable' });
  }
  const subPath = url.pathname.slice('/wallet'.length) || '/';
  if (!ALLOWED_PATHS.has(subPath)) {
    throw Object.assign(new Error('path not allowed'), { code: 'unavailable' });
  }
  return url;
}

type FetchInitWithTimeout = RequestInit & { timeoutMs: number };
async function fetchWithTimeout(
  input: string,
  init: FetchInitWithTimeout,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  const externalSignal = init.signal as AbortSignal | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      throw Object.assign(new Error('aborted'), { code: 'timeout' });
    }
    externalSignal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }
  try {
    const { timeoutMs: _t, ...rest } = init as unknown as Record<
      string,
      unknown
    >;
    void _t;
    const res = await (
      fetch as unknown as (
        input: string,
        init: Record<string, unknown>,
      ) => Promise<Response>
    )(input, {
      ...(rest as Record<string, unknown>),
      signal: controller.signal,
      redirect: 'manual',
    });
    return res;
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === 'AbortError') {
      const abortErr = new Error('timeout or aborted') as Error & {
        code?: string;
      };
      abortErr.code = 'timeout';
      throw abortErr;
    }
    throw Object.assign(new Error('transport error'), {
      code: 'transport_error',
      cause: e,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(
  res: Response,
  maxBytes: number,
): Promise<string> {
  // Use arrayBuffer to enforce size bound
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw Object.assign(new Error('response too large'), {
      code: 'malformed_response',
    });
  }
  return new TextDecoder().decode(buf);
}

export class WalletClient implements WalletClientInterface {
  constructor(private baseUrl: string = WALLET_BASE_URL) {
    // Validate fixed origin at construction
    assertFixedUrl(this.baseUrl + '/accounts'); // probe
    if (this.baseUrl !== WALLET_BASE_URL) {
      throw new Error('Wallet base URL must be fixed');
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number>,
  ): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query))
        url.searchParams.set(k, String(v));
    }
    // Enforce fixed origin validation
    assertFixedUrl(url.toString());
    return url.toString();
  }

  private authHeaders(token: string): Record<string, string> {
    // Bearer insertion inside production adapter only; never log token
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async listAccounts(
    token: string,
    signal?: AbortSignal,
  ): Promise<WalletAccount[]> {
    const all: WalletAccount[] = [];
    let offset = 0;
    const limit = LIMITS.WALLET_PAGE_LIMIT_DEFAULT;
    // Validate all pages before atomic replace done by caller; here we just collect
    while (true) {
      const url = this.buildUrl('/accounts', { limit, offset });
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: this.authHeaders(token),
        timeoutMs: LIMITS.WALLET_TIMEOUT_MS,
        signal,
        redirect: 'manual',
      });
      // Handle distinct safe connection states
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error('unauthorized'), {
          code: 'unauthorized' as WalletClientErrorCode,
          status: res.status,
        });
      }
      if (res.status === 409) {
        const text = await readBoundedBody(
          res,
          LIMITS.MAX_WALLET_RESPONSE_BYTES,
        );
        let retryMinutes: number | undefined;
        try {
          const j = JSON.parse(text);
          retryMinutes = j.retryAfterMinutes ?? j.retry_minutes ?? undefined;
        } catch (_e) {
          void _e;
        }
        const err = new Error('initial sync pending') as Error & {
          code?: string;
          retryMinutes?: number;
          status?: number;
        };
        err.code = 'initial_sync_pending';
        err.status = 409;
        err.retryMinutes = retryMinutes;
        throw err;
      }
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        let retryMs: number | undefined;
        if (retryAfter) {
          const secs = parseInt(retryAfter, 10);
          if (!isNaN(secs))
            retryMs = Math.min(secs * 1000, LIMITS.WALLET_MAX_RETRY_AFTER_MS);
        }
        const err = new Error('rate limited') as Error & {
          code?: string;
          status?: number;
          retryAfterMs?: number;
        };
        err.code = 'rate_limited';
        err.status = 429;
        err.retryAfterMs = retryMs;
        throw err;
      }
      if (res.status >= 300 && res.status < 400) {
        // redirect rejection mandatory
        throw Object.assign(new Error('redirect rejected'), {
          code: 'unavailable' as WalletClientErrorCode,
        });
      }
      if (res.status !== 200) {
        throw Object.assign(new Error(`unexpected status ${res.status}`), {
          code: 'unavailable' as WalletClientErrorCode,
          status: res.status,
        });
      }
      const text = await readBoundedBody(res, LIMITS.MAX_WALLET_RESPONSE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw Object.assign(new Error('malformed json'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      const validated = WalletAccountListEnvelopeSchema.safeParse(parsed);
      if (!validated.success) {
        throw Object.assign(new Error('malformed body'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      const env = validated.data;
      all.push(...env.accounts);
      if (all.length > LIMITS.MAX_WALLET_ACCOUNTS) {
        throw Object.assign(new Error('account limit exceeded'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      const totalItemsSoFar = all.length;
      if (
        env.pagination?.nextOffset === undefined ||
        env.pagination.nextOffset === null
      ) {
        break;
      }
      // Enforce pagination bounds
      if (env.pagination.nextOffset <= offset) {
        throw Object.assign(new Error('pagination loop'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      offset = env.pagination.nextOffset;
      // Guard infinite loop
      if (totalItemsSoFar > 10000) break;
    }
    return all;
  }

  async listCategories(
    token: string,
    signal?: AbortSignal,
  ): Promise<WalletCategory[]> {
    const all: WalletCategory[] = [];
    let offset = 0;
    const limit = LIMITS.WALLET_PAGE_LIMIT_DEFAULT;
    while (true) {
      const url = this.buildUrl('/categories', { limit, offset });
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: this.authHeaders(token),
        timeoutMs: LIMITS.WALLET_TIMEOUT_MS,
        signal,
        redirect: 'manual',
      });
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error('unauthorized'), {
          code: 'unauthorized' as WalletClientErrorCode,
          status: res.status,
        });
      }
      if (res.status === 409) {
        const text = await readBoundedBody(
          res,
          LIMITS.MAX_WALLET_RESPONSE_BYTES,
        ).catch(() => '{}');
        let retryMinutes: number | undefined;
        try {
          const j = JSON.parse(text);
          retryMinutes = j.retryAfterMinutes ?? undefined;
        } catch (_e) {
          void _e;
        }
        const err = new Error('initial sync pending') as Error & {
          code?: string;
          retryMinutes?: number;
          status?: number;
        };
        err.code = 'initial_sync_pending';
        err.status = 409;
        err.retryMinutes = retryMinutes;
        throw err;
      }
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        let retryMs: number | undefined;
        if (retryAfter) {
          const secs = parseInt(retryAfter, 10);
          if (!isNaN(secs))
            retryMs = Math.min(secs * 1000, LIMITS.WALLET_MAX_RETRY_AFTER_MS);
        }
        const err = new Error('rate limited') as Error & {
          code?: string;
          status?: number;
          retryAfterMs?: number;
        };
        err.code = 'rate_limited';
        err.status = 429;
        err.retryAfterMs = retryMs;
        throw err;
      }
      if (res.status >= 300 && res.status < 400) {
        throw Object.assign(new Error('redirect rejected'), {
          code: 'unavailable' as WalletClientErrorCode,
        });
      }
      if (res.status !== 200) {
        throw Object.assign(new Error(`unexpected status ${res.status}`), {
          code: 'unavailable' as WalletClientErrorCode,
          status: res.status,
        });
      }
      const text = await readBoundedBody(res, LIMITS.MAX_WALLET_RESPONSE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw Object.assign(new Error('malformed json'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      const validated = WalletCategoryListEnvelopeSchema.safeParse(parsed);
      if (!validated.success) {
        throw Object.assign(new Error('malformed body'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      const env = validated.data;
      all.push(...env.categories);
      if (all.length > LIMITS.MAX_WALLET_CATEGORIES) {
        throw Object.assign(new Error('category limit exceeded'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      if (
        env.pagination?.nextOffset === undefined ||
        env.pagination.nextOffset === null
      )
        break;
      if (env.pagination.nextOffset <= offset) {
        throw Object.assign(new Error('pagination loop'), {
          code: 'malformed_response' as WalletClientErrorCode,
        });
      }
      offset = env.pagination.nextOffset;
    }
    return all;
  }

  async fetchCatalog(
    token: string,
    signal?: AbortSignal,
  ): Promise<{ accounts: WalletAccount[]; categories: WalletCategory[] }> {
    // Fetch both with pagination; validate before atomic replace done by caller (commitService)
    // Fetch sequentially to simplify rate-limit handling but could be parallel
    const accounts = await this.listAccounts(token, signal);
    const categories = await this.listCategories(token, signal);
    return { accounts, categories };
  }

  async createRecords(
    token: string,
    records: WalletRecordCreate[],
    signal?: AbortSignal,
  ): Promise<WalletWriteEnvelope> {
    if (
      records.length === 0 ||
      records.length > LIMITS.WALLET_CREATE_BATCH_MAX
    ) {
      throw new Error('batch size out of bounds');
    }
    const url = this.buildUrl('/records');
    const body = JSON.stringify({ records });
    if (body.length > LIMITS.MAX_WALLET_RESPONSE_BYTES) {
      throw new Error('request too large');
    }
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: this.authHeaders(token),
      body,
      timeoutMs: LIMITS.WALLET_WRITE_TIMEOUT_MS,
      signal,
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('unauthorized'), {
        code: 'unauthorized' as WalletClientErrorCode,
        status: res.status,
      });
    }
    if (res.status === 409) {
      const err = new Error('initial sync pending') as Error & {
        code?: string;
        status?: number;
      };
      err.code = 'initial_sync_pending';
      err.status = 409;
      throw err;
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      let retryMs: number | undefined;
      if (retryAfter) {
        const secs = parseInt(retryAfter, 10);
        if (!isNaN(secs))
          retryMs = Math.min(secs * 1000, LIMITS.WALLET_MAX_RETRY_AFTER_MS);
      }
      const err = new Error('rate limited') as Error & {
        code?: string;
        status?: number;
        retryAfterMs?: number;
      };
      err.code = 'rate_limited';
      err.status = 429;
      err.retryAfterMs = retryMs;
      throw err;
    }
    if (res.status >= 300 && res.status < 400) {
      throw Object.assign(new Error('redirect rejected'), {
        code: 'unavailable' as WalletClientErrorCode,
      });
    }
    // Wallet uses 200 for all-success, 207 for mixed, 400/500 for all-failed but still envelope may be present
    // We accept 200, 207, 400, 500 if they contain valid envelope; otherwise treat as unavailable unless it's client_error envelope
    const text = await readBoundedBody(res, LIMITS.MAX_WALLET_RESPONSE_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw Object.assign(new Error('malformed json'), {
        code: 'malformed_response' as WalletClientErrorCode,
      });
    }
    const validated = WalletWriteEnvelopeSchema.safeParse(parsed);
    if (!validated.success) {
      // Invalid body → treat as malformed (unknown outcome for that chunk)
      throw Object.assign(new Error('malformed envelope'), {
        code: 'malformed_response' as WalletClientErrorCode,
      });
    }
    // Also validate HTTP semantics: if status is 200 but envelope has failures, that's inconsistent but we trust envelope.
    // Mixed batches may use 207; we already validated envelope.
    return validated.data;
  }
}

// Scripted fake for tests and offline E2E
export type FakeScenario = {
  accounts?: WalletAccount[];
  categories?: WalletCategory[];
  // Map chunk index to response or error
  writeResponses?: Array<WalletWriteEnvelope | { error: WalletClientError }>;
  // For pagination testing: provide paginated slices
  paginatedAccounts?: WalletAccount[][];
  paginatedCategories?: WalletCategory[][];
  // Global error for discovery
  discoveryError?: WalletClientError;
  // Capture
  capturedTokens?: string[];
  capturedRequests?: WalletRecordCreate[][];
};

export class FakeWalletClient implements WalletClientInterface {
  public capturedTokens: string[] = [];
  public capturedRequests: WalletRecordCreate[][] = [];
  public callLog: string[] = [];

  constructor(private scenario: FakeScenario = {}) {}

  async listAccounts(token: string): Promise<WalletAccount[]> {
    this.capturedTokens.push(token);
    this.callLog.push('listAccounts');
    if (this.scenario.discoveryError)
      throw Object.assign(
        new Error(this.scenario.discoveryError.message),
        this.scenario.discoveryError,
      );
    if (this.scenario.paginatedAccounts) {
      // Simulate pagination internally but return flattened — to test client pagination we use real client, not fake listAccounts direct pagination
      return this.scenario.paginatedAccounts.flat();
    }
    return this.scenario.accounts ?? [];
  }

  async listCategories(token: string): Promise<WalletCategory[]> {
    this.capturedTokens.push(token);
    this.callLog.push('listCategories');
    if (this.scenario.discoveryError)
      throw Object.assign(
        new Error(this.scenario.discoveryError.message),
        this.scenario.discoveryError,
      );
    if (this.scenario.paginatedCategories)
      return this.scenario.paginatedCategories.flat();
    return this.scenario.categories ?? [];
  }

  async fetchCatalog(
    token: string,
  ): Promise<{ accounts: WalletAccount[]; categories: WalletCategory[] }> {
    this.capturedTokens.push(token);
    this.callLog.push('fetchCatalog');
    if (this.scenario.discoveryError)
      throw Object.assign(
        new Error(this.scenario.discoveryError.message),
        this.scenario.discoveryError,
      );
    const accounts =
      this.scenario.accounts ?? this.scenario.paginatedAccounts?.flat() ?? [];
    const categories =
      this.scenario.categories ??
      this.scenario.paginatedCategories?.flat() ??
      [];
    return { accounts, categories };
  }

  async createRecords(
    token: string,
    records: WalletRecordCreate[],
  ): Promise<WalletWriteEnvelope> {
    this.capturedTokens.push(token);
    this.capturedRequests.push(records);
    this.callLog.push(`createRecords:${records.length}`);
    const idx = this.capturedRequests.length - 1;
    const planned = this.scenario.writeResponses?.[idx];
    if (planned && 'error' in planned) {
      const err = new Error(planned.error.message) as Error & {
        code?: string;
        status?: number;
        retryAfterMs?: number;
        retryMinutes?: number;
      };
      err.code = planned.error.code;
      err.status = planned.error.status;
      if (planned.error.retryAfterMs)
        (err as unknown as { retryAfterMs: number }).retryAfterMs =
          planned.error.retryAfterMs;
      if (planned.error.retryMinutes)
        (err as unknown as { retryMinutes: number }).retryMinutes =
          planned.error.retryMinutes;
      throw err;
    }
    if (planned) {
      return planned as WalletWriteEnvelope;
    }
    // Default: all succeeded with generated ids
    const results = records.map((_, i) => ({
      inputIndex: i,
      status: 'succeeded' as const,
      walletRecordId: `wallet-${idx}-${i}-${Date.now()}`,
    }));
    return {
      summary: { total: records.length, succeeded: records.length, failed: 0 },
      results,
    };
  }
}

// Helper to enforce no browser contact: used in tests to prove client is server-only
export function assertNotBrowser(): boolean {
  // In Node, window is undefined
  return (
    typeof (globalThis as unknown as { window?: unknown }).window ===
    'undefined'
  );
}
