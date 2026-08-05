'use strict';

const { defineConfig, devices } = require('@playwright/test');
const os = require('os');
const path = require('path');

/**
 * E2E config for Steward.
 *
 * The web server is auto-started by Playwright against an ISOLATED throwaway
 * SQLite database in the OS temp dir — E2E never touches the dev/prod DB.
 * A dedicated port (3210) avoids clashing with the dev preview on 3000.
 */
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3210;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DB = path.join(os.tmpdir(), `steward-e2e-${process.pid}-${Date.now()}.db`);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Single shared server + single SQLite file → run serially for determinism.
  // Every test still registers its own unique user, so there is no shared
  // account state between tests.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    // Sandboxed CI/remote runners pre-install one Chromium and block browser
    // downloads; point Playwright at it via env var. Unset → default lookup.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server.js',
    url: `${BASE_URL}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      STEWARD_DB_PATH: TEST_DB,
      NODE_ENV: 'test',
      // Empty → Steward AI endpoint returns 204 and the dialog never appears,
      // so it can't interfere with assertions.
      ANTHROPIC_API_KEY: '',
    },
  },
});
