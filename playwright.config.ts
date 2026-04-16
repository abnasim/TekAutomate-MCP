import { defineConfig, devices } from '@playwright/test';

// CI has no system Chrome; use installed Chromium. Local can use system Chrome.
const useBrowser = process.env.CI ? devices['Chromium'] : { ...devices['Desktop Chrome'], channel: 'chrome' as const };

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [{ name: process.env.CI ? 'chromium' : 'chrome', use: useBrowser }],
  outputDir: 'test-results/',
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3001',
      BROWSER: 'none',
    },
  },
});
