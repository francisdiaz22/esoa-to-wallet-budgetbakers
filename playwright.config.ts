import { defineConfig } from '@playwright/test';

const clientPort = Number.parseInt(process.env.E2E_CLIENT_PORT ?? '4300', 10);
const apiPort = Number.parseInt(process.env.E2E_API_PORT ?? '4310', 10);
const baseURL = `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: `PORT=${apiPort} E2E_API_PORT=${apiPort} E2E_CLIENT_PORT=${clientPort} npm run dev`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
