import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('imports the synthetic fixture, inspects evidence, and clears without reload or persistence', async ({
  page,
}) => {
  const unexpectedRequests: string[] = [];
  const consoleMessages: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      unexpectedRequests.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.addInitScript(() => {
    const state = { storageWrites: 0, indexedDbOpens: 0 };
    Object.defineProperty(window, '__phase1PersistenceCalls', { value: state });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      state.storageWrites += 1;
      return originalSetItem.apply(this, args);
    };
    const originalOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (...args) {
      state.indexedDbOpens += 1;
      return originalOpen(...args);
    };
  });

  await page.goto('/');
  const initialUrl = page.url();
  await page
    .getByLabel(/drag a document/i)
    .setInputFiles(
      [1, 2, 3].map((pageNumber) =>
        resolve(`fixtures/synthetic/bdo/statement_page_${pageNumber}.jpg`),
      ),
    );
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page.getByText('Extraction results')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('Proposed:').locator('..')).toContainText('33');
  await expect(page.getByText('Total (abs):').locator('..')).toContainText(
    'PHP 34,957.17',
  );
  const firstRow = page.getByRole('button', {
    name: /view details for pc express/i,
  });
  await firstRow.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    'PC EXPRESS SM NORTH II QUEZON CITY PH',
  );

  await page.getByRole('button', { name: 'Clear session' }).click();
  await page.getByRole('button', { name: 'Confirm clear' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import statement' }),
  ).toBeVisible();
  await expect(page.getByText('Extraction results')).toHaveCount(0);
  expect(page.url()).toBe(initialUrl);
  expect(unexpectedRequests).toEqual([]);
  expect(consoleMessages.join('\n')).not.toContain('PC EXPRESS');
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __phase1PersistenceCalls: {
              storageWrites: number;
              indexedDbOpens: number;
            };
          }
        ).__phase1PersistenceCalls,
    ),
  ).toEqual({ storageWrites: 0, indexedDbOpens: 0 });
});
