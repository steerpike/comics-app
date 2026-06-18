const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['./tests/otel-reporter.js'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node scripts/serve-static.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
