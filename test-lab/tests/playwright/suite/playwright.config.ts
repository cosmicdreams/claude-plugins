import { defineConfig } from '@playwright/test';

import { appearance } from './support/helpers/appearance';

export default defineConfig({
  testDir: './tests',
  retries: Number(process.env.EXAMPLE_RETRIES ?? 0),
  workers: 1,
  timeout: 15_000,
  globalTeardown: './support/global-teardown.ts',
  use: { baseURL: process.env.EXAMPLE_BASE_URL, ...appearance() },
  projects: [{ name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } }],
});
