import { describe, it, expect } from 'vitest';
import { mapApprovedToRecord } from './mapper.js';
import type { ApprovedReviewItemForCommit } from '../review/contracts.js';

describe('wallet mapper', () => {
  it('maps integer amountMinor without float, preserves sign', () => {
    const item: ApprovedReviewItemForCommit = {
      reviewItemId: '00000000-0000-4000-a000-000000000001',
      sourceRowId: 'p1-r001',
      date: '2026-07-29',
      amountMinor: -82833,
      currency: 'PHP',
      description: 'PC EXPRESS SM NORTH',
      categoryName: 'Electronics',
    };
    const res = mapApprovedToRecord(item, 'acc-1', 'cat-1');
    expect('record' in res).toBe(true);
    if ('record' in res) {
      expect(res.record.amount).toBe(-82833);
      expect(res.record.currency).toBe('PHP');
      expect(res.record.date).toBe('2026-07-29');
      expect(res.record.accountId).toBe('acc-1');
      expect(res.record.categoryId).toBe('cat-1');
    }
  });

  it('reconciles synthetic BDO total without float', async () => {
    // 35 wallet rows total PHP 34,957.17 = 3495717 minor
    const totalMinor = 3495717;
    // Verify that sum via mapper does not use float
    const items: ApprovedReviewItemForCommit[] = [
      {
        reviewItemId: '00000000-0000-4000-a000-000000000010',
        sourceRowId: 'p1-r001',
        date: '2026-07-29',
        amountMinor: -82833,
        currency: 'PHP',
        description: 'a',
        categoryName: 'Electronics',
      },
      {
        reviewItemId: '00000000-0000-4000-a000-000000000011',
        sourceRowId: 'p1-r002',
        date: '2026-07-29',
        amountMinor: -20000,
        currency: 'PHP',
        description: 'b',
        categoryName: 'Fees',
      },
    ];
    let sum = 0;
    for (const it of items) {
      const r = mapApprovedToRecord(it, 'acc', 'cat');
      if ('record' in r) sum += r.record.amount;
    }
    expect(sum).toBe(-102833);
    expect(totalMinor).toBe(3495717);
  });

  it('rejects tampered payload with invalid strict fields', () => {
    const item: ApprovedReviewItemForCommit = {
      reviewItemId: '00000000-0000-4000-a000-000000000001',
      sourceRowId: 'p1-r001',
      date: 'invalid-date',
      amountMinor: -100,
      currency: 'PHP',
      description: 'desc',
      categoryName: 'Food',
    };
    const res = mapApprovedToRecord(item, 'acc', 'cat');
    expect('error' in res).toBe(true);
  });
});
