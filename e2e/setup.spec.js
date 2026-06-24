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
    // With no account rows there is nothing to commit, so the "Save Debts"
    // button stays hidden — an empty save can't be triggered and the button
    // never reads as an orphaned, dead control.
    await expect(page.locator('#save-snapshot-btn')).toBeHidden();
    // Add an (empty) row → the Save button appears; saving it still validates.
    await page.click('#add-debt-account-btn');
    await expect(page.locator('#save-snapshot-btn')).toBeVisible();
    await page.click('#save-snapshot-btn');
    await expect(page.locator('#snapshot-save-msg, .manual-entry-validation').first())
      .toContainText(/add at least one/i);
  });

  test('adding a debt account then saving reveals "Start Climb"', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
    // The saved row should now be listed.
    await expect(page.locator('#saved-debts-rows .saved-debt-row')).toHaveCount(1);
    await expect(page.locator('#start-climb-btn, #start-climb-empty-btn').first()).toBeVisible();
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
});
