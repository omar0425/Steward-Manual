'use strict';

/**
 * Guards the original "CLEAR $7,189 THIS MONTH" logic bug in the real UI: on a
 * large balance the hero CTA must frame escaping a stage realistically (a
 * months timeline or a per-month rate), never demand a whole tier "this month".
 */

const { test, expect } = require('@playwright/test');
const { register, suppressOnboarding, passGates, addDebtAccounts, startClimb } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await suppressOnboarding(page);
});

test('hero CTA frames a large debt as a realistic timeline, not a one-month demand', async ({ page }) => {
  await register(page);
  await passGates(page);
  await addDebtAccounts(page, [{ name: 'Big Card', balance: 77000 }]);
  await startClimb(page);
  await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15_000 });

  const cta = ((await page.locator('#hero-primary-cta').textContent()) || '').trim();
  expect(cta.length).toBeGreaterThan(0);
  // The bug: demanding the whole gap "this month".
  expect(cta.toLowerCase()).not.toContain('this month');
  // The fix: a realistic monthly rate or a multi-month timeline.
  expect(cta.toLowerCase()).toMatch(/month|\/mo/);
});
