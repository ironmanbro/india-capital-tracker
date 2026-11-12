const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  use: {
    launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] },
  },
});
