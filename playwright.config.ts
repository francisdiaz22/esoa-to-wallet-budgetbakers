import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4300',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4300/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
