import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { globalSessionStore } from '../ingestion/sessionStore.js';
import { TemporaryWorkspace } from '../ingestion/workspace.js';
import { bdoParser } from '../ingestion/bdoParser.js';
import { ParserRegistry } from '../ingestion/parserRegistry.js';
import {
  validateParsedStatement,
  assembleResult,
} from '../ingestion/validation.js';
import { generateSyntheticBdoLines } from '../ingestion/syntheticOcrFixture.js';
import {
  parseHistoryCsv,
  historyAdapterMeta,
} from '../categorization/historyAdapter.js';
import { buildCatalog } from '../categorization/catalog.js';
import { retrieveExamples } from '../categorization/retrieval.js';
import { classifyBaseline } from '../categorization/baselineClassifier.js';
import { globalReviewService } from '../review/reviewService.js';
import { LIMITS } from '../ingestion/limits.js';
import type { ExtractedDocument } from '../ingestion/contracts.js';

// Demo is offline, credential-free, synthetic-only, stops before Wallet write.
// Visibly labels every record as synthetic and cannot contact Wallet or model endpoint.

export const DEMO_VERSION = '1.0.0';
export const DEMO_FIXTURE_ID = 'synthetic-bdo-v1';

const demoSessionIds = new Set<string>();

export function isDemoSession(sessionId: string): boolean {
  return demoSessionIds.has(sessionId);
}

export function markDemoSession(sessionId: string): void {
  demoSessionIds.add(sessionId);
}

export function unmarkDemoSession(sessionId: string): void {
  demoSessionIds.delete(sessionId);
}

