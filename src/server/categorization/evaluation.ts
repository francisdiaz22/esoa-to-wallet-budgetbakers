import type { WalletHistoryRecord } from './contracts.js';
import { retrieveExamples } from './retrieval.js';
import { classifyBaseline } from './baselineClassifier.js';
import { LIMITS } from '../ingestion/limits.js';

export type EvaluationCase = {
  id: string;
  description: string;
  amountMinor: number;
  date: string;
  payee?: string;
  expectedCategory: string; // 'unknown' or concrete name
  explanation: string;
};

export type EvaluationPrediction = {
  caseId: string;
  predictedCategory?: string;
  confidence: number;
  outcome:
    | 'proposed'
    | 'unknown'
    | 'low_confidence'
    | 'provider_unavailable'
    | 'provider_malformed';
  rationale?: string;
};

export type EvaluationMetrics = {
  total: number;
  coverage: number; // non-unknown proposal rate = proposed / total (zero denominator => 0)
  precision: number; // correct among proposed / proposedCount (zero => 0)
  unknownRate: number;
  lowConfidenceRate: number;
  malformedUnavailableRate: number;
  perCategorySupport: Record<string, number>;
  confidenceBuckets: {
    range: string;
    count: number;
    correct: number;
    accuracy: number;
  }[];
};

function isCorrect(pred: EvaluationPrediction, expected: string): boolean {
  const predCat = pred.predictedCategory ?? 'unknown';
  if (expected === 'unknown')
    return predCat === 'unknown' || pred.outcome === 'unknown';
  return predCat === expected;
}

export function computeMetrics(
  predictions: EvaluationPrediction[],
  cases: EvaluationCase[],
): EvaluationMetrics {
  const total = cases.length;
  if (total === 0) {
    return {
      total: 0,
      coverage: 0,
      precision: 0,
      unknownRate: 0,
      lowConfidenceRate: 0,
      malformedUnavailableRate: 0,
      perCategorySupport: {},
      confidenceBuckets: [],
    };
  }
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  let proposedCount = 0;
  let correctProposed = 0;
  let unknownCount = 0;
  let lowCount = 0;
  let malformedCount = 0;
  const perCategorySupport: Record<string, number> = {};
  for (const c of cases) {
    perCategorySupport[c.expectedCategory] =
      (perCategorySupport[c.expectedCategory] ?? 0) + 1;
  }

  // confidence buckets
  const buckets = [
    { min: 0, max: 0.2, label: '0.0-0.2' },
    { min: 0.2, max: 0.4, label: '0.2-0.4' },
    { min: 0.4, max: 0.6, label: '0.4-0.6' },
    { min: 0.6, max: 0.8, label: '0.6-0.8' },
    { min: 0.8, max: 1.0, label: '0.8-1.0' },
  ];
  const bucketCounts = buckets.map((b) => ({
    range: b.label,
    count: 0,
    correct: 0,
    accuracy: 0,
  }));

  for (const p of predictions) {
    if (p.outcome === 'proposed') proposedCount++;
    if (p.outcome === 'unknown') unknownCount++;
    if (p.outcome === 'low_confidence') lowCount++;
    if (
      p.outcome === 'provider_malformed' ||
      p.outcome === 'provider_unavailable'
    )
      malformedCount++;

    const expected = caseMap.get(p.caseId)?.expectedCategory;
    if (expected && p.outcome === 'proposed' && isCorrect(p, expected))
      correctProposed++;

    // bucket
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (
        p.confidence >= b.min &&
        (p.confidence < b.max || (b.max === 1.0 && p.confidence <= 1.0))
      ) {
        bucketCounts[i].count++;
        if (expected && isCorrect(p, expected)) bucketCounts[i].correct++;
        break;
      }
    }
  }

  for (const b of bucketCounts) {
    b.accuracy = b.count === 0 ? 0 : b.correct / b.count;
  }

  const coverage = total === 0 ? 0 : proposedCount / total;
  const precision = proposedCount === 0 ? 0 : correctProposed / proposedCount;
  const unknownRate = total === 0 ? 0 : unknownCount / total;
  const lowConfidenceRate = total === 0 ? 0 : lowCount / total;
  const malformedUnavailableRate = total === 0 ? 0 : malformedCount / total;

  return {
    total,
    coverage,
    precision,
    unknownRate,
    lowConfidenceRate,
    malformedUnavailableRate,
    perCategorySupport,
    confidenceBuckets: bucketCounts,
  };
}

