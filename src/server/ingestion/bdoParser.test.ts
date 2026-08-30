import { describe, expect, it } from 'vitest';
import {
  BdoVisaGoldPhImageParser,
  parseBdoSaleDate,
  parsePhpAmount,
  normalizeDescription,
  normalizeReference,
  classifyExcludedBdoRow,
} from './bdoParser.js';
import { generateSyntheticBdoLines } from './syntheticOcrFixture.js';
import type { ExtractedDocument } from './contracts.js';

describe('normalizers', () => {
  it('parseBdoSaleDate uses statement year not current year', () => {
    expect(parseBdoSaleDate('07-29', 2026)).toBe('2026-07-29');
    expect(parseBdoSaleDate('06-28', 2026)).toBe('2026-06-28');
    expect(() => parseBdoSaleDate('13-01', 2026)).toThrow();
    expect(() => parseBdoSaleDate('02-30', 2026)).toThrow();
    expect(() => parseBdoSaleDate('abc', 2026)).toThrow();
  });
  it('parsePhpAmount accepts documented presentation', () => {
    expect(parsePhpAmount('828.33')).toBe(82833);
    expect(parsePhpAmount('1,632.60')).toBe(163260);
    expect(() => parsePhpAmount('1,632.6')).toThrow();
    expect(() => parsePhpAmount('(123.45)')).toThrow();
  });
  it('normalizeDescription collapses whitespace', () => {
    expect(normalizeDescription('  PC   EXPRESS  ')).toBe('PC EXPRESS');
  });
  it('normalizeReference strips label', () => {
    expect(normalizeReference('Reference: ABC123')).toBe('ABC123');
    expect(() => normalizeReference('Reference:   ')).toThrow();
  });
  it('classifyExcludedBdoRow case/spacing insensitive', () => {
    expect(classifyExcludedBdoRow('PREVIOUS STATEMENT BALANCE')).toBe(
      'previous-balance',
    );
    expect(classifyExcludedBdoRow('previous statement balance')).toBe(
      'previous-balance',
    );
    expect(classifyExcludedBdoRow('PAYMENT RECEIVED - THANK YOU')).toBe(
      'credit-card-payment',
    );
    expect(classifyExcludedBdoRow('SUBTOTAL')).toBe('summary');
    expect(classifyExcludedBdoRow('TOTAL')).toBe('summary');
    expect(classifyExcludedBdoRow('SHOPEE PH')).toBeNull();
  });
});

describe('Bdo parser state machine', () => {
  it('produces new row, handles instalment and reference continuations', () => {
    const parser = new BdoVisaGoldPhImageParser();
    const doc: ExtractedDocument = {
      sourceFormat: 'ocr',
      pages: 1,
      lines: [
        { page: 1, order: 1, text: 'BDO VISA GOLD' },
        { page: 1, order: 2, text: 'Sale Date Post Date Description Amount' },
        { page: 1, order: 3, text: '07-29 PC EXPRESS SM NORTH II 828.33' },
        { page: 1, order: 4, text: 'INSTALMENT 5 OF 12' },
        { page: 1, order: 5, text: '07-29 MONTHLY MEMBERSHIP FEE 200.00' },
        { page: 1, order: 6, text: 'Reference: REF123' },
        { page: 1, order: 7, text: 'PREVIOUS STATEMENT BALANCE 22886.77' },
      ],
      textLength: 100,
    };
    const context = {
      statementId: 'BDO_VGOLD_202608',
      statementYear: 2026,
      currency: 'PHP' as const,
    };
    const result = parser.parse(doc, context);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toBe(
      'PC EXPRESS SM NORTH II | INSTALMENT 5 OF 12',
    );
    expect(result.transactions[0].reference).toBeUndefined();
    expect(result.transactions[1].reference).toBe('REF123');
    expect(result.excludedRows).toHaveLength(1);
    expect(result.excludedRows[0].exclusionReason).toBe('previous-balance');
  });

  it('orphan continuation produces malformed_row warning', () => {
    const parser = new BdoVisaGoldPhImageParser();
    const doc: ExtractedDocument = {
      sourceFormat: 'ocr',
      pages: 1,
      lines: [
        { page: 1, order: 1, text: 'INSTALMENT 5 OF 12' },
        { page: 1, order: 2, text: 'Reference: XYZ' },
      ],
      textLength: 10,
    };
    const result = parser.parse(doc, {
      statementId: 'BDO_VGOLD_202608',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(result.transactions).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'malformed_row')).toBe(true);
  });

  it('recognizes payment sign as excluded not negative expense', () => {
    const parser = new BdoVisaGoldPhImageParser();
    const doc: ExtractedDocument = {
      sourceFormat: 'ocr',
      pages: 1,
      lines: [
        { page: 1, order: 1, text: 'BDO VISA GOLD' },
        { page: 1, order: 2, text: 'Sale Date Post Date Description Amount' },
        { page: 2, order: 3, text: 'PAYMENT RECEIVED - THANK YOU -22886.77' },
      ],
      textLength: 10,
    };
    const r = parser.parse(doc, {
      statementId: 'BDO_VGOLD_202608',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(r.transactions).toHaveLength(0);
    expect(r.excludedRows[0].exclusionReason).toBe('credit-card-payment');
  });

  it('produces deterministic fixture IDs and total for full synthetic', () => {
    const parser = new BdoVisaGoldPhImageParser();
    const lines = generateSyntheticBdoLines();
    const doc: ExtractedDocument = {
      sourceFormat: 'ocr',
      pages: 3,
      lines,
      textLength: 1000,
    };
    const can = parser.canParse(doc);
    expect(can.matched).toBe(true);
    const parsed = parser.parse(doc, {
      statementId: 'BDO_VGOLD_202608',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(parsed.transactions).toHaveLength(33);
    expect(parsed.excludedRows).toHaveLength(4);
    expect(parsed.transactions[0].sourceRowId).toBe('p1-r001');
    expect(parsed.transactions[32].sourceRowId).toBe('p3-r033');
    expect(parsed.excludedRows[0].sourceRowId).toBe('p1-x001');
    expect(parsed.excludedRows[1].sourceRowId).toBe('p2-x002');
    // All negative
    expect(parsed.transactions.every((t) => t.amount < 0)).toBe(true);
    const total = parsed.transactions.reduce(
      (s, t) => s + Math.abs(t.amount),
      0,
    );
    expect(total).toBeCloseTo(34957.17, 2);
  });
});
