import { describe, expect, it } from 'vitest';
import {
  PNB_PARSER_ID,
  PnbPhEsoaParser,
  resolvePnbParserContext,
} from './pnbParser.js';
import { BdoVisaGoldPhImageParser } from './bdoParser.js';
import { ParserRegistry } from './parserRegistry.js';
import type { ExtractedDocument } from './contracts.js';

function pnbDocument(): ExtractedDocument {
  return {
    sourceFormat: 'ocr',
    pages: 2,
    textLength: 500,
    lines: [
      { page: 1, order: 1, text: 'PESO STATEMENT OF ACCOUNT' },
      {
        page: 1,
        order: 2,
        text: 'STATEMENT NUMBER STATEMENT DATE PAYMENT DUE DATE',
      },
      { page: 1, order: 3, text: '3000006124 AUG 23, 2026 SEP 14, 2026' },
      { page: 1, order: 4, text: 'ACCOUNT DETAILS' },
      {
        page: 1,
        order: 5,
        text: 'TRANS DATE POST DATE REFERENCE NUMBER DESCRIPTION AMOUNT',
      },
      {
        page: 1,
        order: 6,
        text: '24/07 27/07 20850588083 SHOPEE PH MANDALUYONG PHL 229.00',
      },
      {
        page: 1,
        order: 7,
        text: '25/07 27/07 20850552048 SHOPEE PH MANDALUYONG PHL 156.00',
      },
      {
        page: 2,
        order: 8,
        text: '26/07 27/07 20850670341 WATSONS WALTERMART MAL BULACAN PHL 738.00',
      },
    ],
  };
}

describe('PNB eSOA parser', () => {
  it('extracts statement context when table headers and values are separate OCR lines', () => {
    expect(resolvePnbParserContext(pnbDocument())).toEqual({
      statementId: 'PNB_20260823',
      statementYear: 2026,
      currency: 'PHP',
    });
  });

  it('recognizes the PNB account-details layout', () => {
    const result = new PnbPhEsoaParser().canParse(pnbDocument());
    expect(result.matched).toBe(true);
    expect(result.parserId).toBe(PNB_PARSER_ID);
  });

  it('wins registry selection when a long statement resembles BDO generically', () => {
    const document = pnbDocument();
    document.lines = [
      ...document.lines,
      ...Array.from({ length: 30 }, (_, index) => ({
        page: 2,
        order: 9 + index,
        text: `27/07 28/07 208506703${String(index).padStart(2, '0')} MERCHANT ${index} 100.00`,
      })),
    ];

    const result = new ParserRegistry([
      new PnbPhEsoaParser(),
      new BdoVisaGoldPhImageParser(),
    ]).findBestMatch(document);

    expect(result.parser?.id).toBe(PNB_PARSER_ID);
  });

  it('does not become ambiguous when OCR drops NUMBER from the table header', () => {
    const document = pnbDocument();
    document.lines[4] = {
      ...document.lines[4],
      text: 'TRANS DATE POST DATE REFERENCE DESCRIPTION AMOUNT',
    };
    const result = new ParserRegistry([
      new PnbPhEsoaParser(),
      new BdoVisaGoldPhImageParser(),
    ]).findBestMatch(document);
    expect(result.parser?.id).toBe(PNB_PARSER_ID);
  });

  it('parses DD/MM transactions using the statement year and preserves references', () => {
    const parser = new PnbPhEsoaParser();
    const result = parser.parse(pnbDocument(), {
      statementId: 'PNB_20260823',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-24',
      amount: -229,
      reference: '20850588083',
    });
    expect(result.transactions[2].source.page).toBe(2);
    expect(result.transactions.every((row) => row.amount < 0)).toBe(true);
  });

  it('reconstructs rows split across OCR table lines', () => {
    const parser = new PnbPhEsoaParser();
    const document = pnbDocument();
    document.lines = [
      ...document.lines.slice(0, 5),
      { page: 2, order: 8, text: '30/07' },
      { page: 2, order: 9, text: '31/07' },
      { page: 2, order: 10, text: '21250538873' },
      { page: 2, order: 11, text: 'GADC 383BSUMALOL OS FC MALOLOS PHL' },
      { page: 2, order: 12, text: '89.00CR' },
    ];
    const result = parser.parse(document, {
      statementId: 'PNB_20260823',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-30',
      reference: '21250538873',
      amount: -89,
    });

    document.lines = [
      ...document.lines.slice(0, 5),
      {
        page: 2,
        order: 8,
        text: '30 / 07 31 / 07 2125 0538873 ANOTHER MERCHANT 2,450.00',
      },
    ];
    const spaced = parser.parse(document, {
      statementId: 'PNB_20260823',
      statementYear: 2026,
      currency: 'PHP',
    });
    expect(spaced.transactions[0]).toMatchObject({
      reference: '21250538873',
      amount: -2450,
    });
  });
});
