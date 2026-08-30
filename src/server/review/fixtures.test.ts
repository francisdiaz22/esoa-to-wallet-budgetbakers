import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDuplicates } from './duplicateDetector.js';

type DuplicateFixture = {
  cases: Array<{
    name: string;
    a: {
      date: string;
      amountMinor: number;
      description: string;
      reference?: string;
    };
    b: {
      date: string;
      amountMinor: number;
      description: string;
      reference?: string;
    };
    expected: 'exact' | 'near' | 'none';
  }>;
};

describe('committed Phase 3 review fixtures', () => {
  it('drives duplicate grouping without mutating fixture inputs', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../fixtures/synthetic/review/duplicate_cases.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as DuplicateFixture;

    for (const [index, testCase] of fixture.cases.entries()) {
      const inputs = [
        {
          reviewItemId: `00000000-0000-4000-8000-${String(index * 2 + 1).padStart(12, '0')}`,
          sourceRowId: `fixture-${index}-a`,
          ...testCase.a,
        },
        {
          reviewItemId: `00000000-0000-4000-8000-${String(index * 2 + 2).padStart(12, '0')}`,
          sourceRowId: `fixture-${index}-b`,
          ...testCase.b,
        },
      ];
      const before = structuredClone(inputs);
      const matches =
        detectDuplicates(inputs).get(inputs[0].reviewItemId) ?? [];
      expect(matches[0]?.matchKind ?? 'none', testCase.name).toBe(
        testCase.expected,
      );
      expect(inputs).toEqual(before);
    }
  });

  it('documents the 33-source to 35-leaf centavo reconciliation', () => {
    const expected = JSON.parse(
      readFileSync(
        new URL(
          '../../../fixtures/synthetic/review/expected_summary.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      sourceChargeCount: number;
      expectedSplits: Array<{ sourceRowId: string; splits: number }>;
      postSplitTotalItems: number;
      approvedExpenseTotalMinor: number;
      postSplitApprovedTotalMinor: number;
    };
    const leafCount =
      expected.sourceChargeCount +
      expected.expectedSplits.reduce(
        (count, split) => count + split.splits - 1,
        0,
      );
    expect(leafCount).toBe(expected.postSplitTotalItems);
    expect(expected.postSplitApprovedTotalMinor).toBe(-3_495_717);
    expect(expected.postSplitApprovedTotalMinor).toBe(
      expected.approvedExpenseTotalMinor,
    );
  });
});
