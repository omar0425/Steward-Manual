'use strict';

/**
 * Smoke test for the tier gallery. The page is rendered entirely client-side
 * by a module script, so a CSP or script-load regression blanks it silently
 * while the route itself still returns 200 — exactly what happened once
 * before. This guards the "page renders at all" invariant, not styling.
 */

const { test, expect } = require('@playwright/test');

test.describe('showcase gallery', () => {
  test('renders all ten tier cards', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/showcase');

    const cards = page.locator('.sc-card');
    await expect(cards).toHaveCount(10, { timeout: 10_000 });

    // Each card mounts a character rig; an empty shell means the module
    // loaded but rendering broke partway.
    await expect(page.locator('.sc-card .steward-wrap').first()).toBeAttached();

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
