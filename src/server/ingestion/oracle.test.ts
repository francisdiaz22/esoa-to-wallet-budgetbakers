import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { app } from '../app.js';

// Oracle comparison procedure per IMPLEMENT_phase1.md
function readOracle(path: string) {
  const csv = readFileSync(resolve(path), 'utf8').trim().split('\n');
  const headers = csv[0].split(';');
  return csv.slice(1).map((line) => {
    const vals = line.split(';');
    return Object.fromEntries(vals.map((v, i) => [headers[i], v]));
  });
}

describe('oracle comparison — expected_extraction.csv', () => {
  it('three-page fixture import exactly matches 33 included + 4 excluded with sale dates, negative amounts, ids, total', async () => {
    const oracle = readOracle('fixtures/synthetic/bdo/expected_extraction.csv');

    const p1 = readFileSync('fixtures/synthetic/bdo/statement_page_1.jpg');
    const p2 = readFileSync('fixtures/synthetic/bdo/statement_page_2.jpg');
    const p3 = readFileSync('fixtures/synthetic/bdo/statement_page_3.jpg');

    const res = await request(app)
      .post('/api/session/import')
      .attach('statementPages', p1, {
        filename: 'statement_page_1.jpg',
        contentType: 'image/jpeg',
      })
      .attach('statementPages', p2, {
        filename: 'statement_page_2.jpg',
        contentType: 'image/jpeg',
      })
      .attach('statementPages', p3, {
        filename: 'statement_page_3.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body;

    // 37 recognized = 33 +4
    expect(body.transactions).toHaveLength(33);
    expect(body.excludedRows).toHaveLength(4);
    expect(body.transactions.length + body.excludedRows.length).toBe(37);
    expect(body.summary.proposedCount).toBe(33);
    expect(body.summary.excludedCount).toBe(4);
    expect(body.summary.expenseTotal).toBeCloseTo(34957.17, 2);
    expect(
      body.transactions.every((t: { amount: number }) => t.amount < 0),
    ).toBe(true);
    expect(
      body.transactions.every(
        (t: { currency: string }) => t.currency === 'PHP',
      ),
    ).toBe(true);

    // Row-by-row oracle agreement
    for (const row of oracle) {
      if (row.include === 'true') {
        const found = body.transactions.find(
          (t: { sourceRowId: string }) => t.sourceRowId === row.source_row_id,
        );
        expect(found, `missing ${row.source_row_id}`).toBeDefined();
        expect(String(found.page ?? found.source.page)).toBe(String(row.page));
        expect(found.date).toBe(row.sale_date);
        // normalize description comparison: parser retains instalment suffix
        expect(found.description).toBe(row.description);
        // raw amount after deterministic parsing: expected_signed_amount is negative; raw_amount is positive absolute
        expect(found.amount).toBeCloseTo(Number(row.expected_signed_amount), 2);
        expect(found.currency).toBe(row.currency);
        // reference empty in fixture
        if (row.reference) expect(found.reference).toBe(row.reference);
        else expect(found.reference ?? '').toBe('');
        // source evidence
        expect(found.source.rawText.length).toBeGreaterThan(5);
        expect(found.source.bankParserId).toBe('bdo-visa-gold-ph-image-v1');
        expect(found.extractionConfidence).toBeGreaterThanOrEqual(0);
        expect(found.extractionConfidence).toBeLessThanOrEqual(1);
        expect(Number.isFinite(found.extractionConfidence)).toBe(true);
      } else {
        const found = body.excludedRows.find(
          (e: { sourceRowId: string }) => e.sourceRowId === row.source_row_id,
        );
        expect(found, `missing excluded ${row.source_row_id}`).toBeDefined();
        expect(String(found.page)).toBe(String(row.page));
        expect(found.rawText.length).toBeGreaterThan(1);
        // map exclusion reason
        const map: Record<string, string> = {
          'previous-balance': 'previous-balance',
          'credit-card-payment': 'credit-card-payment',
          summary: 'summary',
        };
        expect(found.exclusionReason).toBe(map[row.exclusion_reason]);
      }
    }

    // No additional ids
    const allIds = new Set([
      ...body.transactions.map((t: { sourceRowId: string }) => t.sourceRowId),
      ...body.excludedRows.map((e: { sourceRowId: string }) => e.sourceRowId),
    ]);
    expect(allIds.size).toBe(37);
    expect(oracle.every((r) => allIds.has(r.source_row_id))).toBe(true);

    // Precision/recall gate 33/33
    const correct = body.transactions.filter(
      (t: {
        sourceRowId: string;
        date: string;
        description: string;
        amount: number;
      }) => {
        const o = oracle.find((r) => r.source_row_id === t.sourceRowId);
        return (
          o &&
          o.sale_date === t.date &&
          o.description === t.description &&
          Number(o.expected_signed_amount) === t.amount
        );
      },
    ).length;
    expect(correct).toBe(33);

    // cleanup
    await request(app).delete(`/api/session/${body.sessionId}`);
  });
});
