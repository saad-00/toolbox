import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    launchOptions: { executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' },
  },
  webServer: { command: 'node tests/e2e/serve.js', port: 4173, reuseExistingServer: true },
});
