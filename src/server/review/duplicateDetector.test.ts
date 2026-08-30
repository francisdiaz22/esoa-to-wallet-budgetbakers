import { describe, expect, it } from 'vitest';
import {
  detectDuplicates,
  normalizeDescription,
  normalizeReference,
} from './duplicateDetector.js';

describe('duplicate detector', () => {
  it('covers exact duplicates, near duplicates, same merchant on different legitimate dates, same amount unrelated descriptions', () => {
    const base = {
      date: '2026-07-29',
      amountMinor: -10000,
      description: 'SYNTHETIC MERCHANT A',
      reference: 'REF123',
    };
    const exact1 = { reviewItemId: 'id-1', sourceRowId: 'p1-r001', ...base };
    const exact2 = { reviewItemId: 'id-2', sourceRowId: 'p1-r002', ...base }; // exact same
    const near1 = {
      reviewItemId: 'id-3',
      sourceRowId: 'p1-r003',
      date: '2026-07-30',
      amountMinor: -10000,
      description: 'SYNTHETIC MERCHANT A',
      reference: 'REF123',
    }; // within 1 day, same desc
    const farDate = {
      reviewItemId: 'id-4',
      sourceRowId: 'p1-r004',
      date: '2026-08-10',
      amountMinor: -10000,
      description: 'SYNTHETIC MERCHANT A',
      reference: 'REF123',
    }; // same merchant different legitimate date far
    const unrelated = {
      reviewItemId: 'id-5',
      sourceRowId: 'p1-r005',
      date: '2026-07-29',
      amountMinor: -10000,
      description: 'UNRELATED CAFE B',
      reference: 'REF123',
    }; // same amount different desc

    const map = detectDuplicates([exact1, exact2, near1, farDate, unrelated]);
    // exact duplicates flagged
    expect(
      map
        .get('id-1')!
        .some(
          (m) => m.candidateReviewItemId === 'id-2' && m.matchKind === 'exact',
        ),
    ).toBe(true);
    // near duplicate: id-1 vs id-3 should be near (within 1 day, same amount/desc)
    expect(
      map
        .get('id-1')!
        .some(
          (m) => m.candidateReviewItemId === 'id-3' && m.matchKind === 'near',
        ),
    ).toBe(true);
    // far date should not be near (date diff >1, score below threshold)
    expect(
      map.get('id-1')!.some((m) => m.candidateReviewItemId === 'id-4'),
    ).toBe(false);
    // unrelated description same amount should not be near
    expect(
      map.get('id-1')!.some((m) => m.candidateReviewItemId === 'id-5'),
    ).toBe(false);
  });

  it('covers reference matches, missing references, punctuation/case/Unicode normalization', () => {
    const a = {
      reviewItemId: 'a',
      sourceRowId: 'p1-r001',
      date: '2026-07-29',
      amountMinor: -5000,
      description: '  Synthetic   MERCHANT, A!  ',
      reference: 'REF-123',
    };
    const b = {
      reviewItemId: 'b',
      sourceRowId: 'p1-r002',
      date: '2026-07-29',
      amountMinor: -5000,
      description: 'synthetic merchant a',
      reference: 'ref 123',
    }; // same after normalization
    const c = {
      reviewItemId: 'c',
      sourceRowId: 'p1-r003',
      date: '2026-07-29',
      amountMinor: -5000,
      description: 'synthetic merchant a',
      reference: undefined,
    } as never; // missing reference
    const map = detectDuplicates([a, b, c]);
    expect(
      map
        .get('a')!
        .some(
          (m) => m.candidateReviewItemId === 'b' && m.matchKind === 'exact',
        ),
    ).toBe(true);
    // missing reference: a vs c should still be exact if both refs condition? Since c missing ref, exact should still hold (both refs not present case)
    // Our implementation groups by base key ignoring ref when missing, so a vs c with same desc/date/amount but a has ref, c missing => they share base key but reference condition? Pair a vs c: bothHaveRef false, so they are considered exact (since not both have ref). So they should be exact
    expect(
      map
        .get('a')!
        .some(
          (m) => m.candidateReviewItemId === 'c' && m.matchKind === 'exact',
        ),
    ).toBe(true);
    // Unicode NFKC: e.g., Café vs Cafe with accent normalization?
    expect(normalizeDescription('Caf\u00e9')).toBe(
      normalizeDescription('Cafe\u0301'),
    ); // NFKC should normalize
    expect(normalizeReference('REF-123')).toBe('ref 123');
  });

  it('ensures deterministic ordering, no self-pair, no duplicate pair', () => {
    const items = [
      {
        reviewItemId: 'id-2',
        sourceRowId: 'p1-r002',
        date: '2026-07-29',
        amountMinor: -1000,
        description: 'SAME',
      },
      {
        reviewItemId: 'id-1',
        sourceRowId: 'p1-r001',
        date: '2026-07-29',
        amountMinor: -1000,
        description: 'SAME',
      },
      {
        reviewItemId: 'id-3',
        sourceRowId: 'p1-r003',
        date: '2026-07-29',
        amountMinor: -1000,
        description: 'SAME',
      },
    ];
    const m1 = detectDuplicates(items);
    const m2 = detectDuplicates(items);
    // Deterministic
    expect(JSON.stringify([...m1.entries()])).toBe(
      JSON.stringify([...m2.entries()]),
    );
    // No self-pair
    for (const [id, matches] of m1) {
      expect(matches.some((m) => m.candidateReviewItemId === id)).toBe(false);
    }
    // No duplicate pair duplication (each pair appears once per direction, but not twice)
    const pairCount = new Map<string, number>();
    for (const [id, matches] of m1) {
      for (const m of matches) {
        const key = [id, m.candidateReviewItemId].sort().join('|');
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
    for (const [, count] of pairCount) {
      // Each unordered pair should appear exactly twice (once per direction), but we count per direction so 2
      expect(count).toBe(2);
    }
    // Sorted by candidateReviewItemId
    for (const [, matches] of m1) {
      const sorted = [...matches].sort((a, b) =>
        a.candidateReviewItemId.localeCompare(b.candidateReviewItemId),
      );
      expect(JSON.stringify(matches)).toBe(JSON.stringify(sorted));
    }
  });

  it('does not mutate inputs', () => {
    const items = [
      {
        reviewItemId: 'id-1',
        sourceRowId: 'p1-r001',
        date: '2026-07-29',
        amountMinor: -1000,
        description: 'A',
      },
    ];
    const copy = JSON.parse(JSON.stringify(items));
    detectDuplicates(items as never);
    expect(items).toEqual(copy);
  });
});
