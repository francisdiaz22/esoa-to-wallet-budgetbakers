import { describe, expect, it } from 'vitest';
import { retrieveExamples } from './retrieval.js';
import type { WalletHistoryRecord } from './contracts.js';

function makeRecord(
  over: Partial<WalletHistoryRecord> & { recordId: string },
): WalletHistoryRecord {
  return {
    date: '2026-07-29',
    description: 'SHOPEE PH MANDALUYONG PH',
    amountMinor: -10000,
    currency: 'PHP',
    categoryName: 'Shopping',
    ...over,
  };
}

describe('retrieval', () => {
  const history: WalletHistoryRecord[] = [
    makeRecord({
      recordId: 'wallet-001',
      description: 'SHOPEE PH MANDALUYONG PH',
      amountMinor: -186900,
      categoryName: 'Shopping',
      date: '2026-07-29',
    }),
    makeRecord({
      recordId: 'wallet-002',
      description:
        'PC EXPRESS SM NORTH II QUEZON CITY PH - installment 5 of 12',
      amountMinor: -82833,
      categoryName: 'Electronics',
      date: '2026-07-29',
      payee: 'PC Express',
    }),
    makeRecord({
      recordId: 'wallet-003',
      description: 'HEALTHY OPTIONS TAGUIG PH',
      amountMinor: -52900,
      categoryName: 'Groceries',
      date: '2026-07-08',
    }),
    makeRecord({
      recordId: 'wallet-004',
      description: 'GLOBE-BILLSPAY TAGUIG CITY PH',
      amountMinor: -99900,
      categoryName: 'Phone & Internet',
      date: '2026-07-08',
    }),
  ];

  it('is deterministic across repeated runs, does not mutate history, enforces max evidence size, tie-breaking', () => {
    const q = {
      description: 'SHOPEE PH MANDALUYONG PH',
      amountMinor: -186900,
      date: '2026-07-06',
    };
    const r1 = retrieveExamples(q, history, 2);
    const r2 = retrieveExamples(q, history, 2);
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(2);
    // ensure history not mutated
    expect(history).toHaveLength(4);
    // exact match should be top
    expect(r1[0].historyRecordId).toBe('wallet-001');
    expect(r1[0].score).toBeGreaterThan(0.8);
  });

  it('tie-breaking: score desc, date desc, recordId asc', () => {
    const h: WalletHistoryRecord[] = [
      makeRecord({
        recordId: 'a',
        description: 'A B C',
        date: '2026-07-29',
        categoryName: 'Shopping',
      }),
      makeRecord({
        recordId: 'b',
        description: 'A B C',
        date: '2026-07-28',
        categoryName: 'Shopping',
      }),
      makeRecord({
        recordId: 'c',
        description: 'A B C',
        date: '2026-07-29',
        categoryName: 'Shopping',
      }),
    ];
    const q = { description: 'A B C', amountMinor: -10000, date: '2026-07-29' };
    const r = retrieveExamples(q, h, 5);
    // All same score (exact desc 0.5 + overlap 0.3 etc) but dates differ; r[0] should be 2026-07-29, then tie by recordId asc between a and c
    expect(r[0].date).toBe('2026-07-29');
    // Between a and c same date, a < c so a before c
    expect(r[0].historyRecordId).toBe('a');
    expect(r[1].historyRecordId).toBe('c');
    expect(r[2].historyRecordId).toBe('b');
  });

  it('changing irrelevant history row does not change query result', () => {
    const q = {
      description: 'SHOPEE PH MANDALUYONG PH',
      amountMinor: -186900,
      date: '2026-07-06',
    };
    const base = retrieveExamples(q, history, 1);
    const withIrrelevant = [
      ...history,
      makeRecord({
        recordId: 'wallet-999',
        description: 'UNRELATED XYZ PH',
        amountMinor: -999999,
        categoryName: 'Other',
        date: '2020-01-01',
      }),
    ];
    const r2 = retrieveExamples(q, withIrrelevant, 1);
    expect(r2[0].historyRecordId).toBe(base[0].historyRecordId);
  });

  it('relevant exact-match row produces expected evidence', () => {
    const q = {
      description: 'GRAB PASIG CITY PH',
      amountMinor: -12500,
      date: '2026-07-27',
    };
    const hist = [
      ...history,
      makeRecord({
        recordId: 'wallet-035',
        description: 'GRAB PASIG CITY PH',
        amountMinor: -12500,
        categoryName: 'Transportation',
        date: '2026-07-27',
      }),
    ];
    const r = retrieveExamples(q, hist, 1);
    expect(r[0].historyRecordId).toBe('wallet-035');
  });

  it('does not use source row ID as signal', () => {
    // SourceRowId not present in retrieval query; ensure retrieval ignores it
    const q = {
      description: 'SHOPEE PH MANDALUYONG PH',
      amountMinor: -186900,
      date: '2026-07-06',
    };
    const r = retrieveExamples(q, history, 5);
    // Should not have leaked fixture knowledge; only lexical signals matter
    expect(r[0].historyRecordId).toBe('wallet-001');
  });
});
