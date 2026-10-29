import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractedDocument } from './contracts.js';
import {
  parseUnionBankAmountToMinorUnits,
  parseUnionBankDate,
  UnionBankPhCsvParser,
} from './unionBankCsvParser.js';

function syntheticDocument(): ExtractedDocument {
  const text = readFileSync(
    resolve(process.cwd(), 'fixtures/synthetic/unionbank/statement.csv'),
    'utf8',
  );
  const texts = text.trim().split(/\r?\n/);
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
    ).toEqual([-125, -1234.5, -49.9, -80]);
    expect(parsed.transactions[1].description).toBe('SYNTHETIC STORE, MANILA');
    expect(parsed.excludedRows).toHaveLength(1);
    expect(parsed.recognizedCandidateCount).toBe(5);
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

  it('recognizes UnionBank exports with empty spreadsheet padding and summary rows', () => {
    const parser = new UnionBankPhCsvParser();
    const document: ExtractedDocument = {
      sourceFormat: 'csv',
      pages: 1,
      lines: [
        { page: 1, order: 1, text: ',,,,,,' },
        { page: 1, order: 2, text: ',STATEMENT BALANCE,PHP,"24,805.63",,,' },
        { page: 1, order: 3, text: ',DATE,DESCRIPTION,CURRENCY,AMOUNT,,' },
        {
          page: 1,
          order: 4,
          text: ',10/12/2026,"ARABICA MITSUKOSHI BGC, TAGUIG, PH",PHP,300,,',
        },
        {
          page: 1,
          order: 5,
          text: ',09/28/2026,Payment via UB Online UB919637,PHP,"-23,213.49",,',
        },
      ],
      textLength: 200,
    };
    expect(parser.canParse(document).matched).toBe(true);
    const parsed = parser.parse(document, {
      statementId: 'UNIONBANK_20261012',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].description).toBe(
      'ARABICA MITSUKOSHI BGC, TAGUIG, PH',
    );
    expect(parsed.transactions[0].amount).toBe(-300);
    expect(parsed.excludedRows).toHaveLength(1);
  });

  it('reports malformed recognized rows without creating a transaction', () => {
    const parser = new UnionBankPhCsvParser();
    const document = syntheticDocument();
    document.lines.push({
      page: 1,
      order: 7,
      text: '08/06/2026,SYNTHETIC BROKEN ROW,PHP,not-money',
    });

    const parsed = parser.parse(document, {
      statementId: 'UNIONBANK_20260806',
      statementYear: 2026,
      currency: 'PHP',
    });

    expect(parsed.transactions).toHaveLength(4);
    expect(parsed.excludedRows).toHaveLength(1);
    expect(parsed.recognizedCandidateCount).toBe(6);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'malformed_row', severity: 'error' }),
      ]),
    );
  });
});
