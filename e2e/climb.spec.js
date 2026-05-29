'use strict';

const { test, expect } = require('@playwright/test');
const {
  register, suppressOnboarding, passGates,
  addDebtAccounts, startClimb, apiSnapshot, reloadToDashboard,
} = require('./helpers');

test.beforeEach(async ({ page }) => {
  await suppressOnboarding(page);
});

/** Shared arrange: new user with a started climb at $78,885 across 4 accounts. */
async function startedClimb(page) {
  await register(page);
  await passGates(page);
  await addDebtAccounts(page, [
    { name: 'Visa', balance: 17549 },
    { name: 'MC', balance: 17551 },
    { name: 'Car', balance: 23100 },
    { name: 'Student', balance: 20685 },
  ]);
  await startClimb(page);
}

test.describe('Climb lifecycle', () => {
  test('freshly started climb shows the empty chart state, not a fake trend', async ({ page }) => {
    await startedClimb(page);
    // Only the baseline snapshot exists → chart hidden, header still populated.
    await expect(page.locator('#stat-net-worth-chart')).toContainText('$78,885');
    await expect(page.locator('#chart-trend-delta')).toContainText(/tracking from today/i);
    await expect(page.locator('#nw-empty-state')).toBeVisible();
    await expect(page.locator('#nw-empty-state')).toContainText(/update your balances/i);
    // A single point can't draw a trend: the SVG is hidden (via the
    // .chart-wrap svg[hidden] rule) and the line path stays empty.
    await expect(page.locator('#networth-chart-svg')).toBeHidden();
    expect(await page.locator('#nw-line').getAttribute('d')).toBeFalsy();
  });

  test('a paydown update renders the trend chart and a downward delta', async ({ page }) => {
    await startedClimb(page);
    // Pay $5,000 off the Visa (post-climb snapshot).
    const res = await apiSnapshot(page, {
      totalDebt: 73885,
      debtAccounts: [
        { id: 'a1', name: 'Visa', balance: 12549 },
        { id: 'a2', name: 'MC', balance: 17551 },
        { id: 'a3', name: 'Car', balance: 23100 },
        { id: 'a4', name: 'Student', balance: 20685 },
      ],
    });
    expect(res.ok).toBeTruthy();
    await reloadToDashboard(page);

    await expect(page.locator('#stat-net-worth-chart')).toContainText('$73,885');
    await expect(page.locator('#chart-trend-delta')).toContainText(/\$5,000 since first snapshot/);
    await expect(page.locator('#networth-chart-svg')).toBeVisible();
    // The drawn line path should be non-empty now.
    const d = await page.locator('#nw-line').getAttribute('d');
    expect(d && d.length).toBeGreaterThan(0);
  });

  test('the debt chart ignores pre-climb setup snapshots', async ({ page }) => {
    // Regression guard for the original bug: setup-phase saves must not appear
    // as debt "growth" in the chart. Here the climb just started (1 post-climb
    // snapshot) so the trend must NOT render despite earlier setup saves.
    await register(page);
    await passGates(page);
    // Three iterative setup saves (the exact pattern that caused the bug).
    await addDebtAccounts(page, [{ name: 'Visa', balance: 17549 }]);
    await apiSnapshot(page, {
      totalDebt: 35100,
      debtAccounts: [
        { id: 'a1', name: 'Visa', balance: 17549 },
        { id: 'a2', name: 'MC', balance: 17551 },
      ],
    });
    await apiSnapshot(page, {
      totalDebt: 78885,
      debtAccounts: [
        { id: 'a1', name: 'Visa', balance: 17549 },
        { id: 'a2', name: 'MC', balance: 17551 },
        { id: 'a3', name: 'Car', balance: 23100 },
        { id: 'a4', name: 'Student', balance: 20685 },
      ],
    });
    await page.goto('/');
    await passGates(page);
    await startClimb(page);

    // Exactly one post-climb snapshot → empty state, never an "↑ since first
    // snapshot" trend built from the setup ramp. SVG hidden, line path empty,
    // and the delta must never show the setup-ramp figure ($61,336).
    await expect(page.locator('#nw-empty-state')).toContainText(/update your balances/i);
    await expect(page.locator('#networth-chart-svg')).toBeHidden();
    expect(await page.locator('#nw-line').getAttribute('d')).toBeFalsy();
    await expect(page.locator('#chart-trend-delta')).not.toContainText(/\$61,336/);
  });

  test('adding new debt after climb start is reflected on the dashboard', async ({ page }) => {
    await startedClimb(page);
    // Borrow more: total rises to $82,885.
    await apiSnapshot(page, {
      totalDebt: 82885,
      debtAccounts: [
        { id: 'a1', name: 'Visa', balance: 21549 },
        { id: 'a2', name: 'MC', balance: 17551 },
        { id: 'a3', name: 'Car', balance: 23100 },
        { id: 'a4', name: 'Student', balance: 20685 },
      ],
    });
    await reloadToDashboard(page);
    await expect(page.locator('#card-footer-debt')).toContainText('$82,885');
  });
});