export function runBaseline(
  cases: EvaluationCase[],
  historyRecords: WalletHistoryRecord[],
): { predictions: EvaluationPrediction[]; metrics: EvaluationMetrics } {
  const predictions: EvaluationPrediction[] = [];
  for (const c of cases) {
    const query = {
      description: c.description,
      payee: c.payee,
      amountMinor: c.amountMinor,
      date: c.date,
    };
    // Ensure retrieval not mutated: we call baseline which internally retrieves
    const res = classifyBaseline(query, historyRecords);
    if ('unknown' in res) {
      predictions.push({
        caseId: c.id,
        predictedCategory: undefined,
        confidence: res.confidence,
        outcome: 'unknown',
        rationale: res.rationale,
      });
    } else {
      // Baseline high confidence is treated as proposed; else unknown already
      const outcome =
        res.confidence < LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD
          ? 'low_confidence'
          : 'proposed';
      predictions.push({
        caseId: c.id,
        predictedCategory: res.categoryName,
        confidence: res.confidence,
        outcome: outcome as EvaluationPrediction['outcome'],
        rationale: res.rationale,
      });
    }
  }
  const metrics = computeMetrics(predictions, cases);
  return { predictions, metrics };
}

// Fake provider simulation for evaluation (deterministic)
// Map case id to provider behavior for model-assisted mode
export type FakeProviderBehavior =
  'correct' | 'unknown' | 'low_confidence' | 'malformed' | 'unavailable';

export function runWithFakeProvider(
  cases: EvaluationCase[],
  historyRecords: WalletHistoryRecord[],
  behaviorMap: Record<string, FakeProviderBehavior>,
  allowedCategories: Set<string>,
): { predictions: EvaluationPrediction[]; metrics: EvaluationMetrics } {
  const predictions: EvaluationPrediction[] = [];
  for (const c of cases) {
    const query = {
      description: c.description,
      payee: c.payee,
      amountMinor: c.amountMinor,
      date: c.date,
    };
    const retrieval = retrieveExamples(
      query,
      historyRecords,
      LIMITS.MAX_RETRIEVED_EXAMPLES,
    );
    // First try baseline; if baseline would have succeeded, we use baseline (to avoid provider call when eligible)
    const baseline = classifyBaseline(query, historyRecords);
    const baselineEligible =
      !('unknown' in baseline) &&
      baseline.confidence >= LIMITS.BASELINE_CONFIDENCE;
    if (baselineEligible) {
      const outcome =
        baseline.confidence < LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD
          ? 'low_confidence'
          : 'proposed';
      predictions.push({
        caseId: c.id,
        predictedCategory: (baseline as { categoryName: string }).categoryName,
        confidence: baseline.confidence,
        outcome: outcome as EvaluationPrediction['outcome'],
        rationale: baseline.rationale,
      });
      continue;
    }
    // Otherwise simulate provider per behaviorMap
    const behavior = behaviorMap[c.id] ?? 'correct';
    if (behavior === 'unavailable') {
      predictions.push({
        caseId: c.id,
        predictedCategory: undefined,
        confidence: 0.2,
        outcome: 'provider_unavailable',
        rationale: 'Simulated unavailable',
      });
      continue;
    }
    if (behavior === 'malformed') {
      predictions.push({
        caseId: c.id,
        predictedCategory: undefined,
        confidence: 0.2,
        outcome: 'provider_malformed',
        rationale: 'Simulated malformed',
      });
      continue;
    }
    if (behavior === 'unknown') {
      predictions.push({
        caseId: c.id,
        predictedCategory: undefined,
        confidence: 0.3,
        outcome: 'unknown',
        rationale: 'Simulated unknown',
      });
      continue;
    }
    if (behavior === 'low_confidence') {
      const cat = allowedCategories.has(c.expectedCategory)
        ? c.expectedCategory
        : [...allowedCategories][0];
      predictions.push({
        caseId: c.id,
        predictedCategory: cat === 'unknown' ? undefined : cat,
        confidence: 0.4,
        outcome: 'low_confidence',
        rationale: 'Simulated low_confidence',
      });
      continue;
    }
    // correct
    // If expected is unknown, predict unknown
    if (c.expectedCategory === 'unknown') {
      predictions.push({
        caseId: c.id,
        predictedCategory: undefined,
        confidence: 0.3,
        outcome: 'unknown',
        rationale: 'Simulated correct unknown',
      });
    } else {
      // Ensure category allowed
      if (!allowedCategories.has(c.expectedCategory)) {
        predictions.push({
          caseId: c.id,
          predictedCategory: undefined,
          confidence: 0.2,
          outcome: 'provider_malformed',
          rationale: 'Category not allowed',
        });
      } else {
        // Check exampleIds validity - we use first retrieval example if exists
        const exampleIds = retrieval.length
          ? [retrieval[0].historyRecordId]
          : [];
        // Validate confidence
        const conf = 0.85;
        predictions.push({
          caseId: c.id,
          predictedCategory: c.expectedCategory,
          confidence: conf,
          outcome: 'proposed',
          rationale: `Simulated correct for ${c.expectedCategory}; refs ${exampleIds.join(',')}`,
        });
      }
    }
  }
  const metrics = computeMetrics(predictions, cases);
  return { predictions, metrics };
}

export function loadCasesFromJson(json: string): EvaluationCase[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Cases must be array');
  return parsed as EvaluationCase[];
}
