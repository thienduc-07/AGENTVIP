import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * PROVIPAGENT Phase 4.3.8: Playwright End-to-End Test Configuration
 * Configures browser automation, diagnostic artifacts on failure, bounded timeouts,
 * and isolated dual webServer execution (Next.js frontend + FastAPI backend on e2e_agency.db).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 45000,
    navigationTimeout: 45000,
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--use-gl=angle',
            '--use-angle=metal',
            '--ignore-gpu-blocklist',
            '--disable-frame-rate-limit',
            '--disable-gpu-vsync',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'cd .. && DATABASE_URL=sqlite:///$(pwd)/e2e_agency.db DISPATCHER_ENABLED=false backend/venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/docs',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'npm run start -- -p 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
