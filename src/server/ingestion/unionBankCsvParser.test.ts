import { describe, expect, it } from 'vitest';
import type { ExtractedDocument } from './contracts.js';
import {
  parseUnionBankAmountToMinorUnits,
  parseUnionBankDate,
  UnionBankPhCsvParser,
} from './unionBankCsvParser.js';

function syntheticDocument(): ExtractedDocument {
  const texts = [
    'DATE,DESCRIPTION,CURRENCY,AMOUNT,,,',
    '08/01/2026,SYNTHETIC COFFEE SHOP,PHP,125,,,',
    '08/02/2026,"SYNTHETIC STORE, MANILA",PHP,"1,234.5",,,',
    '08/03/2026,SYNTHETIC CREDIT,PHP,-500.00,,,',
  ];
  return {
    sourceFormat: 'csv',
    pages: 1,
    lines: texts.map((text, index) => ({ page: 1, order: index + 1, text })),
    textLength: texts.join('\n').length,
  };
}

describe('UnionBank CSV parser', () => {
  it('recognizes the stable header and parses synthetic rows', () => {
    const parser = new UnionBankPhCsvParser();
    const document = syntheticDocument();
    expect(parser.canParse(document).matched).toBe(true);
    const parsed = parser.parse(document, {
      statementId: 'UNIONBANK_20260803',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(
      parsed.transactions.map((transaction) => transaction.amount),
    ).toEqual([-125, -1234.5]);
    expect(parsed.transactions[1].description).toBe('SYNTHETIC STORE, MANILA');
    expect(parsed.excludedRows).toHaveLength(1);
    expect(parsed.recognizedCandidateCount).toBe(3);
  });

  it('normalizes full dates and variable decimal precision exactly', () => {
    expect(parseUnionBankDate('02/28/2024')).toBe('2024-02-28');
    expect(() => parseUnionBankDate('02/30/2024')).toThrow();
    expect(parseUnionBankAmountToMinorUnits('123')).toBe(12300);
    expect(parseUnionBankAmountToMinorUnits('123.4')).toBe(12340);
    expect(parseUnionBankAmountToMinorUnits('1,234.56')).toBe(123456);
    expect(() => parseUnionBankAmountToMinorUnits('1,23.45')).toThrow();
  });

  it('does not recognize generic CSV layouts', () => {
    const parser = new UnionBankPhCsvParser();
    const document = syntheticDocument();
    document.lines[0].text = 'date,payee,value';
    expect(parser.canParse(document).matched).toBe(false);
  });
});
