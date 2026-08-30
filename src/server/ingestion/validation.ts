import type { ParsedStatement, Issue } from './contracts.js';
import { ExtractionResultSchema } from './contracts.js';
import { minorUnitsToAmount, sumMinorUnits } from './decimal.js';

function isMinorUnitSafe(value: number): boolean {
  const scaled = value * 100;
  return (
    Number.isSafeInteger(Math.round(scaled)) &&
    Math.abs(scaled - Math.round(scaled)) < 1e-7
  );
}

export function validateParsedStatement(parsed: ParsedStatement): {
  valid: boolean;
  issues: Issue[];
  error?: string;
} {
  const issues: Issue[] = [...parsed.issues];
  const parserError = issues.find((issue) => issue.severity === 'error');
  if (parserError) {
    return { valid: false, issues, error: parserError.code };
  }
  // Rule: missing/invalid ISO date
  for (const tx of parsed.transactions) {
    if (!tx.date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'missing_date',
            severity: 'error',
            message: `missing date for ${tx.sourceRowId}`,
            relatedSourceRowIds: [tx.sourceRowId],
          },
        ],
        error: 'missing_date',
      };
    }
    const d = new Date(tx.date);
    if (isNaN(d.getTime())) {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'missing_date',
            severity: 'error',
            message: `invalid date ${tx.date}`,
          },
        ],
        error: 'missing_date',
      };
    }
    if (tx.amount === null || tx.amount === undefined) {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'missing_amount',
            severity: 'error',
            message: `missing amount ${tx.sourceRowId}`,
          },
        ],
        error: 'missing_amount',
      };
    }
    if (!Number.isFinite(tx.amount) || !isMinorUnitSafe(tx.amount)) {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'invalid_decimal',
            severity: 'error',
            message: `invalid amount ${tx.sourceRowId}`,
          },
        ],
        error: 'invalid_decimal',
      };
    }
    if (tx.description.trim().length === 0) {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'malformed_row',
            severity: 'error',
            message: `empty description ${tx.sourceRowId}`,
          },
        ],
        error: 'malformed_row',
      };
    }
    if (tx.currency !== 'PHP') {
      return {
        valid: false,
        issues: [
          ...issues,
          {
            code: 'unsupported_currency',
            severity: 'error',
            message: `unsupported currency ${tx.currency}`,
          },
        ],
        error: 'unsupported_currency',
      };
    }
    if (!tx.source || !tx.source.bankParserId || !tx.source.rawText) {
      return { valid: false, issues, error: 'missing_source_evidence' };
    }
    if (
      tx.extractionConfidence < 0 ||
      tx.extractionConfidence > 1 ||
      !Number.isFinite(tx.extractionConfidence)
    ) {
      return { valid: false, issues, error: 'invalid_confidence' };
    }
  }
  // Duplicate sourceRowId
  const seen = new Set<string>();
  for (const tx of parsed.transactions) {
    if (seen.has(tx.sourceRowId)) {
      return { valid: false, issues, error: 'duplicate_sourceRowId' };
    }
    seen.add(tx.sourceRowId);
  }
  for (const ex of parsed.excludedRows) {
    if (seen.has(ex.sourceRowId))
      return { valid: false, issues, error: 'duplicate_sourceRowId' };
    seen.add(ex.sourceRowId);
    if (!ex.rawText || !ex.exclusionReason)
      return { valid: false, issues, error: 'missing_excluded_evidence' };
  }
  if (
    parsed.recognizedCandidateCount !==
    parsed.transactions.length + parsed.excludedRows.length
  ) {
    return { valid: false, issues, error: 'candidate_count_mismatch' };
  }
  for (const tx of parsed.transactions) {
    if (
      tx.balance !== undefined &&
      (!Number.isFinite(tx.balance) || !isMinorUnitSafe(tx.balance))
    ) {
      const warning: Issue = {
        code: 'suspicious_balance',
        severity: 'warning',
        message: 'Balance is not representable as an exact PHP centavo value.',
        relatedSourceRowIds: [tx.sourceRowId],
      };
      if (!tx.issues.some((issue) => issue.code === warning.code)) {
        tx.issues.push(warning);
      }
      if (
        !issues.some(
          (issue) =>
            issue.code === warning.code &&
            issue.relatedSourceRowIds?.includes(tx.sourceRowId),
        )
      ) {
        issues.push(warning);
      }
    }
  }

  // Validate via zod
  const candidate = {
    sessionId: 'test-session',
    parserId: parsed.parserId,
    statementId: parsed.statementId,
    sourceFormat: parsed.sourceFormat,
    transactions: parsed.transactions,
    excludedRows: parsed.excludedRows,
    issues,
    summary: {
      proposedCount: parsed.transactions.length,
      excludedCount: parsed.excludedRows.length,
      expenseTotal: minorUnitsToAmount(
        sumMinorUnits(
          parsed.transactions.map((transaction) =>
            Math.abs(Math.round(transaction.amount * 100)),
          ),
        ),
      ),
    },
  };
  const z = ExtractionResultSchema.safeParse(candidate);
  if (!z.success) {
    return { valid: false, issues, error: 'schema_validation_failed' };
  }
  return { valid: true, issues };
}

export function assembleResult(
  parsed: ParsedStatement,
  sessionId: string,
  validationIssues: Issue[] = parsed.issues,
): { result: import('./contracts.js').ExtractionResult; issues: Issue[] } {
  const issues = [...validationIssues];
  const expenseTotal = minorUnitsToAmount(
    sumMinorUnits(
      parsed.transactions.map((transaction) =>
        Math.abs(Math.round(transaction.amount * 100)),
      ),
    ),
  );
  const result = {
    sessionId,
    parserId: parsed.parserId,
    statementId: parsed.statementId,
    sourceFormat: parsed.sourceFormat,
    transactions: parsed.transactions,
    excludedRows: parsed.excludedRows,
    issues,
    summary: {
      proposedCount: parsed.transactions.length,
      excludedCount: parsed.excludedRows.length,
      expenseTotal,
    },
  };
  return { result, issues };
}