export function createDemoSession():
  | {
      sessionId: string;
      extraction: ReturnType<typeof globalSessionStore.get>;
      historySummary: ReturnType<typeof globalSessionStore.getHistorySummary>;
      categorizationResult: ReturnType<
        typeof globalSessionStore.getCategorizationResult
      >;
      review: ReturnType<typeof globalReviewService.getReview>;
    }
  | {
      error: { status: number; code: string; message: string; stage?: string };
    } {
  const sessionId = randomUUID();
  const workspace = new TemporaryWorkspace(sessionId);

  // Build synthetic document from deterministic fake OCR lines (no file I/O, no network)
  const lines = generateSyntheticBdoLines();
  const rawText = lines.map((l) => l.text).join('\n');
  const doc: ExtractedDocument = {
    sourceFormat: 'ocr',
    pages: 3,
    lines,
    textLength: rawText.length,
  };

  // Parser detection + parse via normal registry path
  const registry = new ParserRegistry([bdoParser]);
  const match = registry.findBestMatch(doc);
  if (!match.parser) {
    return {
      error: {
        status: 422,
        code: 'unsupported_layout',
        message: 'Demo layout not recognized.',
        stage: 'parsing',
      },
    };
  }
  const context = {
    statementId: 'BDO_VGOLD_20260729',
    statementYear: 2026,
    currency: 'PHP' as const,
  };
  let parsed;
  try {
    parsed = match.parser.parse(doc, context);
  } catch {
    return {
      error: {
        status: 422,
        code: 'missing_statement_context',
        message: 'Demo statement context invalid.',
        stage: 'parsing',
      },
    };
  }
  const validation = validateParsedStatement(parsed);
  if (!validation.valid) {
    return {
      error: {
        status: 422,
        code: validation.error ?? 'invalid_extraction',
        message: 'Demo validation failed.',
        stage: 'normalizing',
      },
    };
  }
  const assembled = assembleResult(parsed, sessionId, validation.issues);
  const extraction = globalSessionStore.createWithId(
    sessionId,
    {
      parserId: assembled.result.parserId,
      statementId: assembled.result.statementId,
      sourceFormat: assembled.result.sourceFormat,
      transactions: assembled.result.transactions,
      excludedRows: assembled.result.excludedRows,
      issues: assembled.result.issues,
      summary: assembled.result.summary,
    },
    workspace,
  );
  markDemoSession(sessionId);

  // History import via normal adapter using allowlisted synthetic fixture
  const syntheticHistoryCsv = readFileSync(
    'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
  );
  const parsedHistory = parseHistoryCsv(syntheticHistoryCsv);
  if ('error' in parsedHistory) {
    globalSessionStore.clear(sessionId);
    unmarkDemoSession(sessionId);
    return {
      error: {
        status: 422,
        code: parsedHistory.error.code,
        message: parsedHistory.error.message,
        stage: 'validated',
      },
    };
  }
  const catalogRes = buildCatalog(parsedHistory.records);
  if ('error' in catalogRes) {
    globalSessionStore.clear(sessionId);
    unmarkDemoSession(sessionId);
    return {
      error: {
        status: 422,
        code: catalogRes.error.code,
        message: catalogRes.error.message,
        stage: 'validated',
      },
    };
  }
  const historySummary = globalSessionStore.setHistory(
    sessionId,
    parsedHistory.records,
    catalogRes.catalog,
    {
      recordCount: parsedHistory.summary.recordCount,
      categoryCount: parsedHistory.summary.categoryCount,
      accountCount: parsedHistory.summary.accountCount,
      adapterId: historyAdapterMeta.adapterId,
      adapterVersion: historyAdapterMeta.adapterVersion,
      historyVersion: 0,
    },
  );

  // Categorization via deterministic in-process baseline + fake provider logic (no network)
  // For demo we run baseline-first; if baseline not eligible, synthesize a valid provider-like result from catalog without contacting loopback
  const historyRecords = parsedHistory.records;
  const catalog = catalogRes.catalog;
  const allowedCategories = new Set(catalog.map((c) => c.categoryName));
  allowedCategories.add('unknown');

  const proposals = extraction.transactions.map((tx) => {
    const query = {
      description: tx.description,
      amountMinor: Math.round(tx.amount * 100),
      date: tx.date,
    };
    const retrieval = retrieveExamples(
      query,
      historyRecords,
      LIMITS.MAX_RETRIEVED_EXAMPLES,
    );
    const baseline = classifyBaseline(query, historyRecords);
    const isBaselineEligible =
      !('unknown' in baseline) &&
      (baseline as { confidence: number }).confidence >=
        LIMITS.BASELINE_CONFIDENCE;
    let categoryName: string | undefined;
    let confidence: number;
    let rationale: string;
    let outcome:
      | 'proposed'
      | 'unknown'
      | 'low_confidence'
      | 'provider_unavailable'
      | 'provider_malformed';
    const issues: { code: string; severity: string; message: string }[] = [];

    if (isBaselineEligible) {
      const b = baseline as {
        categoryName: string;
        confidence: number;
        rationale: string;
      };
      if (!allowedCategories.has(b.categoryName)) {
        categoryName = undefined;
        confidence = 0.3;
        rationale =
          'Synthetic demo data — not a financial record. Baseline category not allowed; needs review.';
        outcome = 'provider_malformed';
        issues.push({
          code: 'category_not_allowed',
          severity: 'warning',
          message: `Category "${b.categoryName}" not in catalog.`,
        });
      } else if (b.confidence < LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD) {
        categoryName = b.categoryName;
        confidence = b.confidence;
        rationale =
          'Synthetic demo data — not a financial record. ' + b.rationale;
        outcome = 'low_confidence';
        issues.push({
          code: 'low_classification_confidence',
          severity: 'info',
          message: 'Confidence below threshold.',
        });
      } else {
        categoryName = b.categoryName;
        confidence = b.confidence;
        rationale =
          'Synthetic demo data — not a financial record. ' + b.rationale;
        outcome = 'proposed';
      }
    } else {
      // Deterministic fake: pick first retrieval category if available, else unknown
      const first = retrieval[0];
      if (first && allowedCategories.has(first.categoryName)) {
        categoryName = first.categoryName;
        confidence = 0.72;
        rationale = `Synthetic demo data — not a financial record. Demo fake rationale for ${categoryName}.`;
        outcome = 'proposed';
      } else {
        categoryName = undefined;
        confidence = 0.3;
        rationale =
          'Synthetic demo data — not a financial record. No relevant history example; needs review.';
        outcome = 'unknown';
        issues.push({
          code: 'low_classification_confidence',
          severity: 'info',
          message: 'Demo unknown; needs review.',
        });
      }
    }

    return {
      proposalId: randomUUID(),
      sourceRowId: tx.sourceRowId,
      categoryName,
      classificationConfidence: confidence,
      rationale: rationale.slice(0, 500),
      outcome,
      reviewState: 'needs_review' as const,
      retrieval,
      issues,
    };
  });

  const byOutcome: Record<string, number> = {
    proposed: 0,
    unknown: 0,
    low_confidence: 0,
    provider_unavailable: 0,
    provider_malformed: 0,
  };
  for (const p of proposals)
    byOutcome[p.outcome] = (byOutcome[p.outcome] ?? 0) + 1;

  const categorizationResult = {
    sessionId,
    historyVersion: historySummary!.historyVersion,
    proposals,
    summary: { total: proposals.length, byOutcome },
  };
  const committed = globalSessionStore.setProposals(
    sessionId,
    proposals as never,
    categorizationResult as never,
    historySummary!.historyVersion,
  );
  if (!committed) {
    globalSessionStore.clear(sessionId);
    unmarkDemoSession(sessionId);
    return {
      error: {
        status: 409,
        code: 'stale_history',
        message: 'Demo history version conflict.',
        stage: 'complete',
      },
    };
  }

  // Initialize review via normal ReviewService path
  const reviewInit = globalReviewService.initialize(sessionId);
  if ('error' in reviewInit) {
    globalSessionStore.clear(sessionId);
    unmarkDemoSession(sessionId);
    return { error: reviewInit.error };
  }

  return {
    sessionId,
    extraction,
    historySummary,
    categorizationResult: globalSessionStore.getCategorizationResult(sessionId),
    review: globalReviewService.getReview(sessionId),
  };
}
