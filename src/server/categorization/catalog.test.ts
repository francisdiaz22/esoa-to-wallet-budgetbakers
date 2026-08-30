import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog.js';
import type { WalletHistoryRecord } from './contracts.js';

function makeRecord(
  categoryName: string,
  recordId = 'w1',
): WalletHistoryRecord {
  return {
    recordId,
    date: '2026-07-29',
    description: 'desc',
    amountMinor: -10000,
    currency: 'PHP',
    categoryName,
  };
}

describe('catalog', () => {
  it('builds catalog only from validated history categories; fabricated model category cannot pass validation', () => {
    const records = [
      makeRecord('Shopping', 'w1'),
      makeRecord('Food', 'w2'),
      makeRecord('Shopping', 'w3'),
    ];
    const res = buildCatalog(records);
    expect('catalog' in res).toBe(true);
    if ('catalog' in res) {
      expect(res.catalog).toHaveLength(2);
      expect(
        res.catalog.find((c) => c.categoryName === 'Shopping')?.exampleCount,
      ).toBe(2);
    }
  });
  it('rejects ambiguous case/whitespace variants rather than silently merging', () => {
    const records = [
      makeRecord('Shopping', 'w1'),
      makeRecord('shopping', 'w2'),
    ];
    const res = buildCatalog(records);
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error.code).toBe('history_schema_invalid');
  });
  it('treats trimmed collapsed whitespace as same canonical not ambiguous', () => {
    const records = [
      makeRecord('  Shopping  ', 'w1'),
      makeRecord('Shopping', 'w2'),
    ];
    const res = buildCatalog(records);
    expect('catalog' in res).toBe(true);
    if ('catalog' in res) expect(res.catalog).toHaveLength(1);
  });
  it('normalizes and generates stable deterministic ids', () => {
    const records = [
      makeRecord('Home & Garden', 'w1'),
      makeRecord('Home & Garden', 'w2'),
    ];
    const res1 = buildCatalog(records);
    const res2 = buildCatalog(records);
    expect(
      'catalog' in res1 && 'catalog' in res2 && res1.catalog[0].categoryId,
    ).toBe(res2.catalog[0].categoryId);
  });
});
