import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { IngestionService } from './ingestionService.js';
import { LocalTesseractOcrEngine } from './extractors.js';
import { SessionStore } from './sessionStore.js';

function readIncludedOracle(): Record<string, string>[] {
  const rows = readFileSync(
    'fixtures/synthetic/bdo/expected_extraction.csv',
    'utf8',
  )
    .trim()
    .split('\n');
  const headers = rows[0].split(';');
  return rows.slice(1).map((row) => {
    const values = row.split(';');
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

describe('local OCR integration', () => {
  it('reads the real three-page image fixture without network access', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network disabled during OCR'));
    const store = new SessionStore();
    const service = new IngestionService(store, new LocalTesseractOcrEngine());
    const files = [1, 2, 3].map((page) => {
      const buffer = readFileSync(
        `fixtures/synthetic/bdo/statement_page_${page}.jpg`,
      );
      return {
        buffer,
        originalname: `statement_page_${page}.jpg`,
        mimetype: 'image/jpeg',
        size: buffer.length,
      };
    });

    try {
      const validation = service.validateInput(files, 'statementPages');
      expect('validated' in validation).toBe(true);
      if (!('validated' in validation)) return;

      const processed = await service.process(validation.validated, 'ocr-test');
      expect('result' in processed, JSON.stringify(processed)).toBe(true);
      if (!('result' in processed)) return;

      expect(processed.result.statementId).toBe('BDO_VGOLD_20260729');
      expect(processed.result.transactions).toHaveLength(33);
      expect(processed.result.excludedRows).toHaveLength(4);
      expect(processed.result.summary.expenseTotal).toBe(34_957.17);
      const oracle = readIncludedOracle();
      const mismatches: string[] = [];
      for (const row of oracle) {
        if (row.include === 'true') {
          const transaction = processed.result.transactions.find(
            (candidate) => candidate.sourceRowId === row.source_row_id,
          );
          if (!transaction) {
            mismatches.push(`${row.source_row_id}: missing transaction`);
            continue;
          }
          const expected = [
            row.sale_date,
            row.description,
            Number(row.expected_signed_amount),
            row.currency,
            row.reference,
            Number(row.page),
          ];
          const actual = [
            transaction.date,
            transaction.description,
            transaction.amount,
            transaction.currency,
            transaction.reference ?? '',
            transaction.source.page,
          ];
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            mismatches.push(
              `${row.source_row_id}: expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`,
            );
          }
        } else {
          expect(
            processed.result.excludedRows.some(
              (candidate) => candidate.sourceRowId === row.source_row_id,
            ),
            `missing ${row.source_row_id}`,
          ).toBe(true);
        }
      }
      expect(mismatches).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      service.clearSession(processed.result.sessionId);
      expect(store.size()).toBe(0);
    } finally {
      fetchSpy.mockRestore();
      store.clearAll();
    }
  }, 30_000);
});
