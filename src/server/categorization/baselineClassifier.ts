import { LIMITS } from '../ingestion/limits.js';
import type { RetrievedExample } from './contracts.js';
import { retrieveExamples } from './retrieval.js';
import type { WalletHistoryRecord } from './contracts.js';

function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ');
}

export type BaselineResult =
  | {
      categoryName: string;
      confidence: number;
      rationale: string;
      retrieval: RetrievedExample[];
    }
  | {
      categoryName: undefined;
      confidence: number;
      rationale: string;
      retrieval: RetrievedExample[];
      unknown: true;
    };

const BASELINE_CONFIDENCE = LIMITS.BASELINE_CONFIDENCE; // 0.95
const HIGH_SCORE_THRESHOLD = 0.9;
const MARGIN_THRESHOLD = 0.2;

/**
 * Baseline classifier rules (documented):
 * 1. If exact normalized description has at least one history example, and all exact matches share the same category, propose that category with confidence 0.95.
 * 2. Else if top retrieved score >=0.9 and margin to second-best >=0.2 and top category is unambiguous (top 2 share category or second far), propose top category with confidence = top score.
 * 3. Otherwise return unknown with low confidence and rationale.
 */
export function classifyBaseline(
  query: {
    description: string;
    payee?: string;
    amountMinor: number;
    date: string;
  },
  historyRecords: WalletHistoryRecord[],
): BaselineResult {
  const retrieval = retrieveExamples(
    query,
    historyRecords,
    LIMITS.MAX_RETRIEVED_EXAMPLES,
  );
  const queryNorm = normalizeText(query.description);

  // Rule 1: exact normalized description
  const exactMatches = historyRecords.filter(
    (r) => normalizeText(r.description) === queryNorm,
  );
  if (exactMatches.length > 0) {
    const categories = new Set(exactMatches.map((r) => r.categoryName));
    if (categories.size === 1) {
      const cat = [...categories][0];
      return {
        categoryName: cat,
        confidence: BASELINE_CONFIDENCE,
        rationale: `Exact description match to ${exactMatches.length} history example(s) in category "${cat}".`,
        retrieval,
      };
    } else {
      // ambiguous exact matches -> unknown
      return {
        categoryName: undefined,
        confidence: 0.4,
        rationale: `Exact description matches multiple categories; needs review.`,
        retrieval,
        unknown: true,
      };
    }
  }

  // Rule 2: high score + margin
  if (retrieval.length >= 1) {
    const top = retrieval[0];
    const secondScore = retrieval.length >= 2 ? retrieval[1].score : 0;
    const margin = top.score - secondScore;
    if (top.score >= HIGH_SCORE_THRESHOLD && margin >= MARGIN_THRESHOLD) {
      return {
        categoryName: top.categoryName,
        confidence: Math.min(0.99, top.score),
        rationale: `High retrieval score ${top.score.toFixed(2)} with margin ${margin.toFixed(2)} for category "${top.categoryName}".`,
        retrieval,
      };
    }
  }

  return {
    categoryName: undefined,
    confidence: 0.3,
    rationale: 'No unambiguous baseline match; needs review.',
    retrieval,
    unknown: true,
  };
}
