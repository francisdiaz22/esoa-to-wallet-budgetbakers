import { describe, expect, it } from 'vitest';
import { validateParsedStatement } from './validation.js';
import type { ParsedStatement } from './contracts.js';

function baseParsed(): ParsedStatement {
  return {
    parserId: 'bdo-visa-gold-ph-image-v1',
    statementId: 'BDO_VGOLD_202608',
    sourceFormat: 'ocr',
    transactions: [
      {
        sourceRowId: 'p1-r001',
        statementId: 'BDO_VGOLD_202608',
        date: '2026-07-29',
        description: 'TEST',
        amount: -100.5,
        currency: 'PHP',
        source: {
          format: 'ocr',
          bankParserId: 'bdo-visa-gold-ph-image-v1',
          page: 1,
          row: 1,
          rawText: '07-29 TEST 100.50',
        },
        extractionConfidence: 0.98,
        issues: [],
      },
    ],
    excludedRows: [],
    issues: [],
    recognizedCandidateCount: 1,
  };
}

describe('validation', () => {
  it('rejects missing date/amount, invalid decimal, empty description', () => {
    const p1 = baseParsed();
    p1.transactions[0].date = '';
    expect(validateParsedStatement(p1).valid).toBe(false);
    expect(validateParsedStatement(p1).error).toBe('missing_date');

    const p2 = baseParsed();
    p2.transactions[0].amount = NaN;
    expect(validateParsedStatement(p2).valid).toBe(false);

    const p3 = baseParsed();
    p3.transactions[0].description = '   ';
    expect(validateParsedStatement(p3).valid).toBe(false);
  });
  it('rejects duplicate sourceRowId', () => {
    const p = baseParsed();
    p.transactions.push({ ...p.transactions[0] });
    expect(validateParsedStatement(p).valid).toBe(false);
    expect(validateParsedStatement(p).error).toBe('duplicate_sourceRowId');
  });
  it('rejects missing source evidence', () => {
    const p = baseParsed();
    // @ts-expect-error missing rawText
    p.transactions[0].source = {
      format: 'ocr',
      bankParserId: 'x',
      rawText: '',
    };
    expect(validateParsedStatement(p).valid).toBe(false);
  });
  it('passes valid', () => {
    expect(validateParsedStatement(baseParsed()).valid).toBe(true);
  });
  it('preserves a transaction and adds a visible suspicious_balance warning', () => {
    const parsed = baseParsed();
    parsed.transactions[0].balance = 1_000.001;

    const validation = validateParsedStatement(parsed);

    expect(validation.valid).toBe(true);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'suspicious_balance',
        severity: 'warning',
        relatedSourceRowIds: ['p1-r001'],
      }),
    );
    expect(parsed.transactions[0].issues).toContainEqual(
      expect.objectContaining({ code: 'suspicious_balance' }),
    );
  });
  it('rejects parser errors and silently dropped candidate counts', () => {
    const withError = baseParsed();
    withError.issues.push({
      code: 'invalid_decimal',
      severity: 'error',
      message: 'Candidate amount was invalid.',
    });
    expect(validateParsedStatement(withError).error).toBe('invalid_decimal');

    const missingCandidate = baseParsed();
    missingCandidate.recognizedCandidateCount = 2;
    expect(validateParsedStatement(missingCandidate).error).toBe(
      'candidate_count_mismatch',
    );
  });
});
