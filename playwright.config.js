module.exports = {
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      'X-API-Key': '13940e4c045e4b2691354522b103d7be',
    },
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/reports', open: 'never' }],
  ],
};
