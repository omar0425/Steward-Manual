'use strict';

/* Admin bug-report panel: deleting a handled report.
 *
 * The panel only exists for the admin account, which the server identifies by
 * username (STEWARD_ADMIN_USERNAME, defaulting to the cutscene user). The e2e
 * server runs against a throwaway DB created fresh per run, so registering that
 * exact name here is safe and gives us a real admin session. */

const { test, expect } = require('@playwright/test');
const {
  register, suppressOnboarding, passGates,
  addDebtAccounts, startClimb,
} = require('./helpers');

const ADMIN_USER = 'LoudFlipFlopz';

/** File a report through the public capture endpoint, as any client would. */
async function fileReport(page, message) {
  const status = await page.evaluate(async (msg) => {
    const res = await fetch('/api/bug-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, source: 'error' }),
    });
    return res.status;
  }, message);
  expect(status).toBe(200);
}

test.describe('Admin bug reports', () => {
  test('the admin can delete a report, and it takes two clicks to do it', async ({ page }) => {
    await suppressOnboarding(page);
    await register(page, { user: ADMIN_USER });
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 4000 }]);
    await startClimb(page);

    const keep = `Keep this one ${Date.now()}`;
    const drop = `Delete this one ${Date.now()}`;
    await fileReport(page, keep);
    await fileReport(page, drop);

    // Reload so initAdminNotices runs with both reports already on file.
    await page.reload();
    await passGates(page);

    const panel = page.locator('#admin-bug-panel');
    await expect(panel).toBeVisible();
    const dropRow = panel.locator('.admin-bug-row', { hasText: drop });
    const keepRow = panel.locator('.admin-bug-row', { hasText: keep });
    await expect(dropRow).toHaveCount(1);
    await expect(keepRow).toHaveCount(1);

    // First click only arms the control — the report must still be there.
    const deleteBtn = dropRow.locator('.admin-bug-delete-btn');
    await deleteBtn.click();
    await expect(deleteBtn).toHaveClass(/is-armed/);
    await expect(deleteBtn).toHaveText(/for good/i);
    await expect(dropRow).toHaveCount(1, 'arming alone must not delete anything');

    // Second click commits. The panel re-pulls from the server, so the row
    // disappearing proves the DELETE landed, not just that the DOM was spliced.
    await deleteBtn.click();
    await expect(dropRow).toHaveCount(0);
    await expect(keepRow).toHaveCount(1, 'only the targeted report is removed');

    // Survives a reload — it is gone from the database, not just this render.
    await page.reload();
    await passGates(page);
    await expect(page.locator('#admin-bug-panel')).toBeVisible();
    await expect(page.locator('.admin-bug-row', { hasText: drop })).toHaveCount(0);
    await expect(page.locator('.admin-bug-row', { hasText: keep })).toHaveCount(1);
  });

  test('a regular user never sees the panel and cannot delete', async ({ page }) => {
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, [{ name: 'Visa', balance: 2000 }]);
    await startClimb(page);
    await fileReport(page, `Regular user report ${Date.now()}`);
    await page.reload();
    await passGates(page);

    await expect(page.locator('#admin-bug-panel')).toHaveCount(0);
    await expect(page.locator('.admin-bug-delete-btn')).toHaveCount(0);

    // The endpoint itself refuses them too — a 404 that reveals nothing about
    // whether the id exists.
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/admin/bug-reports/1', { method: 'DELETE' });
      return res.status;
    });
    expect(status).toBe(404);
  });
});
