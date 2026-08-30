import { describe, expect, it } from 'vitest';
import {
  ExtractionResultSchema,
  ExtractedTransactionSchema,
} from './contracts.js';
import {
  parsePhpAmountToMinorUnits,
  minorUnitsToAmount,
  sumMinorUnits,
  formatMinorUnits,
} from './decimal.js';
import { LIMITS } from './limits.js';

describe('contracts', () => {
  it('accepts a valid canonical row', () => {
    const row = {
      sourceRowId: 'p1-r001',
      statementId: 'BDO_VGOLD_202608',
      date: '2026-07-29',
      description: 'PC EXPRESS SM NORTH II QUEZON CITY PH | INSTALMENT 5 OF 12',
      amount: -828.33,
      currency: 'PHP' as const,
      source: {
        format: 'ocr' as const,
        bankParserId: 'bdo-visa-gold-ph-image-v1',
        page: 1,
        row: 2,
        rawText: '07-29 PC EXPRESS SM NORTH II 828.33',
      },
      extractionConfidence: 0.98,
      issues: [],
    };
    expect(ExtractedTransactionSchema.safeParse(row).success).toBe(true);
  });

  it('rejects every required field violation', () => {
    const base = {
      sourceRowId: 'p1-r001',
      statementId: 'BDO_VGOLD_202608',
      date: '2026-07-29',
      description: 'VALID',
      amount: -100,
      currency: 'PHP' as const,
      source: {
        format: 'ocr' as const,
        bankParserId: 'bdo-visa-gold-ph-image-v1',
        rawText: 'raw',
      },
      extractionConfidence: 0.9,
      issues: [],
    };
    // missing date
    expect(
      ExtractedTransactionSchema.safeParse({ ...base, date: '' }).success,
    ).toBe(false);
    // invalid date format
    expect(
      ExtractedTransactionSchema.safeParse({ ...base, date: '2026/07/29' })
        .success,
    ).toBe(false);
    // missing amount (NaN)
    expect(
      ExtractedTransactionSchema.safeParse({ ...base, amount: NaN }).success,
    ).toBe(false);
    // wrong currency
    expect(
      ExtractedTransactionSchema.safeParse({
        ...base,
        currency: 'USD' as unknown as 'PHP',
      }).success,
    ).toBe(false);
    // empty description
    expect(
      ExtractedTransactionSchema.safeParse({ ...base, description: '' })
        .success,
    ).toBe(false);
    // confidence out of range
    expect(
      ExtractedTransactionSchema.safeParse({
        ...base,
        extractionConfidence: 1.5,
      }).success,
    ).toBe(false);
    // source missing rawText
    expect(
      ExtractedTransactionSchema.safeParse({
        ...base,
        source: { format: 'ocr' as const, bankParserId: 'x', rawText: '' },
      }).success,
    ).toBe(false);
  });

  it('validates ExtractionResult boundaries', () => {
    const valid = {
      sessionId: 'abc-123',
      parserId: 'bdo-visa-gold-ph-image-v1',
      statementId: 'BDO_VGOLD_202608',
      sourceFormat: 'ocr' as const,
      transactions: [],
      excludedRows: [],
      issues: [],
      summary: { proposedCount: 0, excludedCount: 0, expenseTotal: 0 },
    };
    expect(ExtractionResultSchema.safeParse(valid).success).toBe(true);
    expect(
      ExtractionResultSchema.safeParse({ ...valid, sessionId: '' }).success,
    ).toBe(false);
  });
});

describe('decimal helper', () => {
  it('preserves centavos and avoids floating error (0.10 + 0.20)', () => {
    const a = parsePhpAmountToMinorUnits('0.10');
    const b = parsePhpAmountToMinorUnits('0.20');
    const sum = sumMinorUnits([a, b]);
    expect(a).toBe(10);
    expect(b).toBe(20);
    expect(sum).toBe(30);
    expect(minorUnitsToAmount(sum)).toBe(0.3);
    expect(minorUnitsToAmount(sum)).not.toBe(0.30000000000000004);
    expect(formatMinorUnits(sum)).toBe('0.30');
  });

  it('parses thousands and validates two fraction digits', () => {
    expect(parsePhpAmountToMinorUnits('1,632.60')).toBe(163260);
    expect(parsePhpAmountToMinorUnits('34,957.17')).toBe(3495717);
    expect(() => parsePhpAmountToMinorUnits('1,632.6')).toThrow();
    expect(() => parsePhpAmountToMinorUnits('1,632.600')).toThrow();
    expect(() => parsePhpAmountToMinorUnits('1,632')).toThrow();
    expect(() => parsePhpAmountToMinorUnits('(1,234.56)')).toThrow();
    expect(() => parsePhpAmountToMinorUnits('1,23.45')).toThrow();
  });

  it('totals match fixture absolute total exactly in minor units', () => {
    const amounts = [
      '828.33',
      '200.00',
      '1885.42',
      '3547.00',
      '1632.60',
      '1869.00',
    ];
    const minors = amounts.map(parsePhpAmountToMinorUnits);
    const total = sumMinorUnits(minors);
    // sum first 6: 828.33+200+1885.42+3547+1632.6+1869 = 9962.35
    expect(total).toBe(996235);
    expect(minorUnitsToAmount(total)).toBe(9962.35);
  });
});

describe('limits', () => {
  it('exposes conservative documented limits', () => {
    expect(LIMITS.MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
    expect(LIMITS.MAX_PAGE_COUNT).toBe(10);
    expect(LIMITS.MIN_PAGE_COUNT).toBe(2);
    expect(LIMITS.MAX_TEXT_LENGTH).toBe(200_000);
  });
});
