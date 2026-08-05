'use strict';
const { test, expect, devices } = require('@playwright/test');
const h = require('./helpers');

test.use({ ...devices['iPhone 14 Pro'], browserName: 'chromium', isMobile: true, hasTouch: true });

test('classify dialog is fully reachable and completable on mobile', async ({ page }) => {
  await h.suppressOnboarding(page);
  await h.register(page);
  await h.passGates(page);

  const accounts = [];
  for (let i = 1; i <= 8; i++) accounts.push({ name: `Card number ${i}`, balance: 1000 + i * 137 });
  await h.addDebtAccounts(page, accounts);
  await h.startClimb(page);

  const rows = page.locator('#saved-debts-rows .saved-debt-row');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const input = rows.nth(i).locator('.saved-debt-balance-input');
    const cur = Number(await input.inputValue());
    await input.fill(String(cur + 50));
  }
  await page.click('#update-balances-btn');
  const dialog = page.locator('#paydown-confirm-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const probe = await page.evaluate(() => {
    const overlay = document.getElementById('paydown-confirm-dialog');
    const card = overlay.querySelector('.paydown-confirm-card');
    const title = overlay.querySelector('.paydown-confirm-title').getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      titleTop: title.top,
      cardHeight: card.getBoundingClientRect().height,
      overlayOverflowY: getComputedStyle(overlay).overflowY,
      overlayScrollable: overlay.scrollHeight > overlay.clientHeight,
    };
  });
  console.log('DIALOG', JSON.stringify(probe, null, 2));
  // Title must start on-screen, not clipped off the top.
  expect(probe.titleTop).toBeGreaterThanOrEqual(0);
  expect(probe.overlayOverflowY).toBe('auto');

  // Scroll the overlay to the bottom: Save must land inside the viewport.
  await page.evaluate(() => {
    const overlay = document.getElementById('paydown-confirm-dialog');
    overlay.scrollTop = overlay.scrollHeight;
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const overlay = document.getElementById('paydown-confirm-dialog');
    const save = overlay.querySelector('.paydown-confirm-save').getBoundingClientRect();
    return { scrollTop: overlay.scrollTop, saveTop: save.top, saveBottom: save.bottom, innerHeight: window.innerHeight };
  });
  console.log('AFTER', JSON.stringify(after, null, 2));
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.saveBottom).toBeLessThanOrEqual(after.innerHeight);
  expect(after.saveTop).toBeGreaterThanOrEqual(0);

  // The real user journey: mark every increase as interest, then Save.
  const classifyRows = dialog.locator('.paydown-classify-row');
  const rowCount = await classifyRows.count();
  expect(rowCount).toBe(n);
  for (let i = 0; i < rowCount; i++) {
    const radio = classifyRows.nth(i).locator('input[value="interest"]');
    await radio.scrollIntoViewIfNeeded();
    await radio.check();
  }
  await page.screenshot({ path: 'test-results/classify-fixed.png' });
  await dialog.locator('.paydown-confirm-save').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
});
