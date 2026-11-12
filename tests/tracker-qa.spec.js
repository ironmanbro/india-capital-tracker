// tracker-qa.spec.js
const { test, expect } = require('@playwright/test');

test('Verify India Capital Tracker UI elements, buttons, and views', async ({ page }) => {
  // Capture console errors to catch missing JS assets or unhandled exceptions
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1. Load the live site
  await page.goto('https://india-capital-tracker.ironmanbro.workers.dev/');

  // Verify main title loads correctly
  await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();

  // 2. Test closing the introductory / welcome modal if present
  const introModal = page.locator('#opener[role="dialog"]');
  if (await introModal.isVisible()) {
    await page.locator('#op-skip').click();
    await introModal.waitFor({ state: 'hidden', timeout: 5000 });
  }

  const welcomeModal = page.locator('#welcome[role="dialog"]');
  if (await welcomeModal.isVisible()) {
    await page.locator('#welcome-enter').click();
    await welcomeModal.waitFor({ state: 'hidden', timeout: 5000 });
  }

  // 3. Test filter dropdowns on the Overview page
  const dealTypeSelect = page.locator('select[aria-label="Deal type"]').first();
  if (await dealTypeSelect.isVisible()) {
    await dealTypeSelect.selectOption({ index: 1 }); // Select "Investments into India"
    await page.waitForTimeout(500);
  }

  const periodSelect = page.locator('select[aria-label="Period"]').first();
  if (await periodSelect.isVisible()) {
    await periodSelect.selectOption({ value: '30' }); // Last 30 days
    await page.waitForTimeout(500);
  }

  // 4. Test clicking through navigation tabs (Sections)
  const navTabs = page.locator('nav[role="tablist"] button[role="tab"]');
  const tabCount = await navTabs.count();
  console.log(`Found ${tabCount} navigation items to test.`);

  for (let i = 0; i < Math.min(tabCount, 5); i++) {
    const tab = navTabs.nth(i);
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(600);
    }
  }

  // 5. Assert no critical console errors occurred during interactions
  console.log('Captured console errors:', consoleErrors);
  expect(consoleErrors.length).toBe(0);
});
