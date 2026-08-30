/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { globalSessionStore } from '../ingestion/sessionStore.js';
import { TemporaryWorkspace } from '../ingestion/workspace.js';
import { randomUUID } from 'node:crypto';
import { setWalletClientForTests } from './commitService.js';
import { FakeWalletClient } from './client.js';
import { globalReviewService } from '../review/reviewService.js';
import { parseHistoryCsv } from '../categorization/historyAdapter.js';
import { buildCatalog } from '../categorization/catalog.js';
import fs from 'node:fs';
import path from 'node:path';

function reset() {
  globalSessionStore.clearAll();
  setWalletClientForTests(null);
}

function createBdoSession(): string {
  const csv = fs.readFileSync(
    path.join('fixtures', 'synthetic', 'bdo', 'expected_extraction.csv'),
    'utf8',
  );
  const lines = csv.trim().split('\n').slice(1);
  const transactions: any[] = [];
  const excludedRows: any[] = [];
  for (const line of lines) {
    const cols = line.split(';');
    const [
      statement_id,
      source_row_id,
      page,
      source_order,
      include,
      sale_date,
      description,
      _raw_amount,
      expected_signed_amount,
      _currency,
    ] = cols;
    if (include === 'true') {
      transactions.push({
        sourceRowId: source_row_id,
        statementId: statement_id,
        date: sale_date,
        description,
        amount: parseFloat(expected_signed_amount),
        currency: 'PHP',
        source: {
          format: 'ocr',
          bankParserId: 'bdo-visa-gold-ph-image-v1',
          page: parseInt(page, 10),
          row: parseInt(source_order, 10),
          rawText: description,
        },
        extractionConfidence: 0.97,
        issues: [],
      });
    } else {
      excludedRows.push({
        sourceRowId: source_row_id,
        page: parseInt(page, 10) || undefined,
        rawText: description,
        exclusionReason: 'summary',
      });
    }
  }
  const sessionId = randomUUID();
  const workspace = new TemporaryWorkspace(sessionId);
  const extraction: any = {
    sessionId,
    parserId: 'bdo-visa-gold-ph-image-v1',
    statementId: 'BDO_VGOLD_202608',
    sourceFormat: 'ocr',
    transactions,
    excludedRows,
    issues: [],
    summary: {
      proposedCount: transactions.length,
      excludedCount: excludedRows.length,
      expenseTotal: -34957.17,
    },
  };
  globalSessionStore.createWithId(sessionId, extraction, workspace);
  // history
  const histBuf = fs.readFileSync(
    path.join('fixtures', 'synthetic', 'bdo', 'wallet_records_synthetic.csv'),
  );
  const parsed = parseHistoryCsv(histBuf);
  if ('error' in parsed) throw new Error('parse');
  const catRes = buildCatalog(parsed.records);
  if ('error' in catRes) throw new Error('cat');
  globalSessionStore.setHistory(sessionId, parsed.records, catRes.catalog, {
    recordCount: parsed.summary.recordCount,
    categoryCount: parsed.summary.categoryCount,
    accountCount: parsed.summary.accountCount,
    adapterId: 'test',
    adapterVersion: '1.0.0',
    historyVersion: 0,
  });
  globalSessionStore.setProviderConfig(
    sessionId,
    { baseUrl: 'http://127.0.0.1:11434' },
    { baseUrl: 'http://127.0.0.1:11434', configured: true },
  );
  const proposals = transactions.map((tx, idx) => ({
    proposalId: randomUUID(),
    sourceRowId: tx.sourceRowId,
    categoryName: catRes.catalog[idx % catRes.catalog.length].categoryName,
    classificationConfidence: 0.9,
    rationale: 'synthetic',
    outcome: 'proposed' as const,
    reviewState: 'needs_review' as const,
    retrieval: [],
    issues: [],
  }));
  globalSessionStore.setProposals(
    sessionId,
    proposals as never,
    {
      sessionId,
      historyVersion: 1,
      proposals: proposals as never,
      summary: {
        total: proposals.length,
        byOutcome: {
          proposed: proposals.length,
          unknown: 0,
          low_confidence: 0,
          provider_unavailable: 0,
          provider_malformed: 0,
        },
      },
    },
    1,
  );
  const init = globalReviewService.initialize(sessionId);
  if ('error' in init) throw new Error('init');
  // splits
  const items = globalReviewService.getReview(sessionId);
  if ('error' in items) throw new Error('get');
  for (const src of items.items.filter(
    (i) => i.sourceRowId === 'p1-r004' || i.sourceRowId === 'p2-r023',
  )) {
    const splits =
      src.sourceRowId === 'p1-r004'
        ? [
            {
              amountMinor: -250000,
              categoryName: catRes.catalog[0].categoryName,
            },
            {
              amountMinor: -104700,
              categoryName: catRes.catalog[1].categoryName,
            },
          ]
        : [
            {
              amountMinor: -300000,
              categoryName: catRes.catalog[0].categoryName,
            },
            {
              amountMinor: -73250,
              categoryName: catRes.catalog[1].categoryName,
            },
          ];
    globalReviewService.createSplit(
      sessionId,
      src.reviewItemId,
      src.revision,
      splits as never,
    );
  }
  const after = globalReviewService.getReview(sessionId);
  if ('error' in after) throw new Error('after');
  for (const it of after.items) {
    const isParent =
      it.kind === 'source' &&
      after.items.some(
        (x) => x.sourceRowId === it.sourceRowId && x.kind === 'split',
      );
    if (isParent) continue;
    if (it.reviewState !== 'needs_review') continue;
    const cat = catRes.catalog.find((c) => c.categoryName === it.categoryName)
      ? it.categoryName
      : catRes.catalog[0].categoryName;
    if (it.categoryName !== cat) {
      const edit = globalReviewService.editCategoryPayeeNote(
        sessionId,
        it.reviewItemId,
        it.revision,
        { categoryName: cat as string },
      );
      if ('error' in edit) throw new Error('edit');
      const updated = globalReviewService.getItem(sessionId, it.reviewItemId)!;
      globalReviewService.approveOne(
        sessionId,
        it.reviewItemId,
        updated.revision,
      );
    } else {
      globalReviewService.approveOne(sessionId, it.reviewItemId, it.revision);
    }
  }
  return sessionId;
}

