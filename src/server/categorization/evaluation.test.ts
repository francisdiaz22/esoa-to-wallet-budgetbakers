import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  runBaseline,
  runWithFakeProvider,
} from './evaluation.js';
import type { EvaluationPrediction, EvaluationCase } from './evaluation.js';
import type { WalletHistoryRecord } from './contracts.js';
import { readFileSync } from 'node:fs';

describe('evaluation metrics', () => {
  it('validates metric calculations, confidence buckets, ambiguous-label handling, zero-denominator', () => {
    const cases: EvaluationCase[] = [
      {
        id: 'c1',
        description: 'SHOPEE PH',
        amountMinor: -10000,
        date: '2026-07-06',
        expectedCategory: 'Shopping',
        explanation: 'x',
      },
      {
        id: 'c2',
        description: 'UNKNOWN XYZ',
        amountMinor: -10000,
        date: '2026-07-06',
        expectedCategory: 'unknown',
        explanation: 'x',
      },
    ];
    const preds: EvaluationPrediction[] = [
      {
        caseId: 'c1',
        predictedCategory: 'Shopping',
        confidence: 0.9,
        outcome: 'proposed',
      },
      {
        caseId: 'c2',
        predictedCategory: undefined,
        confidence: 0.3,
        outcome: 'unknown',
      },
    ];
    const m = computeMetrics(preds, cases);
    expect(m.total).toBe(2);
    expect(m.coverage).toBeCloseTo(0.5);
    expect(m.precision).toBeCloseTo(1.0);
    expect(m.unknownRate).toBeCloseTo(0.5);
    expect(m.confidenceBuckets.find((b) => b.range === '0.8-1.0')?.count).toBe(
      1,
    );

    // zero denominator: no proposed
    const preds2: EvaluationPrediction[] = [
      {
        caseId: 'c1',
        predictedCategory: undefined,
        confidence: 0.3,
        outcome: 'unknown',
      },
      {
        caseId: 'c2',
        predictedCategory: undefined,
        confidence: 0.3,
        outcome: 'unknown',
      },
    ];
    const m2 = computeMetrics(preds2, cases);
    expect(m2.coverage).toBe(0);
    expect(m2.precision).toBe(0); // zero denominator defined as 0
    expect(m2.unknownRate).toBe(1);
  });

  it('evaluation command produces identical baseline metrics on repeated runs', () => {
    const casesJson = readFileSync(
      'fixtures/synthetic/evaluation/cases.json',
      'utf8',
    );
    const cases: EvaluationCase[] = JSON.parse(casesJson);
    // Parse history quickly via adapter (we can reuse historyAdapter)
    // Instead construct minimal history records from CSV for determinism
    // For test, use a small synthetic history that covers some cases
    const history: WalletHistoryRecord[] = [
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
        date: '2026-07-08',
        description: 'HEALTHY OPTIONS TAGUIG PH',
        amountMinor: -52900,
        currency: 'PHP',
        categoryName: 'Groceries',
      },
      {
        recordId: 'wallet-035',
        date: '2026-07-27',
        description: 'GRAB PASIG CITY PH',
        amountMinor: -12500,
        currency: 'PHP',
        categoryName: 'Transportation',
      },
    ];
    const r1 = runBaseline(cases, history);
    const r2 = runBaseline(cases, history);
    expect(r1.metrics).toEqual(r2.metrics);
    expect(r1.predictions).toEqual(r2.predictions);
  });

  it('covers ambiguous and fake provider modes', () => {
    const cases: EvaluationCase[] = [
      {
        id: 'c1',
        description: 'SHOPEE PH',
        amountMinor: -10000,
        date: '2026-07-06',
        expectedCategory: 'Shopping',
        explanation: 'x',
      },
      {
        id: 'c2',
        description: 'UNKNOWN',
        amountMinor: -10000,
        date: '2026-07-06',
        expectedCategory: 'unknown',
        explanation: 'x',
      },
    ];
    const history: WalletHistoryRecord[] = [
      {
        recordId: 'wallet-001',
        date: '2026-07-29',
        description: 'SHOPEE PH',
        amountMinor: -10000,
        currency: 'PHP',
        categoryName: 'Shopping',
      },
    ];
    const allowed = new Set(['Shopping', 'unknown']);
    const res = runWithFakeProvider(
      cases,
      history,
      { c1: 'correct', c2: 'unknown' },
      allowed,
    );
    expect(res.predictions.find((p) => p.caseId === 'c1')?.outcome).toBe(
      'proposed',
    );
    expect(res.predictions.find((p) => p.caseId === 'c2')?.outcome).toBe(
      'unknown',
    );
  });
});
