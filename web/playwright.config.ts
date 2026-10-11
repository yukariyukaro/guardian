import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
    headless: false,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --port 5187',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    env: { VITE_API_MODE: 'mock' },
  },
});
