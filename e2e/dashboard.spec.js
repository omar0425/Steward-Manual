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
    const after = await theme();
    expect(after).not.toBe(before);
  });

  test('a started climb shows tier badge, name, and escape-gap headline', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 78885 }]);
    await startClimb(page);

    await expect(page.locator('#card-badge-chip')).not.toBeEmpty();
    await expect(page.locator('#card-tier-name')).not.toBeEmpty();
    await expect(page.locator('#card-tier-gap-headline')).toContainText(/escape|stage|threshold/i);
    await expect(page.locator('#card-footer-debt')).toContainText('$78,885');
    // Nav stage tag reflects the tier (e.g. "01 — BURIED").
    await expect(page.locator('body')).toContainText(/BURIED/i);
  });
});
