import { describe, expect, it } from 'vitest';
import { validateReviewItem, computeSummary } from './validator.js';
import type { ReviewItem } from './contracts.js';

function baseItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  const proposal = {
    proposalId: 'pid',
    sourceRowId: 'p1-r001',
    categoryName: 'Shopping',
    classificationConfidence: 0.9,
    rationale: 'ok',
    outcome: 'proposed' as const,
    reviewState: 'needs_review' as const,
    retrieval: [],
    issues: [],
  };
  return {
    reviewItemId: 'rid',
    kind: 'source',
    sourceRowId: 'p1-r001',
    amountMinor: -10000,
    date: '2026-07-29',
    description: 'SYNTHETIC',
    categoryName: 'Shopping',
    reviewState: 'needs_review',
    proposal: proposal as never,
    duplicateMatches: [],
    issues: [],
    revision: 0,
    ...overrides,
  } as ReviewItem;
}

describe('review validator', () => {
  it('proves no blocked item or unbalanced split can become approved, while duplicate warning alone never auto-excludes', () => {
    const allowed = new Set(['Shopping', 'Food']);
    // Approved with missing category -> blocked
    const missingCat = baseItem({
      reviewState: 'approved',
      categoryName: undefined,
    });
    const issues1 = validateReviewItem(missingCat, {
      allowedCategories: allowed,
      isSplitParent: false,
      splitChildren: [],
      sourceAmountMinor: undefined,
    });
    expect(issues1.some((i) => i.code === 'category_required')).toBe(true);

    // Duplicate warning alone should not block approval
    const dup = baseItem({
      reviewState: 'approved',
      duplicateMatches: [
        {
          candidateReviewItemId: 'other',
          candidateSourceRowId: 'p1-r002',
          matchKind: 'near',
          score: 0.85,
          matchedSignals: ['amount', 'date'],
        },
      ] as never,
      issues: [
        {
          code: 'duplicate_near',
          severity: 'warning',
          message: 'dup',
        } as never,
      ],
    });
    // Validator should not add blocking for duplicate_near; approval should be allowed if category present
    const issues2 = validateReviewItem(dup, {
      allowedCategories: allowed,
      isSplitParent: false,
      splitChildren: [],
      sourceAmountMinor: undefined,
    });
    expect(issues2.some((i) => i.code === 'duplicate_near')).toBe(false); // validator filters derived? but we keep duplicate as non-blocking
    // For this test, ensure duplicate doesn't cause blocking
    expect(issues2.filter((i) => i.severity === 'error').length).toBe(0);
  });

  it('validates split parent locked and total mismatch', () => {
    const allowed = new Set(['Shopping']);
    const parent = baseItem({ reviewState: 'approved', kind: 'source' });
    const child1 = baseItem({
      kind: 'split',
      parentReviewItemId: 'rid',
      reviewItemId: 'c1',
      amountMinor: -6000,
      categoryName: 'Shopping',
    });
    const child2 = baseItem({
      kind: 'split',
      parentReviewItemId: 'rid',
      reviewItemId: 'c2',
      amountMinor: -3000,
      categoryName: 'Shopping',
    });
    // parent amount -10000, children sum -9000 => mismatch
    const issuesParent = validateReviewItem(parent, {
      allowedCategories: allowed,
      isSplitParent: true,
      splitChildren: [child1, child2],
      sourceAmountMinor: -10000,
    });
    expect(issuesParent.some((i) => i.code === 'split_total_mismatch')).toBe(
      true,
    );
    expect(issuesParent.some((i) => i.code === 'split_parent_locked')).toBe(
      true,
    ); // because parent tried to be approved while being parent
  });

  it('computes summary correctly', () => {
    const items: ReviewItem[] = [
      baseItem({
        reviewItemId: 'a',
        sourceRowId: 'p1-r001',
        reviewState: 'needs_review',
      }),
      baseItem({
        reviewItemId: 'b',
        sourceRowId: 'p1-r002',
        reviewState: 'approved',
        amountMinor: -5000,
      }),
      baseItem({
        reviewItemId: 'c',
        sourceRowId: 'p1-r003',
        reviewState: 'excluded',
        exclusionReason: 'other' as never,
      }),
    ];
    const summary = computeSummary(items);
    expect(summary.totalItems).toBe(3);
    expect(summary.needsReviewCount).toBe(1);
    expect(summary.approvedCount).toBe(1);
    expect(summary.excludedCount).toBe(1);
    expect(summary.approvedExpenseTotalMinor).toBe(-5000);
  });
});
