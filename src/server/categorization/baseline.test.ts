import { describe, expect, it } from 'vitest';
import { classifyBaseline } from './baselineClassifier.js';
import type { WalletHistoryRecord } from './contracts.js';

function makeHistory(): WalletHistoryRecord[] {
  return [
    {
      recordId: 'wallet-001',
      date: '2026-07-29',
      description: 'SHOPEE PH MANDALUYONG PH',
      amountMinor: -186900,
      currency: 'PHP',
      categoryName: 'Shopping',
    },
    {
      recordId: 'wallet-002',
      date: '2026-07-29',
      description:
        'PC EXPRESS SM NORTH II QUEZON CITY PH - installment 5 of 12',
      amountMinor: -82833,
      currency: 'PHP',
      categoryName: 'Electronics',
    },
    {
      recordId: 'wallet-003',
      date: '2026-07-29',
      description: 'KLOOK FLICKET TAGUIG PH',
      amountMinor: -373250,
      currency: 'PHP',
      categoryName: 'Travel',
    },
    {
      recordId: 'wallet-004',
      date: '2026-07-09',
      description: 'KLOOK FLICKET TAGUIG PH',
      amountMinor: -73250,
      currency: 'PHP',
      categoryName: 'Other',
      payee: 'Travel companion',
    },
  ];
}

describe('baseline classifier', () => {
  it('proposes only at documented confidence/margin thresholds and otherwise unknown', () => {
    const h = makeHistory();
    const exact = classifyBaseline(
      {
        description: 'SHOPEE PH MANDALUYONG PH',
        amountMinor: -186900,
        date: '2026-07-06',
      },
      h,
    );
    expect('unknown' in exact).toBe(false);
    if (!('unknown' in exact)) expect(exact.categoryName).toBe('Shopping');

    const unknown = classifyBaseline(
      {
        description: 'UNKNOWN MERCHANT XYZ',
        amountMinor: -50000,
        date: '2026-07-15',
      },
      h,
    );
    expect('unknown' in unknown && unknown.unknown).toBe(true);

    // Ambiguous exact: KLOOK appears in two categories -> unknown
    const ambiguous = classifyBaseline(
      {
        description: 'KLOOK FLICKET TAGUIG PH',
        amountMinor: -10000,
        date: '2026-07-09',
      },
      h,
    );
    expect('unknown' in ambiguous && ambiguous.unknown).toBe(true);
  });
  it('high score with margin proposes, else unknown', () => {
    const h = makeHistory();
    // For a near exact but not exact, test margin logic: we need a query that scores high but not exact
    // SHOPEE MALL vs SHOPEE PH -> token overlap 0.5? But threshold 0.9, so should be unknown
    const near = classifyBaseline(
      {
        description: 'SHOPEE MALL MANDALUYONG PH',
        amountMinor: -10000,
        date: '2026-07-12',
      },
      h,
    );
    // Should be unknown because not exact and score <0.9
    expect('unknown' in near).toBe(true);
  });
});
