import { LIMITS } from '../ingestion/limits.js';
import type { DuplicateMatch } from './contracts.js';

export type DuplicateCandidateInput = {
  reviewItemId: string;
  sourceRowId: string;
  date: string; // ISO YYYY-MM-DD
  amountMinor: number;
  description: string;
  reference?: string;
};

/**
 * Pure normalization for descriptions and references:
 * Unicode NFKC, case-fold, trim/collapse whitespace, conservative punctuation removal, tokenization.
 * Do not include sourceRowId, raw OCR line order, or classification category as a duplicate signal.
 */
export function normalizeDescription(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeReference(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

export function tokenJaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersect = 0;
  for (const t of aSet) if (bSet.has(t)) intersect++;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersect / union;
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (isNaN(da) || isNaN(db)) return Infinity;
  const diffMs = Math.abs(da - db);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

const WEIGHTS = {
  amount: LIMITS.DUPLICATE_WEIGHT_AMOUNT,
  dateSame: LIMITS.DUPLICATE_WEIGHT_DATE_SAME_DAY,
  dateWithin: LIMITS.DUPLICATE_WEIGHT_DATE_WITHIN_ONE,
  descriptionExact: LIMITS.DUPLICATE_WEIGHT_DESCRIPTION_EXACT,
  reference: LIMITS.DUPLICATE_WEIGHT_REFERENCE,
  threshold: LIMITS.DUPLICATE_NEAR_THRESHOLD,
};

export const DUPLICATE_CONFIG_VERSION = LIMITS.DUPLICATE_VERSION;

/**
 * Deterministic duplicate detection.
 * Returns map from reviewItemId to DuplicateMatch[] sorted deterministically.
 * Does not mutate inputs.
 */
export function detectDuplicates(
  inputs: DuplicateCandidateInput[],
): Map<string, DuplicateMatch[]> {
  // Defensive copy to avoid mutation
  const items = inputs.map((i) => ({ ...i }));
  // Ensure deterministic ordering: sort by sourceRowId ascending, then reviewItemId, to preserve stable default presentation?
  // But spec says retain extraction source order as stable default. Our inputs already in that order; we preserve it.
  // For detection, we use the given order but ensure deterministic output via sorting candidates.
  const normalized = items.map((it) => ({
    ...it,
    normDesc: normalizeDescription(it.description),
    normRef: it.reference ? normalizeReference(it.reference) : undefined,
    tokens: tokenize(normalizeDescription(it.description)),
  }));

  // Exact grouping key: canonical date + signed amountMinor + normalized description + normalized reference when both refs present
  // Build groups
  const exactGroups = new Map<string, typeof normalized>();
  for (const n of normalized) {
    const keyBase = `${n.date}|${n.amountMinor}|${n.normDesc}`;
    // For key, we include reference only when present — but spec says "when both references are present" implies we should only include reference in key if we are comparing two items that both have refs.
    // To implement exact duplicate key, we differentiate groups by whether they have reference and what it is.
    // Simpler: include normRef if present, else no ref segment.
    // key computed but not needed directly — grouping by base key only; reference handled pairwise
    void n.normRef;
    // However spec's exact duplicate key says normalized reference when both references are present — meaning if both have refs, they must be equal to be exact; if one missing, reference not required.
    // So grouping with distinction above may incorrectly split when one has no ref but other has ref yet they share description/date/amount — they would not be exact per our key.
    // Instead we should group by base key first, then within each base group, sub-group by reference when both present.
    // Let's first group by base key.
    if (!exactGroups.has(keyBase)) exactGroups.set(keyBase, []);
    exactGroups.get(keyBase)!.push(n);
  }

  const result = new Map<string, DuplicateMatch[]>();
  for (const id of items) result.set(id.reviewItemId, []);

  // Process exact groups: for each base key group, we need to find items that are exact duplicates
  // Revised: within base group, items are exact if amount equal (already base), date equal, desc exact (already base), and reference condition.
  // Since base already includes date+amount+desc, remaining is reference check.
  for (const [, group] of exactGroups) {
    if (group.length < 2) continue;
    // Partition by reference logic
    // Pairwise check for exact: date same (already), amount same (already), desc exact (already), and reference condition.
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        // Check reference condition for exact
        const bothHaveRef = !!a.normRef && !!b.normRef;
        let refMatches = true;
        if (bothHaveRef) {
          refMatches = a.normRef === b.normRef;
        }
        // If both have ref but mismatch => not exact
        if (!refMatches) continue;
        // This pair is exact
        const score = 1.0; // exact receives 1.0
        const matchedSignals: DuplicateMatch['matchedSignals'] = [
          'date',
          'amount',
          'description',
        ];
        if (bothHaveRef && refMatches) matchedSignals.push('reference');
        const am: DuplicateMatch = {
          candidateReviewItemId: b.reviewItemId,
          candidateSourceRowId: b.sourceRowId,
          matchKind: 'exact',
          score,
          matchedSignals: [
            ...matchedSignals,
          ].sort() as DuplicateMatch['matchedSignals'],
        };
        const bm: DuplicateMatch = {
          candidateReviewItemId: a.reviewItemId,
          candidateSourceRowId: a.sourceRowId,
          matchKind: 'exact',
          score,
          matchedSignals: [
            ...matchedSignals,
          ].sort() as DuplicateMatch['matchedSignals'],
        };
        result.get(a.reviewItemId)!.push(am);
        result.get(b.reviewItemId)!.push(bm);
      }
    }
  }

  // Near-match scoring: only reasonable candidate pairs (exact amount and bounded date window)
  // To avoid double counting exact pairs, skip pairs already marked exact
  const exactPairs = new Set<string>();
  for (const [id, matches] of result) {
    for (const m of matches) {
      if (m.matchKind === 'exact') {
        const key = [id, m.candidateReviewItemId].sort().join('|');
        exactPairs.add(key);
      }
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      const pairKey = [a.reviewItemId, b.reviewItemId].sort().join('|');
      if (exactPairs.has(pairKey)) continue;
      // Filter to reasonable candidates: exact amount and bounded date window (1 day)
      if (a.amountMinor !== b.amountMinor) continue;
      const diff = dateDiffDays(a.date, b.date);
      if (diff > LIMITS.DUPLICATE_DATE_WINDOW_DAYS) continue;

      // Score components
      let score = 0;
      const signals: DuplicateMatch['matchedSignals'] = [];

      // Amount exact
      if (a.amountMinor === b.amountMinor) {
        score += WEIGHTS.amount;
        signals.push('amount');
      }
      // Date
      if (diff === 0) {
        score += WEIGHTS.dateSame;
        signals.push('date');
      } else if (diff === 1) {
        score += WEIGHTS.dateWithin;
        signals.push('date');
      }
      // Description
      if (a.normDesc === b.normDesc) {
        score += WEIGHTS.descriptionExact;
        signals.push('description');
      } else {
        const jacc = tokenJaccard(a.tokens, b.tokens);
        const descScore = jacc * WEIGHTS.descriptionExact; // up to 0.30
        score += descScore;
        if (jacc > 0) signals.push('description'); // only if some token overlap
      }
      // Reference exact when both present
      const bothHaveRef = !!a.normRef && !!b.normRef;
      if (bothHaveRef && a.normRef === b.normRef) {
        score += WEIGHTS.reference;
        signals.push('reference');
      }

      // Clamp
      if (score > 1) score = 1;
      if (!Number.isFinite(score)) score = 0;

      if (score >= WEIGHTS.threshold) {
        const uniqueSignals = [
          ...new Set(signals),
        ].sort() as DuplicateMatch['matchedSignals'];
        const am: DuplicateMatch = {
          candidateReviewItemId: b.reviewItemId,
          candidateSourceRowId: b.sourceRowId,
          matchKind: 'near',
          score: Number(score.toFixed(4)),
          matchedSignals: uniqueSignals,
        };
        const bm: DuplicateMatch = {
          candidateReviewItemId: a.reviewItemId,
          candidateSourceRowId: a.sourceRowId,
          matchKind: 'near',
          score: Number(score.toFixed(4)),
          matchedSignals: uniqueSignals,
        };
        result.get(a.reviewItemId)!.push(am);
        result.get(b.reviewItemId)!.push(bm);
      }
    }
  }

  // Sort each item's matches deterministically by candidateReviewItemId
  for (const [, arr] of result) {
    arr.sort((x, y) =>
      x.candidateReviewItemId.localeCompare(y.candidateReviewItemId),
    );
  }

  return result;
}
