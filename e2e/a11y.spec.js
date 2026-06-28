'use strict';

/**
 * Automated accessibility / UI-bug scan with axe-core. Runs on every PR as part
 * of the Playwright job. Catches structural UI bugs — missing form labels,
 * buttons with no accessible name, bad ARIA, duplicate IDs, etc.
 *
 * Scoped to fail only on `critical` + `serious` impact so it's a meaningful gate
 * without flaking on every minor nitpick. `color-contrast` is excluded for now
 * (theme-dependent; worth a dedicated pass later) — flip it on by removing it
 * from disableRules when you want to tighten.
 */

const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const {
  register, suppressOnboarding, passGates, isSetupView, addDebtAccounts, startClimb,
} = require('./helpers');

const BLOCKING = ['critical', 'serious'];

async function scan(page) {
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.includes(v.impact));
  // Surface details in the CI log so failures are actionable at a glance.
  if (blocking.length) {
    console.log('axe violations:', JSON.stringify(
      blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })),
      null, 2,
    ));
  }
  return blocking;
}

test.beforeEach(async ({ page }) => {
  await suppressOnboarding(page);
});

test('a11y: login page has no critical/serious violations', async ({ page }) => {
  await page.goto('/login');
  await page.waitForSelector('#login-username, #goto-register', { timeout: 15_000 });
  const blocking = await scan(page);
  expect(blocking.map((v) => v.id).join(', ')).toBe('');
});

test('a11y: first-run setup view has no critical/serious violations', async ({ page }) => {
  await register(page);
  await passGates(page);
  expect(await isSetupView(page)).toBe(true);
  const blocking = await scan(page);
  expect(blocking.map((v) => v.id).join(', ')).toBe('');
});

test('a11y: full dashboard has no critical/serious violations', async ({ page }) => {
  await register(page);
  await passGates(page);
  await addDebtAccounts(page, [{ name: 'Visa', balance: 5000 }]);
  await startClimb(page);
  await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15_000 });
  const blocking = await scan(page);
  expect(blocking.map((v) => v.id).join(', ')).toBe('');
});
