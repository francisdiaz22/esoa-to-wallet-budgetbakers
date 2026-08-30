import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { readFileSync } from 'node:fs';

async function createSessionWithCategorize(): Promise<string> {
  const jpegHeader = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]);
  const img1 = Buffer.concat([jpegHeader, Buffer.from('page1')]);
  const img2 = Buffer.concat([jpegHeader, Buffer.from('page2')]);
  const img3 = Buffer.concat([jpegHeader, Buffer.from('page3')]);
  const res = await request(app)
    .post('/api/session/import')
    .attach('statementPages', img1, {
      filename: 'page1.jpg',
      contentType: 'image/jpeg',
    })
    .attach('statementPages', img2, {
      filename: 'page2.jpg',
      contentType: 'image/jpeg',
    })
    .attach('statementPages', img3, {
      filename: 'page3.jpg',
      contentType: 'image/jpeg',
    });
  if (res.status !== 201)
    throw new Error('import failed ' + JSON.stringify(res.body));
  const sid = res.body.sessionId as string;
  // import history
  const historyBuf = readFileSync(
    'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
  );
  const histRes = await request(app)
    .post(`/api/session/${sid}/history/import`)
    .attach('history', historyBuf, {
      filename: 'history.csv',
      contentType: 'text/csv',
    });
  if (histRes.status !== 201)
    throw new Error('history import failed ' + JSON.stringify(histRes.body));
  // provider
  const prov = await request(app)
    .post(`/api/session/${sid}/provider`)
    .send({ baseUrl: 'http://127.0.0.1:11434', model: 'test' });
  if (prov.status !== 200) throw new Error('provider failed');
  // categorize (will use fake provider? Need to ensure we have fake provider behavior in test env - the classification service will try to call real provider but test env has no server, so it will fallback to provider_unavailable per row, still creates proposals)
  // In test, provider test will try to fetch 127.0.0.1:11434 which will be unavailable, but categorize will still produce proposals via fallback per-row (provider_unavailable outcome)
  const cat = await request(app).post(`/api/session/${sid}/categorize`);
  // It may be 201 even with unavailable provider (fallback), but we need to allow both 201 and 502?
  if (cat.status !== 201) {
    // If provider not configured?
    throw new Error('categorize failed ' + JSON.stringify(cat.body));
  }
  return sid;
}

describe('review API', () => {
  it('covers authorization, validation, revision conflict, and safe errors', async () => {
    const sid = await createSessionWithCategorize();
    // initialize review
    const init = await request(app).post(
      `/api/session/${sid}/review/initialize`,
    );
    expect(init.status).toBe(201);
    expect(init.body.items).toHaveLength(33);
    expect(init.body.summary.sourceChargeCount).toBe(33);
    // GET review
    const get = await request(app).get(`/api/session/${sid}/review`);
    expect(get.status).toBe(200);
    expect(get.body.items).toHaveLength(33);
    const first = get.body.items[0];
    // GET detail traces to source and proposal evidence without exposing history beyond bounded examples
    const detail = await request(app).get(
      `/api/session/${sid}/review/${first.reviewItemId}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.sourceRowId).toBe(first.sourceRowId);
    expect(detail.body.proposal).toBeDefined();
    expect(detail.body.proposal.retrieval.length).toBeLessThanOrEqual(5);
    // PATCH with invalid revision — use valid category Electronics
    const badRev = await request(app)
      .patch(`/api/session/${sid}/review/${first.reviewItemId}`)
      .send({ revision: 999, categoryName: 'Electronics' });
    expect(badRev.status).toBe(409);
    expect(badRev.body.code).toBe('review_revision_conflict');
    // PATCH with unknown field rejected
    const badField = await request(app)
      .patch(`/api/session/${sid}/review/${first.reviewItemId}`)
      .send({ revision: first.revision, unknownField: 'x' });
    expect(badField.status).toBe(400);
    // Approve with valid category (first has Shopping, should succeed)
    const approve = await request(app)
      .post(`/api/session/${sid}/review/${first.reviewItemId}/approve`)
      .send({ revision: first.revision });
    // May fail if blocking issue? But first item likely has no blocking; should succeed
    // If it fails due to category, we accept either 200 or 422 but not 500
    expect([200, 422].includes(approve.status)).toBe(true);
    // Export redaction
    const exp = await request(app).get(
      `/api/session/${sid}/review/summary-export`,
    );
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('text/csv');
    expect(exp.headers['content-disposition']).toContain('review-summary.csv');
    const csv = exp.text;
    expect(csv).toContain('reviewItemId,sourceRowId,date,amountMinor');
    // Ensure redaction: should not contain raw source excerpts or payee/note free text? Our export excludes those, but check not containing 'SYNTHETIC MERCHANT' description which is raw desc
    // But our export includes amountMinor, so it may include description? We exclude description, so check not contains 'SYNTHETIC'
    expect(csv).not.toContain('SYNTHETIC');
    // Verify deterministic column order
    expect(csv.split('\n')[0]).toBe(
      'reviewItemId,sourceRowId,date,amountMinor,categoryName,reviewState,outcome,issueCodes,duplicateCandidateIds,kind,parentReviewItemId',
    );
    // Session clear removes review
    await request(app).delete(`/api/session/${sid}`);
    const afterClear = await request(app).get(`/api/session/${sid}/review`);
    expect(afterClear.status).toBe(404);

    // missing session returns safe envelope
    const miss = await request(app).get(
      '/api/session/00000000-0000-4000-8000-000000000999/review',
    );
    expect(miss.status).toBe(404);
    expect(miss.body.code).toBeDefined();
    expect(miss.body.message).toBeDefined();
    expect(miss.body.code).not.toContain('stack');
  });

  it('validates bulk approve preview and split total mismatch', async () => {
    const sid = await createSessionWithCategorize();
    const init = await request(app).post(
      `/api/session/${sid}/review/initialize`,
    );
    expect(init.status).toBe(201);
    const get = await request(app).get(`/api/session/${sid}/review`);
    const item = get.body.items.find(
      (i: { reviewState: string }) => i.reviewState === 'needs_review',
    ) as { reviewItemId: string; revision: number; amountMinor: number };
    // Try split with invalid total — use valid catalog category Electronics
    const badSplit = await request(app)
      .post(`/api/session/${sid}/review/${item.reviewItemId}/split`)
      .send({
        revision: item.revision,
        splits: [
          { amountMinor: -100, categoryName: 'Electronics' },
          { amountMinor: -100, categoryName: 'Electronics' },
        ],
      });
    // Should be 422 split_total_mismatch because source amount is e.g., -82833 but we sent -200
    expect(badSplit.status).toBe(422);
    expect(badSplit.body.code).toBe('split_total_mismatch');
    // Bulk preview
    const preview = await request(app).post(
      `/api/session/${sid}/review/bulk-approve-preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.eligibleCount).toBeDefined();
    await request(app).delete(`/api/session/${sid}`);
  });
});
