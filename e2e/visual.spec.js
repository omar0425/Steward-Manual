'use strict';

/*
 * Visual regression snapshots. OPT-IN and isolated from the merge-gating CI:
 * the whole file skips unless VISUAL=1, so the normal `npx playwright test` run
 * stays green even before baselines exist.
 *
 * Generate baselines once on a machine with a browser, then commit them:
 *   npm run test:visual:update      # writes e2e/visual.spec.js-snapshots/*
 * Compare on later runs:
 *   npm run test:visual
 * Once baselines are committed you can also run this in a dedicated CI job.
 *
 * Highly dynamic regions (live interest meter, Monte-Carlo forecast, chart,
 * dates) are masked so they don't cause false diffs.
 */

const { test, expect } = require('@playwright/test');
const { register, suppressOnboarding, passGates, addDebtAccounts, startClimb } = require('./helpers');

test.describe('Visual regression', () => {
  test.skip(!process.env.VISUAL, 'opt-in: run with VISUAL=1 (and committed baselines)');

  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('#login-username, #goto-register', { timeout: 15_000 });
    await expect(page).toHaveScreenshot('login.png', { fullPage: true, animations: 'disabled' });
  });

  test('dashboard', async ({ page }) => {
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
    await startClimb(page);
    await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
      animations: 'disabled',
      // Mask regions that legitimately change every load.
      mask: [
        page.locator('#interest-meter'),
        page.locator('#payoff-forecast'),
        page.locator('#networth-chart-svg'),
        page.locator('#debt-free-date'),
        page.locator('#data-last-snapshot'),
        page.locator('#app-version'),
      ],
    });
  });
});
