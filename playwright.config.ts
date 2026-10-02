import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium when one is available (e.g. in cloud dev boxes).
const localChromium = '/opt/pw-browsers/chromium';
const launchOptions = !process.env.CI && existsSync(localChromium) ? { executablePath: localChromium } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/playwright',
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/epub-converter/',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/epub-converter/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
});
