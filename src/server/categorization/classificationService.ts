import { randomUUID } from 'node:crypto';
import { LIMITS } from '../ingestion/limits.js';
import { globalSessionStore } from '../ingestion/sessionStore.js';
import type { SessionStore } from '../ingestion/sessionStore.js';
import { retrieveExamples } from './retrieval.js';
import { classifyBaseline } from './baselineClassifier.js';
import { OpenAiCompatibleProvider } from './openAiCompatibleProvider.js';
import type { ClassificationInput } from './provider.js';
import type {
  CategoryProposal,
  ClassificationOutcome,
  Issue,
} from './contracts.js';
import { CategoryProposalSchema } from './contracts.js';

function makeIssue(code: string, message: string, related?: string[]): Issue {
  return {
    code: code as Issue['code'],
    severity: 'info',
    message,
    relatedSourceRowIds: related,
  };
}

export class ClassificationService {
  constructor(private store: SessionStore) {}

  async categorizeSubset(
    sessionId: string,
    sourceRowIds: string[],
    signal?: AbortSignal,
  ): Promise<
    | { proposals: CategoryProposal[] }
    | {
        error: {
          status: number;
          code: string;
          message: string;
          stage?: string;
        };
      }
  > {
    const entry = this.store.getEntry(sessionId);
    if (!entry) {
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found or cleared.',
          stage: 'complete',
        },
      };
    }
    const extraction = entry.result;
    if (!extraction) {
      return {
        error: {
          status: 422,
          code: 'extraction_not_found',
          message: 'No extraction for session.',
          stage: 'validated',
        },
      };
    }
    const phase2 = this.store.getPhase2(sessionId);
    if (
      !phase2 ||
      !phase2.historyRecords ||
      phase2.historyVersion === 0 ||
      phase2.historyRecords.length === 0
    ) {
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Wallet history not imported.',
          stage: 'validated',
        },
      };
    }
    const providerConfig = phase2.providerConfig;
    if (!providerConfig) {
      return {
        error: {
          status: 422,
          code: 'provider_not_configured',
          message: 'Local provider not configured.',
          stage: 'validated',
        },
      };
    }
    const historyRecords = phase2.historyRecords;
    const catalog = phase2.catalog;
    const allowedCategories = new Set(catalog.map((c) => c.categoryName));
    allowedCategories.add('unknown');
    const historyVersionAtStart = phase2.historyVersion;

    let provider: OpenAiCompatibleProvider;
    try {
      provider = new OpenAiCompatibleProvider(
        providerConfig.baseUrl,
        providerConfig.model,
      );
    } catch {
      return {
        error: {
          status: 422,
          code: 'provider_malformed',
          message: 'Provider configuration invalid.',
          stage: 'validated',
        },
      };
    }
    const txMap = new Map<string, (typeof extraction.transactions)[number]>();
    for (const tx of extraction.transactions) txMap.set(tx.sourceRowId, tx);
    const transactions: (typeof extraction.transactions)[number][] = [];
    for (const id of sourceRowIds) {
      const tx = txMap.get(id);
      if (!tx) {
        return {
          error: {
            status: 422,
            code: 'missing_date',
            message: `Source row ${id} not found.`,
            stage: 'validated',
          },
        };
      }
      transactions.push(tx);
    }

    const results: (CategoryProposal | null)[] = new Array(
      transactions.length,
    ).fill(null);
    let index = 0;
    // A single local model commonly serves one generation at a time. Serial
    // inference avoids queueing multiple requests until they all time out,
    // especially while larger models are loading or on memory-limited hosts.
    const CONCURRENCY = 1;
    const runOne = async (tx: (typeof transactions)[number], idx: number) => {
      const current = this.store.getEntry(sessionId);
      if (
        !current ||
        !current.phase2 ||
        current.phase2.historyVersion !== historyVersionAtStart
      )
        return;
      const query = {
        description: tx.description,
        payee: undefined as string | undefined,
        amountMinor: Math.round(tx.amount * 100),
        date: tx.date,
      };
      const retrieval = retrieveExamples(
        query,
        historyRecords,
        LIMITS.MAX_RETRIEVED_EXAMPLES,
      );
      const baseline = classifyBaseline(query, historyRecords);
      let categoryName: string | undefined;
      let confidence: number;
      let rationale: string;
      let outcome: ClassificationOutcome;
      const issues: Issue[] = [];
      const finalRetrieval = retrieval;
      const isBaselineEligible =
        !('unknown' in baseline) &&
        baseline.confidence >= LIMITS.BASELINE_CONFIDENCE;
      if (isBaselineEligible) {
        categoryName = (baseline as { categoryName: string }).categoryName;
        confidence = baseline.confidence;
        rationale = baseline.rationale.slice(0, 500);
        if (!allowedCategories.has(categoryName)) {
          outcome = 'provider_malformed';
          issues.push(
            makeIssue(
              'category_not_allowed',
              `Category "${categoryName}" not in catalog.`,
              [tx.sourceRowId],
            ),
          );
          categoryName = undefined;
          confidence = 0.3;
          rationale = 'Baseline category not allowed; needs review.';
        } else {
          if (confidence < LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD) {
            outcome = 'low_confidence';
            issues.push(
              makeIssue(
                'low_classification_confidence',
                'Baseline confidence below threshold.',
                [tx.sourceRowId],
              ),
            );
          } else {
            outcome = 'proposed';
          }
        }
      } else {
        const input: ClassificationInput = {
          sourceRowId: tx.sourceRowId,
          description: tx.description,
          amountMinor: Math.round(tx.amount * 100),
          date: tx.date,
          payee: undefined,
          categories: [...allowedCategories].filter((c) => c !== 'unknown'),
          examples: retrieval,
          schemaVersion: '1.0.0',
        };
        let providerResult;
        try {
          providerResult = await provider.classify(input, signal);
        } catch {
          providerResult = {
            ok: false as const,
            code: 'unavailable' as const,
            message: 'Provider exception.',
          };
        }
        if (!providerResult.ok) {
          if (providerResult.code === 'unavailable') {
            outcome = 'provider_unavailable';
            issues.push(
              makeIssue('provider_unavailable', 'Local provider unavailable.', [
                tx.sourceRowId,
              ]),
            );
          } else {
            outcome = 'provider_malformed';
            issues.push(
              makeIssue(
                'provider_malformed',
                `Local provider returned malformed output: ${providerResult.message}`.slice(
                  0,
                  500,
                ),
                [tx.sourceRowId],
              ),
            );
          }
          categoryName = undefined;
          confidence = 0.2;
          rationale =
            providerResult.code === 'unavailable'
              ? 'Provider unavailable; needs review.'
              : 'Provider response malformed; needs review.';
        } else {
          const candCat = providerResult.categoryName;
          const candConf = providerResult.confidence;
          const candRationale = providerResult.rationale.slice(0, 500);
          const candExampleIds = providerResult.exampleIds;
          if (!Number.isFinite(candConf) || candConf < 0 || candConf > 1) {
            outcome = 'provider_malformed';
            issues.push(
              makeIssue(
                'provider_malformed',
                'Provider confidence out of range.',
                [tx.sourceRowId],
              ),
            );
            categoryName = undefined;
            confidence = 0.2;
            rationale = 'Provider confidence invalid; needs review.';
          } else if (!allowedCategories.has(candCat)) {
            outcome = 'provider_malformed';
            issues.push(
              makeIssue(
                'category_not_allowed',
                `Category "${candCat}" not in catalog.`,
                [tx.sourceRowId],
              ),
            );
            categoryName = undefined;
            confidence = candConf;
            rationale = 'Provider category not allowed; needs review.';
          } else if (
            candExampleIds.some(
              (id) => !retrieval.some((r) => r.historyRecordId === id),
            )
          ) {
            const validExampleIds = new Set(
              retrieval.map((r) => r.historyRecordId),
            );
            const invalidExampleIds = [
              ...new Set(
                candExampleIds.filter((id) => !validExampleIds.has(id)),
              ),
            ];
            const invalidIdsMessage = invalidExampleIds
              .join(', ')
              .slice(0, 450);
            outcome = 'provider_malformed';
            issues.push(
              makeIssue(
                'provider_malformed',
                `Provider referenced unknown example ID${invalidExampleIds.length === 1 ? '' : 's'}: ${invalidIdsMessage}`,
                [tx.sourceRowId],
              ),
            );
            categoryName = undefined;
            confidence = candConf;
            rationale = 'Provider example reference invalid; needs review.';
          } else {
            if (candCat === 'unknown') {
              outcome = 'unknown';
              categoryName = undefined;
              confidence = candConf;
              rationale = candRationale;
              issues.push(
                makeIssue(
                  'low_classification_confidence',
                  'Provider returned unknown.',
                  [tx.sourceRowId],
                ),
              );
            } else if (candConf < LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD) {
              outcome = 'low_confidence';
              categoryName = candCat;
              confidence = candConf;
              rationale = candRationale;
              issues.push(
                makeIssue(
                  'low_classification_confidence',
                  'Confidence below threshold.',
                  [tx.sourceRowId],
                ),
              );
            } else {
              outcome = 'proposed';
              categoryName = candCat;
              confidence = candConf;
              rationale = candRationale;
            }
          }
        }
      }
      const proposal = {
        proposalId: randomUUID(),
        sourceRowId: tx.sourceRowId,
        categoryName,
        classificationConfidence: confidence,
        rationale,
        outcome: outcome!,
        reviewState: 'needs_review',
        retrieval: finalRetrieval.slice(0, LIMITS.MAX_RETRIEVED_EXAMPLES),
        issues,
      };
      const parsed = CategoryProposalSchema.safeParse(proposal);
      if (!parsed.success) {
        const fallback: CategoryProposal = {
          proposalId: proposal.proposalId,
          sourceRowId: tx.sourceRowId,
          categoryName: undefined,
          classificationConfidence: 0.2,
          rationale: 'Proposal schema invalid; needs review.',
          outcome: 'provider_malformed',
          reviewState: 'needs_review',
          retrieval: finalRetrieval.slice(0, LIMITS.MAX_RETRIEVED_EXAMPLES),
          issues: [
            makeIssue('provider_malformed', 'Proposal validation failed.', [
              tx.sourceRowId,
            ]),
          ],
        };
        results[idx] = fallback;
        return;
      }
      results[idx] = parsed.data;
    };
    const workers: Promise<void>[] = [];
    const worker = async () => {
      while (true) {
        const currentIdx = index++;
        if (currentIdx >= transactions.length) break;
        const cur = this.store.getEntry(sessionId);
        if (
          !cur ||
          !cur.phase2 ||
          cur.phase2.historyVersion !== historyVersionAtStart
        )
          break;
        await runOne(transactions[currentIdx], currentIdx);
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    const finalEntry = this.store.getEntry(sessionId);
    if (
      !finalEntry ||
      !finalEntry.phase2 ||
      finalEntry.phase2.historyVersion !== historyVersionAtStart
    ) {
      return {
        error: {
          status: 409,
          code: 'stale_history',
          message: 'History changed during categorization; retry.',
          stage: 'complete',
        },
      };
    }
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        const tx = transactions[i];
        const retrieval = retrieveExamples(
          {
            description: tx.description,
            amountMinor: Math.round(tx.amount * 100),
            date: tx.date,
          },
          historyRecords,
        );
        results[i] = {
          proposalId: randomUUID(),
          sourceRowId: tx.sourceRowId,
          categoryName: undefined,
          classificationConfidence: 0.2,
          rationale: 'Categorization cancelled; needs review.',
          outcome: 'provider_unavailable',
          reviewState: 'needs_review',
          retrieval,
          issues: [
            makeIssue('provider_unavailable', 'Categorization cancelled.', [
              tx.sourceRowId,
            ]),
          ],
        };
      }
    }
    return { proposals: results as CategoryProposal[] };
  }

  async categorize(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<
    | { result: import('./contracts.js').CategorizationResult }
    | {
        error: {
          status: number;
          code: string;
          message: string;
          stage?: string;
        };
      }
  > {
    const entry = this.store.getEntry(sessionId);
    if (!entry) {
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found or cleared.',
          stage: 'complete',
        },
      };
    }
    const extraction = entry.result;
    if (!extraction || extraction.transactions.length === 0) {
      // No extraction? But spec requires active extraction
      return {
        error: {
          status: 422,
          code: 'extraction_not_found',
          message: 'No extraction for session.',
          stage: 'validated',
        },
      };
    }
    const phase2 = this.store.getPhase2(sessionId);
    if (
      !phase2 ||
      !phase2.historyRecords ||
      phase2.historyVersion === 0 ||
      phase2.historyRecords.length === 0
    ) {
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Wallet history not imported.',
          stage: 'validated',
        },
      };
    }
    const allRowIds = extraction.transactions.map((t) => t.sourceRowId);
    const phase2AtStart = phase2.historyVersion;
    // Mark pending for whole-statement categ
    this.store.setPendingCategorization(sessionId, phase2AtStart);
    const subsetRes = await this.categorizeSubset(sessionId, allRowIds, signal);
    this.store.clearPendingCategorization(sessionId);
    if ('error' in subsetRes) {
      return { error: subsetRes.error };
    }
    const proposalsOrdered = subsetRes.proposals;
    const byOutcome: Record<ClassificationOutcome, number> = {
      proposed: 0,
      unknown: 0,
      low_confidence: 0,
      provider_unavailable: 0,
      provider_malformed: 0,
    };
    for (const p of proposalsOrdered) byOutcome[p.outcome] += 1;
    const categorizationResult = {
      sessionId,
      historyVersion: phase2AtStart,
      proposals: proposalsOrdered,
      summary: { total: proposalsOrdered.length, byOutcome },
    };
    const committed = this.store.setProposals(
      sessionId,
      proposalsOrdered,
      categorizationResult,
      phase2AtStart,
    );
    if (!committed) {
      return {
        error: {
          status: 409,
          code: 'stale_history',
          message: 'Stale history version; proposals discarded.',
          stage: 'complete',
        },
      };
    }
    return { result: categorizationResult };
  }
}

export const globalClassificationService = new ClassificationService(
  globalSessionStore,
);
