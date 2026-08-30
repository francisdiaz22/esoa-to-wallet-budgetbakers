import { LIMITS } from '../ingestion/limits.js';
import type { WalletHistoryRecord, RetrievedExample } from './contracts.js';

function normalizeText(raw: string): string {
  // Unicode NFKC, case-fold, collapse whitespace
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  // Conservative tokenization: split on whitespace, retain alphanumeric tokens
  return normalized.split(/\s+/).filter(Boolean);
}

function tokenOverlapScore(
  queryTokens: string[],
  historyTokens: string[],
): number {
  if (queryTokens.length === 0 || historyTokens.length === 0) return 0;
  const qSet = new Set(queryTokens);
  const hSet = new Set(historyTokens);
  let intersect = 0;
  for (const t of qSet) if (hSet.has(t)) intersect++;
  const union = new Set([...qSet, ...hSet]).size;
  return union === 0 ? 0 : intersect / union;
}

function amountSimilarity(
  queryAmountMinor: number,
  historyAmountMinor: number,
): number {
  const q = Math.abs(queryAmountMinor);
  const h = Math.abs(historyAmountMinor);
  if (q === 0 && h === 0) return 1;
  const max = Math.max(q, h);
  if (max === 0) return 0;
  const diff = Math.abs(q - h);
  const relative = diff / max;
  // Similarity: 1 - relative, clamped 0-1; within 5% => ~0.95, within 20% => 0.8
  return Math.max(0, 1 - relative);
}

function recencyScore(
  historyDate: string,
  minDateMs: number,
  maxDateMs: number,
): number {
  const ms = new Date(historyDate).getTime();
  if (isNaN(ms) || maxDateMs === minDateMs) return 0;
  return (ms - minDateMs) / (maxDateMs - minDateMs); // 0-1
}

/**
 * Deterministic lexical retrieval.
 * Signals (documented):
 * - exact normalized description: 0.5 if equal, else 0
 * - token overlap (Jaccard) weighted 0.3
 * - payee exact normalized match: 0.15 if both present and equal, else 0
 * - amount similarity weighted 0.1 (distance-based)
 * - recency weighted 0.05 (normalized across history window)
 *
 * Total weighted sum capped at 1.0.
 * Tie-breakers: score desc, date desc, recordId asc.
 */
export function retrieveExamples(
  query: {
    description: string;
    payee?: string;
    amountMinor: number;
    date?: string;
  },
  historyRecords: WalletHistoryRecord[],
  maxExamples: number = LIMITS.MAX_RETRIEVED_EXAMPLES,
): RetrievedExample[] {
  if (historyRecords.length === 0) return [];

  const queryNormDesc = normalizeText(query.description);
  const queryTokens = tokenize(queryNormDesc);
  const queryNormPayee = query.payee ? normalizeText(query.payee) : undefined;

  // Precompute date range for recency
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const r of historyRecords) {
    const ms = new Date(r.date).getTime();
    if (!isNaN(ms)) {
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }
  }
  if (!isFinite(minMs)) {
    minMs = 0;
    maxMs = 0;
  }

  const scored: RetrievedExample[] = historyRecords.map((r) => {
    const histNormDesc = normalizeText(r.description);
    const exactDesc = histNormDesc === queryNormDesc ? 0.5 : 0;
    const tokens = tokenize(histNormDesc);
    const overlap = tokenOverlapScore(queryTokens, tokens) * 0.3;
    const histPayeeNorm = r.payee ? normalizeText(r.payee) : undefined;
    const payeeMatch =
      queryNormPayee && histPayeeNorm && queryNormPayee === histPayeeNorm
        ? 0.15
        : 0;
    const amountSim = amountSimilarity(query.amountMinor, r.amountMinor) * 0.1;
    const recency = recencyScore(r.date, minMs, maxMs) * 0.05;

    // Sum, but if exactDesc we already have 0.5, plus others could push over 1? Cap.
    let score = exactDesc + overlap + payeeMatch + amountSim + recency;
    if (score > 1) score = 1;
    // Ensure finite [0,1]
    if (!Number.isFinite(score)) score = 0;
    if (score < 0) score = 0;
    if (score > 1) score = 1;

    return {
      historyRecordId: r.recordId,
      categoryName: r.categoryName,
      payee: r.payee,
      description: r.description,
      amountMinor: r.amountMinor,
      date: r.date,
      score,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const dateB = new Date(b.date).getTime();
    const dateA = new Date(a.date).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return a.historyRecordId.localeCompare(b.historyRecordId);
  });

  return scored.slice(0, maxExamples);
}

// Export helpers for tests
export const _helpers = {
  normalizeText,
  tokenize,
  tokenOverlapScore,
  amountSimilarity,
};
