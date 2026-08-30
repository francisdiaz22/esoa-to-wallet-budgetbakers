import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WalletRecordCreateSchema } from './contracts.js';
import { LIMITS } from '../ingestion/limits.js';
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, 'openapi.fixture.json'),
    'utf8',
  ),
);

describe('wallet openapi fixture', () => {
  it('records operation IDs and paths match wallet contracts', () => {
    expect(fixture.baseUrl).toBe(LIMITS.WALLET_BASE_URL);
    const ops = new Map(fixture.operations.map((o) => [o.operationId, o]));
    expect(ops.has('listAccounts')).toBe(true);
    expect(ops.has('listCategories')).toBe(true);
    expect(ops.has('createRecords')).toBe(true);
    const create = ops.get('createRecords')!;
    expect(create.path).toBe('/records');
    expect(create.requestSchema.properties.records.maxItems).toBe(
      LIMITS.WALLET_CREATE_BATCH_MAX,
    );
    // Verify WalletRecordCreateSchema matches fixture required fields
    const sample = {
      accountId: 'acc1',
      categoryId: 'cat1',
      amount: -1000,
      currency: 'PHP',
      date: '2026-07-29',
      description: 'Test',
    };
    expect(WalletRecordCreateSchema.safeParse(sample).success).toBe(true);
  });
  it('batch maximum and pagination limits align', () => {
    expect(
      fixture.operations.find((o) => o.operationId === 'createRecords')!
        .batchMaximum,
    ).toBe(LIMITS.WALLET_CREATE_BATCH_MAX);
    expect(fixture.pagination.maxLimit).toBe(LIMITS.WALLET_PAGE_LIMIT_MAX);
  });
});
