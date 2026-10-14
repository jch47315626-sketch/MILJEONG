import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * E2E: 4 browser contexts play one full round against a FAST_CONFIG server.
 * Chromium is pre-installed (never run `playwright install`):
 * /opt/pw-browsers/chromium is a symlink to /opt/pw-browsers/chromium-1194/chrome-linux/chrome.
 * Override with PW_CHROMIUM.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  reporter: CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
      // No GPU here: with WebGL every page renders through SwiftShader in the one shared GPU
      // process, and 4 Phaser loops pin all cores (views then arrive seconds late and clicks
      // miss meeting windows). Without WebGL, Phaser.AUTO falls back to its Canvas renderer.
      args: ['--disable-3d-apis'],
    },
  },
  webServer: [
    {
      command: 'npm start -w packages/server',
      cwd: '../..',
      env: { MILJEONG_FAST: '1', PORT: '2567' },
      port: 2567,
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      env: { VITE_E2E: '1' },
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
