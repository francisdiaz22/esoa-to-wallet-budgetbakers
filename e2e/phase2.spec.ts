import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

function startFakeProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake-local-model' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        try {
          const j = JSON.parse(body);
          const cats: string[] =
            JSON.parse(j.messages[1].content).categories || [];
          const examples = JSON.parse(j.messages[1].content).examples || [];
          const desc = JSON.parse(j.messages[1].content).transaction
            .description as string;
          let cat = cats[0] || 'Shopping';
          let conf = 0.85;
          let rationale = `Fake rationale for ${cat}`;
          let exampleIds: string[] = examples.length ? [examples[0].id] : [];
          if (desc.includes('SHOPEE')) {
            cat = 'Shopping';
            conf = 0.92;
          } else if (desc.includes('GRAB')) {
            cat = 'unknown';
            conf = 0.3;
            rationale = 'unknown';
            exampleIds = [];
          } else if (desc.includes('ACE HARDWARE')) {
            cat = 'NonExistent';
            conf = 0.9;
          }
          const resp = {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    categoryName: cat,
                    confidence: conf,
                    rationale,
                    exampleIds,
                  }),
                },
              },
            ],
          };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(resp));
        } catch {
          res.writeHead(500);
          res.end('error');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolvePromise({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test('runs categorization, review, and Wallet commit/recovery without browser-side external requests', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const unexpectedRequests: string[] = [];
  const walletToken = 'browser-secret-wallet-token';
  let walletConnected = false;
  let walletCreateCalls = 0;
  let walletJournal: Array<Record<string, unknown>> = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/wallet/')) {
      const path = url.pathname;
      if (path.endsWith('/wallet/connect')) {
        const body = route.request().postData() ?? '';
        expect(body).toContain(walletToken);
        walletConnected = true;
        await route.fulfill({ json: { connected: true } });
        return;
      }
      if (path.endsWith('/wallet/setup')) {
        await route.fulfill({
          json: {
            connectionState: walletConnected ? 'ready' : 'not_configured',
            catalogVersion: walletConnected ? 'e2e-v1' : undefined,
            accounts: walletConnected
              ? [
                  {
                    walletAccountId: 'wallet-account-1',
                    walletAccountLabel: 'E2E Wallet',
                    currency: 'PHP',
                    writable: true,
                  },
                ]
              : [],
            categories: walletConnected
              ? [
                  {
                    walletCategoryId: 'wallet-category-1',
                    walletCategoryLabel: 'E2E Category',
                  },
                ]
              : [],
            selection: null,
            snapshotId: null,
            journal: walletJournal,
          },
        });
        return;
      }
      if (path.endsWith('/wallet/selection')) {
        await route.fulfill({ json: { saved: true } });
        return;
      }
      if (path.endsWith('/wallet/dry-run')) {
        await route.fulfill({
          status: 201,
          json: {
            snapshotId: '11111111-1111-4111-8111-111111111111',
            count: 1,
            totalMinor: -12345,
            accountLabel: 'E2E Wallet',
            catalogVersion: 'e2e-v1',
            coverage: {
              localCategoryCount: 1,
              mappedCount: 1,
              fullyMapped: true,
            },
            items: [
              {
                reviewItemId: '22222222-2222-4222-8222-222222222222',
                sourceRowId: 'p1-r001',
                date: '2026-07-29',
                amountMinor: -12345,
                description: 'Synthetic preview',
                categoryName: 'Shopping',
                walletCategoryLabel: 'E2E Category',
              },
            ],
            notSentYet: true,
            createdAt: '2026-08-30T00:00:00.000Z',
          },
        });
        return;
      }
      if (path.includes('/wallet/commit/')) {
        walletCreateCalls += 1;
        walletJournal = [
          {
            reviewItemId: '22222222-2222-4222-8222-222222222222',
            sourceRowId: 'p1-r001',
            snapshotId: '11111111-1111-4111-8111-111111111111',
            status: 'server_error_retryable',
            safeErrorCode: 'temporary',
            attemptCount: 1,
            updatedAt: '2026-08-30T00:00:01.000Z',
          },
        ];
        await route.fulfill({ json: { journal: walletJournal } });
        return;
      }
      if (path.endsWith('/wallet/retry')) {
        walletJournal = [
          {
            reviewItemId: '22222222-2222-4222-8222-222222222222',
            sourceRowId: 'p1-r001',
            snapshotId: '11111111-1111-4111-8111-111111111111',
            status: 'succeeded',
            walletRecordId: 'wallet-record-1',
            attemptCount: 2,
            updatedAt: '2026-08-30T00:00:02.000Z',
          },
        ];
        await route.fulfill({ json: { journal: walletJournal } });
        return;
      }
      if (path.endsWith('/wallet/results')) {
        await route.fulfill({
          json: {
            journal: walletJournal,
            summary: {
              total: walletJournal.length,
              succeeded: walletJournal.filter(
                (entry) => entry.status === 'succeeded',
              ).length,
              clientError: walletJournal.filter(
                (entry) => entry.status === 'client_error',
              ).length,
              serverRetry: walletJournal.filter(
                (entry) => entry.status === 'server_error_retryable',
              ).length,
              unknown: walletJournal.filter(
                (entry) => entry.status === 'unknown',
              ).length,
              notSubmitted: walletJournal.filter(
                (entry) => entry.status === 'not_submitted',
              ).length,
            },
          },
        });
        return;
      }
      if (path.endsWith('/wallet/result-summary-export')) {
        await route.fulfill({
          headers: { 'content-type': 'text/csv' },
          body: 'status,walletRecordId\nsucceeded,wallet-record-1\n',
        });
        return;
      }
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      unexpectedRequests.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });

  const fake = await startFakeProvider();

  await page.goto('/');

  // Import statement 3 pages
  await page
    .getByLabel(/drag a document/i)
    .setInputFiles(
      [1, 2, 3].map((n) =>
        resolve(`fixtures/synthetic/bdo/statement_page_${n}.jpg`),
      ),
    );
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Extraction results')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('Proposed:').locator('..')).toContainText('33');

  // Import history
  await page
    .getByLabel(/drag wallet history/i)
    .setInputFiles(
      resolve('fixtures/synthetic/bdo/wallet_records_synthetic.csv'),
    );
  await page.getByRole('button', { name: 'Import history' }).click();
  await expect(page.getByText('History imported:')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('History imported:').locator('..')).toContainText(
    '35 records',
  );
  await expect(page.getByText('History imported:').locator('..')).toContainText(
    '15 categories',
  );

  // Configure provider
  await page.getByLabel('Base URL').fill(fake.baseUrl);
  await page.getByLabel('Model (optional)').fill('fake-local-model');
  await page.getByRole('button', { name: 'Test local connection' }).click();
  await expect(
    page.getByText('Provider reachable — model: fake-local-model'),
  ).toBeVisible({ timeout: 10000 });

  // Categorize
  await page.getByRole('button', { name: 'Categorize transactions' }).click();
  await expect(
    page.getByText('Category proposals (read-only, advisory)'),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Total: 33')).toBeVisible();
  // Check that each sourceRowId is present and proposals are needs review (use cell to avoid duplicate in details)
  await expect(page.getByRole('cell', { name: 'p1-r001' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'p3-r033' })).toBeVisible();
  // At least one needs review badge
  await expect(page.getByText('(needs review)').first()).toBeVisible();

  // Phase 3 review is initialized automatically and renders only once.
  await expect(
    page.getByRole('heading', { name: 'Review workspace' }),
  ).toHaveCount(1);
  const firstReviewDetails = page
    .getByRole('button', {
      name: /^view details for .*shopee.*$/i,
    })
    .last();
  await firstReviewDetails.click();
  await expect(
    page.getByRole('dialog', { name: /review details/i }),
  ).toContainText(/source location \/ excerpt/i);
  await expect(
    page.getByLabel('Category (from active-session catalog)'),
  ).not.toHaveValue('');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const reviewRow = page.getByRole('row').filter({ hasText: 'SHOPEE' }).last();
  await expect(reviewRow).toContainText('approved');
  await page.keyboard.press('Escape');

  await expect(
    page.getByRole('heading', { name: /wallet commit/i }),
  ).toBeVisible();
  await page.getByLabel(/wallet api token/i).fill(walletToken);
  await page
    .getByRole('button', { name: 'Connect & load Wallet data' })
    .click();
  await expect(page.getByText(/state:/i)).toContainText('ready');
  await expect(page.getByLabel(/wallet api token/i)).toHaveValue('');
  await page
    .getByLabel(/destination account/i)
    .selectOption('wallet-account-1');
  await page
    .getByLabel(/^map .* to wallet category$/i)
    .selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save selection & mappings' }).click();
  await page.getByRole('button', { name: 'Create dry-run' }).click();
  await expect(page.getByText('Not sent yet', { exact: true })).toBeVisible();
  expect(walletCreateCalls).toBe(0);
  await page
    .getByRole('button', { name: 'Confirm & commit (irreversible)' })
    .click();
  const walletDialog = page.getByRole('dialog', { name: 'Confirm commit' });
  await expect(walletDialog).toContainText('E2E Wallet');
  await expect(walletDialog).toContainText('cannot be undone');
  await expect(
    walletDialog.getByRole('button', { name: 'Yes, commit' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Confirm & commit (irreversible)' }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Confirm & commit (irreversible)' })
    .click();
  await walletDialog.getByRole('button', { name: 'Yes, commit' }).click();
  await expect(
    page.getByRole('heading', { name: 'Commit results' }),
  ).toBeVisible();
  expect(walletCreateCalls).toBe(1);
  await page.getByRole('button', { name: 'Retry server errors (1)' }).click();
  await expect(page.getByLabel('status succeeded')).toBeVisible();
  const walletDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download redacted summary' }).click();
  expect((await walletDownload).suggestedFilename()).toBe(
    'wallet-import-results.csv',
  );
  expect(await page.content()).not.toContain(walletToken);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });

  await firstReviewDetails.click();
  await page.getByRole('button', { name: 'Return to review' }).click();
  await expect(reviewRow).toContainText('needs_review');
  await page.keyboard.press('Escape');
  await expect(firstReviewDetails).toBeFocused();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review summary' }).click();
  expect((await download).suggestedFilename()).toBe('review-summary.csv');
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });

  // Verify no raw history rendered in error (should not contain full history dump)
  const content = await page.content();
  expect(content).not.toContain('wallet-001;2026-07-29');

  // Clear
  await page.getByRole('button', { name: 'Clear session' }).click();
  await page.getByRole('button', { name: 'Confirm clear' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import statement' }),
  ).toBeVisible();
  await expect(page.getByText('Extraction results')).toHaveCount(0);
  await expect(page.getByText('History imported:')).toHaveCount(0);
  await expect(page.getByText('Category proposals')).toHaveCount(0);
  await expect(page.getByText('Review workspace')).toHaveCount(0);

  expect(unexpectedRequests).toEqual([]);
  await fake.close();
});
