import { describe, expect, it } from 'vitest';
import {
  ReviewItemSchema,
  DuplicateMatchSchema,
  ReviewAuditEventSchema,
} from './contracts.js';

describe('Review contracts', () => {
  const baseProposal = {
    proposalId: '550e8400-e29b-41d4-a716-446655440000',
    sourceRowId: 'p1-r001',
    categoryName: 'Shopping',
    classificationConfidence: 0.85,
    rationale: 'Matched Shopping via retrieval',
    outcome: 'proposed' as const,
    reviewState: 'needs_review' as const,
    retrieval: [],
    issues: [],
  };

  function validReviewItem(overrides: Record<string, unknown> = {}) {
    return {
      reviewItemId: '550e8400-e29b-41d4-a716-446655440001',
      kind: 'source' as const,
      sourceRowId: 'p1-r001',
      amountMinor: -10000,
      date: '2026-07-29',
      description: 'SYNTHETIC MERCHANT',
      categoryName: 'Shopping',
      reviewState: 'needs_review' as const,
      proposal: baseProposal,
      duplicateMatches: [],
      issues: [],
      revision: 0,
      ...overrides,
    };
  }

  it('rejects invalid IDs, non-ISO dates, non-finite scores, amount floats', () => {
    expect(
      ReviewItemSchema.safeParse({ ...validReviewItem(), reviewItemId: '' })
        .success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({ ...validReviewItem(), date: '2026/07/29' })
        .success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({ ...validReviewItem(), date: '2026-02-31' })
        .success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({ ...validReviewItem(), amountMinor: 100.5 })
        .success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({ ...validReviewItem(), amountMinor: NaN })
        .success,
    ).toBe(false);
    expect(
      DuplicateMatchSchema.safeParse({
        candidateReviewItemId: 'a',
        candidateSourceRowId: 'p1-r001',
        matchKind: 'exact',
        score: NaN,
        matchedSignals: ['amount'],
      }).success,
    ).toBe(false);
    expect(
      DuplicateMatchSchema.safeParse({
        candidateReviewItemId: 'a',
        candidateSourceRowId: 'p1-r001',
        matchKind: 'exact',
        score: 1.5,
        matchedSignals: ['amount'],
      }).success,
    ).toBe(false);
  });

  it('rejects unbounded strings and invalid split lineage', () => {
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        description: 'a'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        kind: 'split' as const,
      }).success,
    ).toBe(false); // missing parent
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        kind: 'source' as const,
        parentReviewItemId: 'parent',
      }).success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        payee: 'a'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('rejects invalid exclusion state and categoryless approvals (schema)', () => {
    // excluded requires reason
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        reviewState: 'excluded' as const,
      }).success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        reviewState: 'approved' as const,
        categoryName: undefined,
      }).success,
    ).toBe(false);
    // excluded with reason ok
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        reviewState: 'excluded' as const,
        exclusionReason: 'other' as const,
      }).success,
    ).toBe(true);
    // needs_review with exclusionReason should fail
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        reviewState: 'needs_review' as const,
        exclusionReason: 'other' as const,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown issue/action values', () => {
    expect(
      ReviewItemSchema.safeParse({
        ...validReviewItem(),
        issues: [{ code: 'unknown_code', severity: 'error', message: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      ReviewAuditEventSchema.safeParse({
        eventId: 'a',
        occurredAt: '2026-01-01T00:00:00.000Z',
        action: 'invalid_action' as unknown as string,
        sourceRowId: 'p1-r001',
        safeDetails: {},
      }).success,
    ).toBe(false);
    expect(
      ReviewAuditEventSchema.safeParse({
        eventId: 'a',
        occurredAt: 'not-iso',
        action: 'approved',
        sourceRowId: 'p1-r001',
        safeDetails: {},
      }).success,
    ).toBe(false);
  });

  it('accepts valid source and split items', () => {
    const source = validReviewItem();
    expect(ReviewItemSchema.safeParse(source).success).toBe(true);
    const split = validReviewItem({
      kind: 'split' as const,
      parentReviewItemId: '550e8400-e29b-41d4-a716-446655440002',
      reviewItemId: '550e8400-e29b-41d4-a716-446655440003',
    });
    expect(ReviewItemSchema.safeParse(split).success).toBe(true);
  });
});
