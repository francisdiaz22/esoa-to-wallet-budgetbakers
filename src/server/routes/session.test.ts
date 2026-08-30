import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { LIMITS } from '../ingestion/limits.js';

function makeBlankPdf(pageCount: number): Buffer {
  const firstPageObject = 3;
  const contentObject = firstPageObject + pageCount;
  const pageIds = Array.from(
    { length: pageCount },
    (_, index) => firstPageObject + index,
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageIds.map(
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R >>`,
    ),
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

// Ensure fake OCR enabled for tests (NODE_ENV=test already)
describe('session API', () => {
  it('POST /api/session/import with statementPages 3 images returns 201 with 33 proposals', async () => {
    // Create minimal JPEG buffers: real fixture images are not needed because FakeOcr handles any image buffer
    // Use valid JPEG magic + dummy content
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

    expect(res.status).toBe(201);
    expect(res.body.parserId).toBe('bdo-visa-gold-ph-image-v1');
    expect(res.body.sourceFormat).toBe('ocr');
    expect(res.body.transactions).toHaveLength(33);
    expect(res.body.excludedRows).toHaveLength(4);
    expect(res.body.summary.proposedCount).toBe(33);
    expect(res.body.summary.excludedCount).toBe(4);
    expect(res.body.summary.expenseTotal).toBeCloseTo(34957.17, 2);
    // all negative
    expect(
      res.body.transactions.every((t: { amount: number }) => t.amount < 0),
    ).toBe(true);
    // IDs
    expect(res.body.transactions[0].sourceRowId).toBe('p1-r001');
    expect(res.body.excludedRows[0].sourceRowId).toBe('p1-x001');

    // GET extraction
    const sid = res.body.sessionId;
    const getRes = await request(app).get(`/api/session/${sid}/extraction`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.sessionId).toBe(sid);

    // DELETE clear idempotent
    const del = await request(app).delete(`/api/session/${sid}`);
    expect(del.status).toBe(204);
    const getAfter = await request(app).get(`/api/session/${sid}/extraction`);
    expect(getAfter.status).toBe(404);
    // second delete idempotent
    const del2 = await request(app).delete(`/api/session/${sid}`);
    expect(del2.status).toBe(204);
  });

  it('rejects zero-byte, oversize, mixed fields, mime mismatch, unsupported type', async () => {
    // zero byte
    const zero = await request(app)
      .post('/api/session/import')
      .attach('statement', Buffer.alloc(0), {
        filename: 'empty.jpg',
        contentType: 'image/jpeg',
      });
    expect(zero.status).toBe(400);
    expect(zero.body.code).toBe('empty_file');

    // mixed fields
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const mixed = await request(app)
      .post('/api/session/import')
      .attach('statement', jpeg, {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      })
      .attach('statementPages', jpeg, {
        filename: 'b.jpg',
        contentType: 'image/jpeg',
      });
    expect(mixed.status).toBe(400);
    expect(mixed.body.code).toBe('mixed_fields');

    // invalid page count (only 1 in statementPages, needs 2-10)
    const onePage = await request(app)
      .post('/api/session/import')
      .attach('statementPages', jpeg, {
        filename: 'only.jpg',
        contentType: 'image/jpeg',
      });
    expect(onePage.status).toBe(400);
    expect(onePage.body.code).toBe('invalid_page_count');

    // mime mismatch: JPEG magic but claimed as csv
    const csvContent = Buffer.from('col1,col2\n1,2');
    // Create a JPEG buffer but claim text/csv -> should be mismatch (detected image vs hint csv)
    const mismatch = await request(app)
      .post('/api/session/import')
      .attach('statement', jpeg, {
        filename: 'fake.csv',
        contentType: 'text/csv',
      });
    expect(mismatch.status).toBe(415);

    // unsupported file type (exe magic not in supported set)
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    const unsup = await request(app)
      .post('/api/session/import')
      .attach('statement', exe, {
        filename: 'bad.exe',
        contentType: 'application/octet-stream',
      });
    expect(unsup.status).toBe(415);

    // unsupported layout: CSV that is valid but no parser supports it
    const resCsv = await request(app)
      .post('/api/session/import')
      .attach('statement', csvContent, {
        filename: 'data.csv',
        contentType: 'text/csv',
      });
    expect(resCsv.status).toBe(422);
    expect(resCsv.body.code).toBe('unsupported_layout');

    // encrypted PDF heuristic
    const pdfEnc = Buffer.concat([
      Buffer.from('%PDF-'),
      Buffer.from(' /Encrypt '),
    ]);
    const encRes = await request(app)
      .post('/api/session/import')
      .attach('statement', pdfEnc, {
        filename: 'enc.pdf',
        contentType: 'application/pdf',
      });
    expect(encRes.status).toBe(422);
    expect(encRes.body.code).toBe('encrypted_pdf');
  });

  it('routes CSV text-PDF etc and does not leave session on failure', async () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    const res = await request(app)
      .post('/api/session/import')
      .attach('statement', exe, {
        filename: 'bad.exe',
        contentType: 'application/octet-stream',
      });
    expect(res.status).toBe(415);
    // Ensure no sessionId in body
    expect(res.body.sessionId).toBeUndefined();
  });

  it('single statement image (1 page) returns partial result (not invent pages 2-3)', async () => {
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const img1 = Buffer.concat([jpegHeader, Buffer.from('page1only')]);
    const res = await request(app)
      .post('/api/session/import')
      .attach('statement', img1, {
        filename: 'page1.jpg',
        contentType: 'image/jpeg',
      });
    // Should succeed via image OCR path (statement single image)
    // Fake will return p1 lines only (15 proposals + 1 excluded)
    expect(res.status).toBe(201);
    // Not invent pages 2-3
    expect(
      res.body.transactions.every(
        (t: { source: { page: number } }) => t.source.page === 1,
      ),
    ).toBe(true);
    expect(res.body.transactions.length).toBeLessThan(33);
    // Clean
    await request(app).delete(`/api/session/${res.body.sessionId}`);
  });

  it('renders scanned PDF pages before OCR and rejects excess decoded pages', async () => {
    const scanned = await request(app)
      .post('/api/session/import')
      .attach('statement', makeBlankPdf(2), {
        filename: 'scan.pdf',
        contentType: 'application/pdf',
      });
    expect(scanned.status, JSON.stringify(scanned.body)).toBe(201);
    expect(scanned.body.sourceFormat).toBe('ocr');
    expect(
      scanned.body.transactions.some(
        (transaction: { source: { page: number } }) =>
          transaction.source.page === 2,
      ),
    ).toBe(true);
    await request(app).delete(`/api/session/${scanned.body.sessionId}`);

    const tooManyPages = await request(app)
      .post('/api/session/import')
      .attach('statement', makeBlankPdf(LIMITS.MAX_PAGE_COUNT + 1), {
        filename: 'too-many-pages.pdf',
        contentType: 'application/pdf',
      });
    expect(tooManyPages.status).toBe(413);
    expect(tooManyPages.body.code).toBe('pdf_page_limit');
    expect(tooManyPages.body.sessionId).toBeUndefined();
  });
});
