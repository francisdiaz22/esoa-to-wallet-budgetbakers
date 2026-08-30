import { describe, it, expect } from 'vitest';
import {
  WalletWriteEnvelopeSchema,
  WalletRecordCreateSchema,
  WalletAccountSchema,
  WalletCategorySchema,
  CommitJournalEntrySchema,
  WalletCategoryMappingSchema,
} from './contracts.js';

describe('wallet contracts', () => {
  it('rejects malformed remote envelopes with unknown fields', () => {
    const bad = {
      summary: { total: 1, succeeded: 1, failed: 0 },
      results: [
        {
          inputIndex: 0,
          status: 'succeeded',
          walletRecordId: 'id',
          extra: 'no',
        },
      ],
    };
    expect(WalletWriteEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects duplicate inputIndex', () => {
    const env = {
      summary: { total: 2, succeeded: 2, failed: 0 },
      results: [
        { inputIndex: 0, status: 'succeeded', walletRecordId: 'a' },
        { inputIndex: 0, status: 'succeeded', walletRecordId: 'b' },
      ],
    };
    expect(WalletWriteEnvelopeSchema.safeParse(env).success).toBe(false);
  });
  it('rejects out-of-range inputIndex', () => {
    const env = {
      summary: { total: 1, succeeded: 1, failed: 0 },
      results: [{ inputIndex: 5, status: 'succeeded', walletRecordId: 'a' }],
    };
    expect(WalletWriteEnvelopeSchema.safeParse(env).success).toBe(false);
  });
  it('rejects missing success walletRecordId', () => {
    const env = {
      summary: { total: 1, succeeded: 0, failed: 1 },
      results: [{ inputIndex: 0, status: 'succeeded' }],
    };
    expect(WalletWriteEnvelopeSchema.safeParse(env).success).toBe(false);
  });
  it('rejects bad money (float)', () => {
    const rec = {
      accountId: 'acc1',
      categoryId: 'cat1',
      amount: 12.34,
      currency: 'PHP',
      date: '2026-07-29',
      description: 'desc',
    };
    expect(WalletRecordCreateSchema.safeParse(rec).success).toBe(false);
  });
  it('rejects unknown fields in account', () => {
    const acc = {
      id: 'a1',
      name: 'Main',
      currency: 'PHP',
      writable: true,
      unknown: 'x',
    };
    expect(WalletAccountSchema.safeParse(acc).success).toBe(false);
  });
  it('rejects unknown fields in category', () => {
    const cat = { id: 'c1', name: 'Food', unknown: 1 };
    expect(WalletCategorySchema.safeParse(cat).success).toBe(false);
  });
  it('rejects CommitJournal success without walletRecordId', () => {
    const j = {
      reviewItemId: '00000000-0000-4000-a000-000000000001',
      sourceRowId: 'p1-r001',
      snapshotId: '00000000-0000-4000-a000-000000000002',
      status: 'succeeded',
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    expect(CommitJournalEntrySchema.safeParse(j).success).toBe(false);
  });
  it('success is terminal shape still valid', () => {
    const j = {
      reviewItemId: '00000000-0000-4000-a000-000000000001',
      sourceRowId: 'p1-r001',
      snapshotId: '00000000-0000-4000-a000-000000000002',
      status: 'succeeded',
      walletRecordId: 'w1',
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    expect(CommitJournalEntrySchema.safeParse(j).success).toBe(true);
  });
  it('rejects mapping with unknown fields', () => {
    const m = {
      localCategoryName: 'Food',
      walletCategoryId: 'c1',
      walletCategoryLabel: 'Food',
      catalogVersion: 'v1',
      extra: 1,
    };
    expect(WalletCategoryMappingSchema.safeParse(m).success).toBe(false);
  });
});
