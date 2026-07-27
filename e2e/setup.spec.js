'use strict';

const { test, expect } = require('@playwright/test');
const {
  register, suppressOnboarding, passGates, isSetupView,
  addDebtAccounts, startClimb,
} = require('./helpers');

test.beforeEach(async ({ page }) => {
  await suppressOnboarding(page);
});

test.describe('First-run setup', () => {
  test('a brand-new user lands in the setup / manual-entry view', async ({ page }) => {
    await register(page);
    await passGates(page);
    expect(await isSetupView(page)).toBe(true);
    await expect(page.locator('#add-debt-account-btn')).toBeVisible();
  });

  test('saving with no accounts shows a validation message', async ({ page }) => {
    await register(page);
    await passGates(page);
    // Setup removes a click by preparing the first empty account row.
    await expect(page.locator('.debt-account-entry-row')).toHaveCount(1);
    await expect(page.locator('#save-snapshot-btn')).toBeVisible();
    await page.click('#save-snapshot-btn');
    await expect(page.locator('#snapshot-save-msg, .manual-entry-validation').first())
      .toContainText(/add at least one/i);
  });

  test('setup previews the payoff value before the user commits', async ({ page }) => {
    await register(page);
    await passGates(page);
    await expect(page.locator('.setup-title')).toContainText(/pay first/i);
    const row = page.locator('.debt-account-entry-row').first();
    await row.locator('.debt-acct-name').fill('Visa');
    await row.locator('.debt-acct-balance').fill('5000');
    await expect(page.locator('#setup-live-total-value')).toHaveText('$5,000');
    await expect(page.locator('#setup-payoff-promise')).toBeVisible();
    await expect(page.locator('#setup-payoff-promise')).toContainText(/account to attack first/i);
  });

  test('saving a debt reveals the payoff-plan action', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
    // The saved row should now be listed.
    await expect(page.locator('#saved-debts-rows .saved-debt-row')).toHaveCount(1);
    await expect(page.locator('#start-climb-btn')).toBeVisible();
    await expect(page.locator('#start-climb-btn')).toHaveText(/show my payoff plan/i);
  });

  test('full setup → start climb lands on the dashboard with correct debt', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [
      { name: 'Visa', balance: 17549 },
      { name: 'Car Loan', balance: 23100 },
    ]);
    await startClimb(page);
    // Dashboard renders with the summed debt.
    await expect(page.locator('#card-footer-debt')).toContainText('$40,649');
    await expect(page.locator('#card-tier-name')).not.toBeEmpty();
    expect(await isSetupView(page)).toBeFalsy();
  });

  test('removing the final tracked account can be saved without counting it as paydown', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
    await startClimb(page);

    await page.locator('.saved-debt-row .saved-debt-remove').click();
    await expect(page.locator('#saved-debts-list')).toBeVisible();
    await expect(page.locator('#update-balances-btn')).toBeVisible();
    await expect(page.locator('#update-balances-btn')).toBeEnabled();

    await page.locator('#update-balances-btn').click();
    await expect(page.locator('#paydown-confirm-dialog')).toBeVisible();
    await expect(page.locator('#paydown-confirm-dialog')).toContainText(/Visa.*removed/i);
    await page.locator('.paydown-confirm-save').click();
    await expect(page.locator('#snapshot-save-msg')).toContainText('Saved', { timeout: 8000 });

    const status = await page.evaluate(() => fetch('/api/status').then((res) => res.json()));
    expect(status.stats.debtRemaining).toBe(0);
    expect(status.stats.debtAccountLines).toEqual([]);
    expect(status.stats.cumulativePaidDown).toBe(0);

    await page.reload();
    await passGates(page);
    const reloaded = await page.evaluate(() => fetch('/api/status').then((res) => res.json()));
    expect(reloaded.stats.debtRemaining).toBe(0);
    expect(reloaded.stats.debtAccountLines).toEqual([]);
  });

  test('dashboard stays within a 320px viewport and keeps the useful debt columns', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Long Visa Signature Account', balance: 5000 }]);
    await startClimb(page);
    await expect(page.locator('#debt-accounts-list .debt-row').first()).toBeVisible();

    const layout = await page.evaluate(() => {
      const row = document.querySelector('#debt-accounts-list .debt-row:not(.debt-row--header)');
      const balance = row && row.querySelector('.dr-balance');
      const delta = row && row.querySelector('.dr-delta');
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        rowRight: row ? row.getBoundingClientRect().right : null,
        balanceVisible: balance ? getComputedStyle(balance).display !== 'none' : false,
        deltaVisible: delta ? getComputedStyle(delta).display !== 'none' : false,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.rowRight).toBeLessThanOrEqual(layout.viewport);
    expect(layout.balanceVisible).toBe(true);
    expect(layout.deltaVisible).toBe(true);
  });

  test('floating balance check appears only after the visible check-in actions leave the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 650 });
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [
      { name: 'Visa', balance: 5000 },
      { name: 'Car', balance: 12000 },
      { name: 'Student', balance: 18000 },
      { name: 'Loan', balance: 3000 },
    ]);
    await startClimb(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#fab-update-balances')).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('#fab-update-balances')).toBeVisible();
    await expect(page.locator('#fab-update-balances')).toContainText(/check balances/i);
  });
});
