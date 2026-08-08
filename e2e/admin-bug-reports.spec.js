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

  test('extension-origin errors are filtered out; real app errors still report', async ({ page }) => {
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);

    // Watch what bug-watch actually posts.
    const posts = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/bug-report') && req.method() === 'POST') {
        try { posts.push(JSON.parse(req.postData() || '{}')); } catch (_) { posts.push({}); }
      }
    });

    await page.evaluate(() => {
      // The real-world case that motivated the filter: a media extension's
      // content script throwing on the dashboard.
      const ext = new ReferenceError('EmptyRanges is not defined');
      ext.stack = 'ReferenceError: EmptyRanges is not defined\n'
        + '    at played (chrome-extension://abcdefghijklmnop/content.js:10:5)\n'
        + '    at syncControl (chrome-extension://abcdefghijklmnop/content.js:22:9)';
      window.dispatchEvent(new ErrorEvent('error', {
        message: ext.message, filename: 'chrome-extension://abcdefghijklmnop/content.js', error: ext,
      }));
      // Masked cross-origin noise carries no information at all.
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
      // A same-origin app error MUST still get through.
      const real = new TypeError('boom from the app');
      real.stack = 'TypeError: boom from the app\n    at renderDashboard (' + location.origin + '/js/render.js:5:5)';
      window.dispatchEvent(new ErrorEvent('error', {
        message: real.message, filename: location.origin + '/js/render.js', error: real,
      }));
    });

    // The reporter fires synchronously from the event; give the requests a beat.
    await expect.poll(() => posts.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    expect(posts.filter((p) => /EmptyRanges/.test(p.message || ''))).toHaveLength(0);
    expect(posts.filter((p) => /Script error/.test(p.message || ''))).toHaveLength(0);
    expect(posts.filter((p) => /boom from the app/.test(p.message || ''))).toHaveLength(1);
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
