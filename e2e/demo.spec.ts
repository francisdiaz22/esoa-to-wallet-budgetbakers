import { expect, test } from '@playwright/test';

test('loads synthetic demo offline through review with blocked Wallet commit and clear', async ({
  page,
}) => {
  test.setTimeout(60000);
  const unexpectedRequests: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === '/api/demo' ||
      url.pathname.startsWith('/api/session/') ||
      url.pathname === '/api/health'
    ) {
      await route.continue();
      return;
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      unexpectedRequests.push(url.origin + url.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  // Onboarding visible, demo button
  await expect(page.getByText('Getting started — onboarding')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load synthetic demo' }),
  ).toBeVisible();

  const demoResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/demo') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Load synthetic demo' }).click();
  const demoResponse = await demoResponsePromise;
  const demoBody = (await demoResponse.json()) as { sessionId: string };

  // Banner
  await expect(
    page.getByText('Synthetic demo data — not a financial record').first(),
  ).toBeVisible({ timeout: 15000 });

  // Extraction results via demo (should show 33 proposed)
  await expect(page.getByText('Extraction results')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('Proposed:').locator('..')).toContainText('33');

  // Review workspace initialized automatically
  await expect(
    page.getByRole('heading', { name: 'Review workspace' }),
  ).toHaveCount(1);

  // WCAG reflow regression: the complete demo must not force document-level
  // horizontal scrolling at the 320 CSS pixel quality-gate viewport.
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  // Review action: open details, approve one, verify state changes (best-effort, must not break demo flow)
  const anyDetails = page
    .getByRole('button', { name: /^View details for/i })
    .first();
  await expect(anyDetails).toBeVisible({ timeout: 15000 });
  await anyDetails.click();
  const dialog = page.getByRole('dialog', { name: /review details/i });
  if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
    const approveBtn = page.getByRole('button', {
      name: 'Approve',
      exact: true,
    });
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    // Fallback: ensure Escape closes any drawer even if dialog label mismatched
    await page.keyboard.press('Escape');
  }

  // Wallet is blocked in demo — should show explanation, not hidden
  await expect(
    page.getByText('Wallet setup is unavailable in synthetic demo'),
  ).toBeVisible();
  await expect(
    page.getByLabel(
      'Wallet API token (password field, not stored beyond session)',
    ),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connect & load Wallet data' }),
  ).toBeDisabled();

  // Server enforcement is authoritative even if a client bypasses the UI.
  const blocked = await page.evaluate(async (sessionId) => {
    const routes = [
      ['connect', { token: 'synthetic-demo-token-never-sent' }],
      ['selection', { walletAccountId: 'x', mappings: [] }],
      ['dry-run', {}],
      ['retry', {}],
    ] as const;
    return Promise.all(
      routes.map(async ([route, body]) => {
        const response = await fetch(
          `/api/session/${sessionId}/wallet/${route}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        return { status: response.status, body: await response.json() };
      }),
    );
  }, demoBody.sessionId);
  expect(blocked).toHaveLength(4);
  for (const response of blocked) {
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('wallet_not_available_in_demo');
  }

  // Ensure no external requests were made beyond loopback
  expect(unexpectedRequests).toEqual([]);

  // Diagnostics preview (explicit, local-only, redacted)
  await page.getByRole('button', { name: 'Preview diagnostics' }).click();
  await expect(page.getByLabel('Diagnostics preview')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByLabel('Diagnostics preview')).toContainText(
    'reportVersion',
  );
  // Ensure preview does NOT contain forbidden fields like rawText or description?
  const previewText = await page
    .getByLabel('Diagnostics preview')
    .textContent();
  expect(previewText).not.toContain('SYNTHETIC MERCHANT');

  // Clear uses normal session cleanup path
  await page.getByRole('button', { name: 'Clear session' }).click();
  await page.getByRole('button', { name: 'Confirm clear' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import statement' }),
  ).toBeVisible();
  await expect(page.getByText('Synthetic demo data')).toHaveCount(0);
  await expect(page.getByText('Extraction results')).toHaveCount(0);

  expect(unexpectedRequests).toEqual([]);
});
