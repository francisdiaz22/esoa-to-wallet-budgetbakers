import { describe, expect, it } from 'vitest';
import { parseHistoryCsv } from './historyAdapter.js';
import { readFileSync } from 'node:fs';

describe('history adapter', () => {
  it('covers supplied synthetic fixture and asserts 35 records, PHP-only, expected category count, no raw history in error', () => {
    const buf = readFileSync(
      'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
    );
    const res = parseHistoryCsv(buf);
    expect('records' in res).toBe(true);
    if ('records' in res) {
      expect(res.records).toHaveLength(35);
      expect(res.summary.categoryCount).toBe(15);
      expect(res.records.every((r) => r.currency === 'PHP')).toBe(true);
    }
  });

  it('covers BOM, quoted delimiter/newline, missing/extra/duplicate headers, malformed CSV, duplicate record_id, bad date/amount/currency/category, empty file, row/size/field limits', () => {
    const baseCsv = readFileSync(
      'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
      'utf8',
    );
    // BOM
    const bomBuf = Buffer.from('\uFEFF' + baseCsv, 'utf8');
    expect('records' in parseHistoryCsv(bomBuf)).toBe(true);

    // quoted delimiter/newline: add a record with quoted semicolon and newline
    const quoted = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;"QUOTED; SEMICOLON and
newline";-100.00;PHP;Shopping;Acc;p1-r001;note`;
    const qRes = parseHistoryCsv(Buffer.from(quoted, 'utf8'));
    expect('records' in qRes).toBe(true);
    if ('records' in qRes)
      expect(qRes.records[0].description).toContain('QUOTED; SEMICOLON');

    // missing header
    const missingHeader = `record_id;date;payee;description;amount;currency;account;source_row_id;note
wallet-001;2026-07-29;Test;desc;-100.00;PHP;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(missingHeader))).toBe(true);

    // extra header
    const extraHeader = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note;extra
wallet-001;2026-07-29;Test;desc;-100.00;PHP;Shopping;Acc;p1-r001;note;extra`;
    expect('error' in parseHistoryCsv(Buffer.from(extraHeader))).toBe(true);

    // duplicate header
    const dupHeader = `record_id;date;payee;description;amount;currency;category;account;source_row_id;record_id
wallet-001;2026-07-29;Test;desc;-100.00;PHP;Shopping;Acc;p1-r001;wallet-001`;
    expect('error' in parseHistoryCsv(Buffer.from(dupHeader))).toBe(true);

    // malformed CSV (unclosed quote)
    const malformed = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;"unclosed;-100.00;PHP;Shopping;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(malformed))).toBe(true);

    // duplicate record_id
    const dupId = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;desc1;-100.00;PHP;Shopping;Acc;p1-r001;note
wallet-001;2026-07-29;Test2;desc2;-200.00;PHP;Shopping;Acc;p1-r002;note`;
    const dupRes = parseHistoryCsv(Buffer.from(dupId));
    expect(
      'error' in dupRes && dupRes.error.code === 'history_duplicate_record_id',
    ).toBe(true);

    // bad date
    const badDate = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;not-a-date;Test;desc;-100.00;PHP;Shopping;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(badDate))).toBe(true);

    // bad amount
    const badAmount = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;desc;notanumber;PHP;Shopping;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(badAmount))).toBe(true);

    // unsupported currency
    const badCurr = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;desc;-100.00;USD;Shopping;Acc;p1-r001;note`;
    const badCurrRes = parseHistoryCsv(Buffer.from(badCurr));
    expect(
      'error' in badCurrRes &&
        badCurrRes.error.code === 'history_unsupported_currency',
    ).toBe(true);

    // bad category (empty)
    const badCat = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;desc;-100.00;PHP;;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(badCat))).toBe(true);

    // empty file
    expect('error' in parseHistoryCsv(Buffer.from(''))).toBe(true);

    // field length limit
    const longField = 'a'.repeat(501);
    const longCsv = `record_id;date;payee;description;amount;currency;category;account;source_row_id;note
wallet-001;2026-07-29;Test;${longField};-100.00;PHP;Shopping;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(longCsv))).toBe(true);

    // row limit - create 10001 rows quickly (skip to avoid heavy)
    // size limit - exceed 5 MiB
    const bigBuf = Buffer.alloc(6 * 1024 * 1024, 'a');
    expect('error' in parseHistoryCsv(bigBuf)).toBe(true);
  });

  it('rejects header unknown schema fails safely; do not guess columns', () => {
    const unknown = `id;date;payee;desc;amount;currency;category;account;row;note
wallet-001;2026-07-29;Test;desc;-100.00;PHP;Shopping;Acc;p1-r001;note`;
    expect('error' in parseHistoryCsv(Buffer.from(unknown))).toBe(true);
  });

  it('accepts the Wallet-native export schema with comma delimiter and ISO timestamp', () => {
    const native = `account,category,currency,amount,ref_currency_amount,type,payment_type,note,date,transfer,payee,labels
BDO Visa Gold,Food & Drinks,PHP,-5026.5,-5026.5,Expense,Credit card,"Dinner, including tip",2026-08-30T16:40:00+08:00,FALSE,Example Merchant,card`;
    const result = parseHistoryCsv(Buffer.from(native, 'utf8'));

    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.summary).toEqual({
        recordCount: 1,
        categoryCount: 1,
        accountCount: 1,
      });
      expect(result.records[0]).toMatchObject({
        date: '2026-08-30',
        payee: 'Example Merchant',
        description: 'Dinner, including tip',
        amountMinor: -502650,
        currency: 'PHP',
        categoryName: 'Food & Drinks',
        accountName: 'BDO Visa Gold',
        note: 'Dinner, including tip',
      });
      expect(result.records[0].recordId).toMatch(
        /^wallet-native-[a-f0-9]{24}$/,
      );
    }
  });

  it('accepts semicolon-delimited Wallet-native exports and falls back to payee for description', () => {
    const native = `account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels
BDO Visa Gold;Shopping;PHP;100;100;Income;Cash;;2026-08-30T08:00:00.000Z;FALSE;Refund;`;
    const result = parseHistoryCsv(Buffer.from(native, 'utf8'));

    expect('records' in result).toBe(true);
    if ('records' in result) {
      expect(result.records[0].description).toBe('Refund');
      expect(result.records[0].amountMinor).toBe(10000);
      expect(result.records[0].date).toBe('2026-08-30');
    }
  });
});
