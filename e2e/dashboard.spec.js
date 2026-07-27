'use strict';

const { test, expect, request } = require('@playwright/test');
const {
  register, suppressOnboarding, passGates,
  addDebtAccounts, startClimb,
} = require('./helpers');

test.describe('Health & API smoke', () => {
  test('GET /health returns ok', async ({ baseURL }) => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${baseURL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('steward-manual');
    await ctx.dispose();
  });

  test('GET /api/status requires authentication', async ({ baseURL }) => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${baseURL}/api/status`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});

test.describe('Dashboard chrome', () => {
  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    await register(page);
    await passGates(page);
    const theme = () => page.evaluate(() => document.body.dataset.theme);
    const before = await theme();
    await page.locator('#theme-toggle').click();
    // The flip runs inside a View Transition where supported, so the
    // data-theme attribute updates asynchronously — poll instead of reading
    // it synchronously on the next line.
    await expect.poll(theme).not.toBe(before);
  });

  test('a started climb shows tier badge, name, and next-stage headline', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 78885 }]);
    await startClimb(page);

    await expect(page.locator('#card-badge-chip')).not.toBeEmpty();
    await expect(page.locator('#card-tier-name')).not.toBeEmpty();
    await expect(page.locator('#card-tier-gap-headline')).toContainText(/pay down|reach|stage/i);
    await expect(page.locator('#card-footer-debt')).toContainText('$78,885');
    // Nav stage tag reflects the tier (e.g. "01 — BURIED").
    await expect(page.locator('body')).toContainText(/BURIED/i);
  });

  test('the dashboard leads with a fast balance check and keeps secondary detail folded', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
    await startClimb(page);

    await expect(page.locator('#hero-quick-update-btn')).toBeVisible();
    await expect(page.locator('#hero-quick-update-btn')).toContainText(/check balances/i);
    await expect(page.locator('#debt-chart-section')).not.toHaveAttribute('open', '');
    await expect(page.locator('#stage-progress-section')).not.toHaveAttribute('open', '');
    await expect(page.locator('#add-debt-section')).not.toHaveAttribute('open', '');
    await expect(page.locator('#optional-tools-section')).not.toHaveAttribute('open', '');
    await expect(page.locator('#optional-tools-section #paydown-calc-section')).toHaveCount(1);
    await expect(page.locator('#optional-tools-section #strategy-lab-section')).toHaveCount(1);

    const payoffComesFirst = await page.evaluate(() => {
      const payoff = document.getElementById('pay-next-section');
      const checkIn = document.getElementById('manual-entry-panel');
      return !!(payoff && checkIn && (payoff.compareDocumentPosition(checkIn) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(payoffComesFirst).toBe(true);

    await page.locator('#hero-quick-update-btn').click();
    await expect(page.locator('#quick-update-overlay')).toBeVisible();
    await expect(page.locator('#quick-update-input')).toBeFocused();
    await page.locator('#quick-update-input').fill('');
    await page.locator('#quick-update-next').click();
    await expect(page.locator('#quick-update-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#quick-update-error')).toContainText(/zero or more/i);
    await page.locator('#quick-update-next').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#quick-update-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hero-quick-update-btn')).toBeFocused();

    await page.locator('#hero-manage-accounts-btn').click();
    await expect(page.locator('#add-debt-section')).toHaveAttribute('open', '');
  });
});