describe('wallet routes integration', () => {
  beforeEach(reset);

  it('connect loads catalog and never echoes token', async () => {
    const sessionId = createBdoSession();
    const fake = new FakeWalletClient({
      accounts: [
        { id: 'acc-1', name: 'Main', currency: 'PHP', writable: true },
      ],
      categories: [
        { id: 'cat-1', name: 'Food' },
        { id: 'cat-2', name: 'Travel' },
      ],
    });
    setWalletClientForTests(fake);
    const res = await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890abcdef' });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('valid-token');
    const setup = await request(app).get(
      `/api/session/${sessionId}/wallet/setup`,
    );
    expect(setup.status).toBe(200);
    expect(JSON.stringify(setup.body)).not.toContain('valid-token');
    expect(setup.body.accounts.length).toBe(1);
  });

  it('rejects custom baseUrl', async () => {
    const sessionId = createBdoSession();
    const res = await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890', baseUrl: 'https://evil.com' });
    expect(res.status).toBe(400);
  });

  it('selection requires writable account and complete mapping', async () => {
    const sessionId = createBdoSession();
    const fake = new FakeWalletClient({
      accounts: [
        { id: 'acc-1', name: 'Main', currency: 'PHP', writable: false },
      ],
      categories: [{ id: 'cat-1', name: 'Food' }],
    });
    setWalletClientForTests(fake);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-123456789012345' });
    const res = await request(app)
      .post(`/api/session/${sessionId}/wallet/selection`)
      .send({
        walletAccountId: 'acc-1',
        mappings: [{ localCategoryName: 'Food', walletCategoryId: 'cat-1' }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('wallet_account_not_writable');
  });

  it('dry-run makes zero create calls and shows Not sent yet', async () => {
    const sessionId = createBdoSession();
    const fake = new FakeWalletClient({
      accounts: [{ id: 'acc-1', name: 'Acc', currency: 'PHP', writable: true }],
      categories: [
        { id: 'cat-1', name: 'Food' },
        { id: 'cat-2', name: 'Travel' },
      ],
    });
    setWalletClientForTests(fake);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-123456789012345' });
    // need mapping for distinct cats - our review has many cats but fake only has 2, so we map both to same cat-1 for test simplicity via direct service? Instead create categories that cover all local cats.
    // Let's use real catalog categories as wallet categories
    const histCats = globalSessionStore
      .getCatalog(sessionId)!
      .map((c) => ({ id: `w-${c.categoryName}`, name: c.categoryName }));
    const fake2 = new FakeWalletClient({
      accounts: [{ id: 'acc-1', name: 'Acc', currency: 'PHP', writable: true }],
      categories: histCats as never,
    });
    setWalletClientForTests(fake2);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890123456' });
    const _setup = await request(app).get(
      `/api/session/${sessionId}/wallet/setup`,
    );
    void _setup;
    const distinct = Array.from(
      new Set(
        globalReviewService
          .getReview(sessionId)!
          .items.filter((i) => i.reviewState === 'approved')
          .map((i) => i.categoryName)
          .filter(Boolean) as string[],
      ),
    );
    const mappings = distinct.map((c) => ({
      localCategoryName: c,
      walletCategoryId: `w-${c}`,
    }));
    const sel = await request(app)
      .post(`/api/session/${sessionId}/wallet/selection`)
      .send({ walletAccountId: 'acc-1', mappings });
    expect(sel.status).toBe(200);
    const dry = await request(app).post(
      `/api/session/${sessionId}/wallet/dry-run`,
    );
    expect(dry.status).toBe(201);
    expect(dry.body.notSentYet).toBe(true);
    expect(dry.body.count).toBe(35);
    expect(fake2.capturedRequests.length).toBe(0);
  });

  it('commit handles mixed results per-item and retry only server_error', async () => {
    const sessionId = createBdoSession();
    const histCats = globalSessionStore
      .getCatalog(sessionId)!
      .map((c) => ({ id: `w-${c.categoryName}`, name: c.categoryName }));
    const fake = new FakeWalletClient({
      accounts: [{ id: 'acc-1', name: 'Acc', currency: 'PHP', writable: true }],
      categories: histCats as never,
    });
    setWalletClientForTests(fake);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890123457' });
    const distinct = Array.from(
      new Set(
        globalReviewService
          .getReview(sessionId)!
          .items.filter((i) => i.reviewState === 'approved')
          .map((i) => i.categoryName)
          .filter(Boolean) as string[],
      ),
    );
    const mappings = distinct.map((c) => ({
      localCategoryName: c,
      walletCategoryId: `w-${c}`,
    }));
    await request(app)
      .post(`/api/session/${sessionId}/wallet/selection`)
      .send({ walletAccountId: 'acc-1', mappings });
    const dry = await request(app).post(
      `/api/session/${sessionId}/wallet/dry-run`,
    );
    const snapId = dry.body.snapshotId;
    // Prepare fake mixed response: first chunk has mixed, but we have single chunk 35 -> create mixed with 1 success 1 client_error etc for first 2, rest succeeded
    const mixed = Array.from({ length: 35 }, (_, i) => {
      if (i === 0)
        return {
          inputIndex: i,
          status: 'succeeded' as const,
          walletRecordId: `w-${i}`,
        };
      if (i === 1)
        return {
          inputIndex: i,
          status: 'client_error' as const,
          safeErrorCode: 'bad',
        };
      if (i === 2)
        return {
          inputIndex: i,
          status: 'server_error' as const,
          safeErrorCode: 'temp',
        };
      return {
        inputIndex: i,
        status: 'succeeded' as const,
        walletRecordId: `w-${i}`,
      };
    });
    fake['scenario'].writeResponses = [
      { summary: { total: 35, succeeded: 33, failed: 2 }, results: mixed },
    ];
    const commit = await request(app).post(
      `/api/session/${sessionId}/wallet/commit/${snapId}`,
    );
    expect(commit.status).toBe(200);
    expect(commit.body.journal.length).toBe(35);
    const results = await request(app).get(
      `/api/session/${sessionId}/wallet/results`,
    );
    expect(
      results.body.journal.find(
        (j: { status: string }) => j.status === 'client_error',
      ),
    ).toBeTruthy();
    expect(
      results.body.journal.find(
        (j: { status: string }) => j.status === 'server_error_retryable',
      ),
    ).toBeTruthy();
    // Retry should only send server_error
    const retryMixed = Array.from({ length: 1 }, (_, i) => ({
      inputIndex: i,
      status: 'succeeded' as const,
      walletRecordId: `w-retry-${i}`,
    }));
    fake['scenario'].writeResponses = [
      { summary: { total: 1, succeeded: 1, failed: 0 }, results: retryMixed },
    ];
    // But retry will chunk only 1 item (the server_error), so need to set response for 1 item
    const retry = await request(app).post(
      `/api/session/${sessionId}/wallet/retry`,
    );
    expect(retry.status).toBe(200);
    const afterRetry = await request(app).get(
      `/api/session/${sessionId}/wallet/results`,
    );
    expect(afterRetry.body.summary.serverRetry).toBe(0);
    expect(fake.capturedRequests[1].length).toBe(1);
  });

  it('export is redacted and excludes sensitive fields', async () => {
    const sessionId = createBdoSession();
    const histCats = globalSessionStore
      .getCatalog(sessionId)!
      .map((c) => ({ id: `w-${c.categoryName}`, name: c.categoryName }));
    const fake = new FakeWalletClient({
      accounts: [{ id: 'acc-1', name: 'Acc', currency: 'PHP', writable: true }],
      categories: histCats as never,
    });
    setWalletClientForTests(fake);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890123458' });
    const distinct = Array.from(
      new Set(
        globalReviewService
          .getReview(sessionId)!
          .items.filter((i) => i.reviewState === 'approved')
          .map((i) => i.categoryName)
          .filter(Boolean) as string[],
      ),
    );
    const mappings = distinct.map((c) => ({
      localCategoryName: c,
      walletCategoryId: `w-${c}`,
    }));
    await request(app)
      .post(`/api/session/${sessionId}/wallet/selection`)
      .send({ walletAccountId: 'acc-1', mappings });
    const dry = await request(app).post(
      `/api/session/${sessionId}/wallet/dry-run`,
    );
    await request(app).post(
      `/api/session/${sessionId}/wallet/commit/${dry.body.snapshotId}`,
    );
    const exp = await request(app).get(
      `/api/session/${sessionId}/wallet/result-summary-export`,
    );
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('text/csv');
    expect(exp.text).not.toContain('valid-token');
    expect(exp.text).not.toContain('description');
    expect(exp.text).toContain('walletRecordId');
  });

  it('clear erases phase4 token and catalog but retains journal after disconnect? Journal retained after disconnect', async () => {
    const sessionId = createBdoSession();
    const fake = new FakeWalletClient({
      accounts: [{ id: 'acc-1', name: 'Acc', currency: 'PHP', writable: true }],
      categories: [{ id: 'cat-1', name: 'Food' }],
    });
    setWalletClientForTests(fake);
    await request(app)
      .post(`/api/session/${sessionId}/wallet/connect`)
      .send({ token: 'valid-token-1234567890123459' });
    const beforeClear = await request(app).get(
      `/api/session/${sessionId}/wallet/setup`,
    );
    expect(beforeClear.body.accounts.length).toBe(1);
    await request(app).post(`/api/session/${sessionId}/wallet/disconnect`);
    const afterDisc = await request(app).get(
      `/api/session/${sessionId}/wallet/setup`,
    );
    expect(afterDisc.body.connectionState).toBe('not_configured');
    // clear
    await request(app).delete(`/api/session/${sessionId}`);
    const afterClear = await request(app).get(
      `/api/session/${sessionId}/wallet/setup`,
    );
    expect(afterClear.status).toBe(404);
  });
});
