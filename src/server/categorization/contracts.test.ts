import { describe, expect, it } from 'vitest';
import {
  WalletHistoryRecordSchema,
  CategoryProposalSchema,
  RetrievedExampleSchema,
} from './contracts.js';

describe('P2.1 contracts', () => {
  it('accepts valid WalletHistoryRecord', () => {
    const rec = {
      recordId: 'wallet-001',
      date: '2026-07-29',
      description: 'PC EXPRESS SM NORTH II QUEZON CITY PH',
      amountMinor: -82833,
      currency: 'PHP' as const,
      categoryName: 'Electronics',
    };
    expect(WalletHistoryRecordSchema.safeParse(rec).success).toBe(true);
  });
  it('rejects invalid IDs, dates, confidence, unbounded rationale, unsupported currency, categoryless proposed', () => {
    expect(
      WalletHistoryRecordSchema.safeParse({
        recordId: '',
        date: '2026-07-29',
        description: 'x',
        amountMinor: -100,
        currency: 'PHP',
        categoryName: 'Food',
      }).success,
    ).toBe(false);
    expect(
      WalletHistoryRecordSchema.safeParse({
        recordId: 'a',
        date: 'not-a-date',
        description: 'x',
        amountMinor: -100,
        currency: 'PHP',
        categoryName: 'Food',
      }).success,
    ).toBe(false);
    expect(
      WalletHistoryRecordSchema.safeParse({
        recordId: 'a',
        date: '2026-07-29',
        description: 'x',
        amountMinor: -100,
        currency: 'USD',
        categoryName: 'Food',
      }).success,
    ).toBe(false);
    expect(
      WalletHistoryRecordSchema.safeParse({
        recordId: 'a',
        date: '2026-07-29',
        description: '',
        amountMinor: -100,
        currency: 'PHP',
        categoryName: 'Food',
      }).success,
    ).toBe(false);
    expect(
      WalletHistoryRecordSchema.safeParse({
        recordId: 'a',
        date: '2026-07-29',
        description: 'x',
        amountMinor: -100,
        currency: 'PHP',
        categoryName: '',
      }).success,
    ).toBe(false);
  });
  it('rejects invalid confidence, unbounded rationale, category outside catalog concern', () => {
    const proposal = {
      proposalId: 'p1',
      sourceRowId: 'p1-r001',
      categoryName: 'Food',
      classificationConfidence: 1.5,
      rationale: 'x',
      outcome: 'proposed' as const,
      reviewState: 'needs_review' as const,
      retrieval: [],
      issues: [],
    };
    expect(CategoryProposalSchema.safeParse(proposal).success).toBe(false);
    const longRationale = 'a'.repeat(501);
    expect(
      CategoryProposalSchema.safeParse({
        ...proposal,
        classificationConfidence: 0.8,
        rationale: longRationale,
      }).success,
    ).toBe(false);
    expect(
      CategoryProposalSchema.safeParse({
        ...proposal,
        categoryName: undefined,
        classificationConfidence: 0.8,
      }).success,
    ).toBe(false);
    expect(
      CategoryProposalSchema.safeParse({
        ...proposal,
        outcome: 'unknown',
        classificationConfidence: 0.2,
      }).success,
    ).toBe(false);
    const tooManyRetrieval = Array.from({ length: 6 }, (_, i) => ({
      historyRecordId: `wallet-${i}`,
      categoryName: 'Food',
      description: 'desc',
      amountMinor: -100,
      date: '2026-07-29',
      score: 0.5,
    }));
    expect(
      CategoryProposalSchema.safeParse({
        ...proposal,
        classificationConfidence: 0.8,
        rationale: 'ok',
        retrieval: tooManyRetrieval,
      }).success,
    ).toBe(false);
  });
  it('rejects unbounded rationale and excerpt via RetrievedExample', () => {
    const ex = {
      historyRecordId: 'wallet-001',
      categoryName: 'Food',
      description: 'a'.repeat(501),
      amountMinor: -100,
      date: '2026-07-29',
      score: 0.5,
    };
    expect(RetrievedExampleSchema.safeParse(ex).success).toBe(false);
  });
  it('accepts valid CategoryProposal and traceable to exactly one sourceRowId', () => {
    const proposal = {
      proposalId: '550e8400-e29b-41d4-a716-446655440000',
      sourceRowId: 'p1-r001',
      categoryName: 'Shopping',
      classificationConfidence: 0.85,
      rationale: 'Matched Shopping via retrieval',
      outcome: 'proposed' as const,
      reviewState: 'needs_review' as const,
      retrieval: [
        {
          historyRecordId: 'wallet-001',
          categoryName: 'Shopping',
          description: 'SHOPEE PH',
          amountMinor: -10000,
          date: '2026-07-29',
          score: 0.9,
        },
      ],
      issues: [],
    };
    const res = CategoryProposalSchema.safeParse(proposal);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.sourceRowId).toBe('p1-r001');
  });
});
