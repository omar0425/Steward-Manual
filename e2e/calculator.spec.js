'use strict';

const { test, expect } = require('@playwright/test');
const {
  suppressOnboarding, register, passGates, isSetupView,
  addDebtAccounts, startClimb, reloadToDashboard,
} = require('./helpers');

test.describe('Paydown calculator + average APR', () => {
  test('two-way paydown ↔ percent, and average-APR display', async ({ page }) => {
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    if (await isSetupView(page)) {
      await addDebtAccounts(page, [{ name: 'Visa', balance: 10000 }]);
      await startClimb(page);
    }

    const dollars = page.locator('#calc-dollars');
    const percent = page.locator('#calc-percent');
    await expect(dollars).toBeVisible();

    // $ → %  : $500 of $10,000 debt = 5%
    await dollars.fill('500');
    await expect(percent).toHaveValue('5');

    // % → $  : 10% of $10,000 debt = $1,000
    await percent.fill('10');
    await expect(dollars).toHaveValue('1000');

    // Average APR: set one rate via the API, reload, expect it surfaced.
    const id = await page.evaluate(async () => {
      const s = await (await fetch('/api/status')).json();
      const lines = s.stats && s.stats.debtAccountLines;
      return lines && lines[0] ? lines[0].id : null;
    });
    expect(id).toBeTruthy();
    await page.evaluate(async (accId) => {
      await fetch('/api/config/interest-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: { [accId]: 20 } }),
      });
    }, id);

    await reloadToDashboard(page);
    await expect(page.locator('#calc-avg-apr')).toHaveText('20%');
  });
});
