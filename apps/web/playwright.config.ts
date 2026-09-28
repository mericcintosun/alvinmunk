import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const readinessURL = new URL('/api/ready', baseURL).toString();
const rootDir = dirname(fileURLToPath(import.meta.url));
const webServerCommand = 'node ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 300_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    headless: true,
    viewport: { width: 430, height: 932 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    launchOptions: {
      args: ['--no-sandbox'],
    },
  },
  workers: 1,
  outputDir: 'test-results',
  webServer: {
    command: webServerCommand,
    url: readinessURL,
    cwd: rootDir,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
