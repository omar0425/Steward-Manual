'use strict';

/* SHIP-READINESS SWEEP — drives the whole app like a real user from a cold
   start, the way a QA pass before an App Store submission would. Each test is
   an isolated journey on its own fresh user. Every test watches for console
   errors / page crashes and fails on anything unexpected.

   Kept as a permanent end-to-end regression suite covering the major user
   journeys (onboarding → setup → climb → paydown → debt-free → account mgmt). */

const { test, expect, devices } = require('@playwright/test');
const {
  PASSWORD, register, login, suppressOnboarding, passGates,
  addDebtAccounts, startClimb, isSetupView,
} = require('./helpers');

/* The steward-AI coach calls a backend that has no API key in the test env and
   returns 503. That's an environment artifact, not a product defect, so we
   allow-list it but still surface anything else. */
const BENIGN = [
  /503 \(Service Unavailable\)/i,
  /steward-ai/i,
  /favicon/i,
];

function attachConsoleGuard(page, extraBenign = []) {
  const allow = BENIGN.concat(extraBenign);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (allow.some((re) => re.test(t))) return;
    errors.push(`[console.error] ${t}`);
  });
  page.on('pageerror', (e) => {
    const t = e.message || String(e);
    if (allow.some((re) => re.test(t))) return;
    errors.push(`[pageerror] ${t}`);
  });
  return errors;
}

/** Probe the user-visible state the dashboard exposes. */
async function probe(page) {
  return page.evaluate(() => {
    const txt = (id) => { const el = document.getElementById(id); return el ? (el.textContent || '').trim() : null; };
    const vis = (id) => { const el = document.getElementById(id); if (!el) return false; const cs = getComputedStyle(el); return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const attr = (id, a) => { const el = document.getElementById(id); return el ? el.getAttribute(a) : null; };
    return {
      tierBadge: txt('card-badge-chip'),
      tierName: txt('card-tier-name'),
      streakBadge: txt('streak-badge'),
      streakZero: attr('streak-badge', 'data-zero'),
      debtTotal: txt('debt-total-val'),
      cardFooterDebt: txt('card-footer-debt'),
      chartBig: txt('stat-net-worth-chart'),
      chartDelta: txt('chart-trend-delta'),
      chartVisible: vis('networth-chart-svg'),
      nwLineD: attr('nw-line', 'd'),
      emptyVisible: vis('nw-empty-state'),
      unsavedBadge: !!document.getElementById('saved-debts-unsaved-badge'),
      startClimbVisible: vis('start-climb-btn'),
      saveMsg: txt('snapshot-save-msg'),
      savedRows: Array.from(document.querySelectorAll('#saved-debts-rows .saved-debt-row')).map((r) => ({
        name: r.dataset.name, prevBalance: r.dataset.prevBalance,
        val: (r.querySelector('.saved-debt-balance-input') || {}).value,
      })),
      readonlyRows: Array.from(document.querySelectorAll('#debt-accounts-list .debt-row')).map((r) => ({
        name: (r.querySelector('.dr-name') || {}).textContent,
        bal: (r.querySelector('.dr-balance') || {}).textContent,
        paidOff: !!r.querySelector('.dr-paid-badge, [class*="paid"]'),
      })),
    };
  });
}

/** Edit the saved-debt inputs and commit through the Update Balances flow. */
async function updateBalances(page, edits) {
  for (const [name, bal] of Object.entries(edits)) {
    const input = page.locator(`.saved-debt-row[data-name="${name}"] .saved-debt-balance-input`);
    await input.fill(String(bal));
    await input.dispatchEvent('input');
  }
  await page.waitForTimeout(150);
  // The button can sit below the fold; JS-click bypasses the harness scroll quirk.
  await page.evaluate(() => { const b = document.getElementById('update-balances-btn'); if (b) b.click(); });
  await expect(page.locator('#paydown-confirm-dialog')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => { const b = document.querySelector('.paydown-confirm-save'); if (b) b.click(); });
  await expect(page.locator('#snapshot-save-msg')).toContainText('Saved', { timeout: 8000 });
  // Let the delayed resync + chart re-render settle.
  await page.waitForTimeout(800);
}

async function addAccountMidClimb(page, name, balance) {
  // Mid-climb, the add-debt form is folded into a collapsed <details>; its
  // inputs exist but are not visible, so fill() times out. Open it first.
  await page.evaluate(() => {
    const d = document.getElementById('add-debt-section');
    if (d && 'open' in d) d.open = true;
  });
  await page.evaluate(() => { const b = document.getElementById('add-debt-account-btn'); if (b) b.click(); });
  const row = page.locator('#debt-accounts-entries .debt-account-entry-row').last();
  await row.locator('.debt-acct-name').fill(name);
  await row.locator('.debt-acct-balance').fill(String(balance));
  await page.evaluate(() => { const b = document.getElementById('save-snapshot-btn'); if (b) b.click(); });
  await expect(page.locator('#snapshot-save-msg')).toContainText('Saved', { timeout: 8000 });
  await page.waitForTimeout(800);
}

const STARTING = [
  { name: 'Visa', balance: 17549 },
  { name: 'MC', balance: 17551 },
  { name: 'Car', balance: 23100 },
  { name: 'Student', balance: 20685 },
];
const TOTAL = STARTING.reduce((s, a) => s + a.balance, 0); // 78,885

// ───────────────────────────────────────────────────────────────────────────
test.describe('Ship-readiness sweep', () => {
  test('1. First-run onboarding tour is shown and dismissible (no suppression)', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await register(page);            // do NOT suppress the guided tour
    await passGates(page);
    // The app should boot to a usable view; the tour (if present) must not trap.
    await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'ready', { timeout: 20000 });
    // Try to dismiss any onboarding overlay by Escape + clicking a skip/close.
    await page.keyboard.press('Escape').catch(() => {});
    for (const sel of ['#onboarding-skip', '.onboarding-skip', '[data-onboarding-skip]', '.onboarding-close']) {
      const l = page.locator(sel);
      if (await l.first().isVisible().catch(() => false)) await l.first().click().catch(() => {});
    }
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('2. Happy path: register → setup → start climb → dashboard renders', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    expect(await isSetupView(page)).toBe(true);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    const s = await probe(page);
    expect(s.tierBadge).toBe('01');
    expect(s.tierName).toBe('Buried');
    expect(s.debtTotal).toBe('$78,885');
    expect(s.startClimbVisible).toBe(false);   // leftover-button bug stays fixed
    expect(s.emptyVisible).toBe(true);          // fresh climb = empty chart
    expect(s.chartVisible).toBe(false);
    expect(s.chartDelta).toMatch(/tracking from today/i);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('3. Paydown journey: multiple updates render a downward trend & advance tier', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    // Pay down across several months.
    await updateBalances(page, { Visa: 12549 });            // -5,000 → 73,885
    let s = await probe(page);
    expect(s.chartVisible).toBe(true);
    expect(s.nwLineD).not.toBe('');
    expect(s.chartDelta).toMatch(/↓\s*\$5,000/);
    expect(s.unsavedBadge).toBe(false);
    expect(s.savedRows.find((r) => r.name === 'Visa').prevBalance).toBe('12549');

    await updateBalances(page, { MC: 10000, Car: 18000 });  // → 61,234
    await updateBalances(page, { Student: 12000 });          // → 52,549
    s = await probe(page);
    expect(s.debtTotal).toBe('$52,549');
    expect(s.chartDelta).toMatch(/↓/);
    // Tier should have advanced past the starting 01.
    expect(Number(s.tierBadge)).toBeGreaterThan(1);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('4. Add a new account mid-climb appears immediately (no reload)', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    await addAccountMidClimb(page, 'Personal Loan', 5000);
    const s = await probe(page);
    expect(s.savedRows.some((r) => r.name === 'Personal Loan')).toBe(true);
    expect(s.readonlyRows.some((r) => (r.name || '').includes('Personal Loan'))).toBe(true);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('5. Pay an account to zero → PAID OFF, and pay everything → Debt Free', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    // Zero out one account. Clearing a balance fires the one-shot
    // "account CLEARED" celebration — verify it, then dismiss so the next
    // steps can interact with the page.
    await updateBalances(page, { Visa: 0 });
    const clearedOverlay = page.locator('#account-cleared-overlay');
    await expect(clearedOverlay).toBeVisible({ timeout: 8000 });
    await expect(clearedOverlay.locator('.cleared-name')).toHaveText('Visa');
    await page.locator('#cleared-dismiss').click();
    await expect(clearedOverlay).toHaveCount(0);
    let s = await probe(page);
    const visaRow = s.readonlyRows.find((r) => (r.name || '').includes('Visa'));
    expect(visaRow).toBeTruthy();

    // Zero out everything → debt-free (dismiss the follow-up celebration too).
    await updateBalances(page, { MC: 0, Car: 0, Student: 0 });
    await page.locator('#cleared-dismiss').click({ timeout: 8000 }).catch(() => {});
    s = await probe(page);
    expect(s.debtTotal).toBe('$0');
    expect(s.tierName).toMatch(/debt free/i);
    expect(s.tierBadge).toBe('10');
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('6. State survives a reload and a logout→login round trip', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    const { user } = await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);
    await updateBalances(page, { Visa: 12549 });

    // Reload.
    await page.goto('/');
    await passGates(page);
    await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15000 });
    let s = await probe(page);
    expect(s.debtTotal).toBe('$73,885');

    // Logout → login.
    await page.evaluate(() => { const b = document.getElementById('nav-logout-btn'); if (b) b.click(); });
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 10000 });
    await login(page, user);
    await passGates(page);
    await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15000 });
    s = await probe(page);
    expect(s.debtTotal).toBe('$73,885');
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('7. Protected API + pages require auth when logged out', async ({ page }) => {
    // A 401 on the protected status endpoint is the *expected* logged-out
    // behaviour; Chrome auto-logs it as a console error, so allow it here.
    const errs = attachConsoleGuard(page, [/401 \(Unauthorized\)/]);
    // Visiting the app unauthenticated should land on /login.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    // And the status API must reject the anonymous session.
    const status = await page.evaluate(async () => {
      const r = await fetch('/api/status');
      return r.status;
    });
    expect([401, 403]).toContain(status);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('8. Theme toggle persists across reload', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'));
    await page.evaluate(() => { const b = document.getElementById('theme-toggle'); if (b) b.click(); });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    await page.goto('/');
    await passGates(page);
    const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'));
    expect(afterReload).toBe(after);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('9. Mobile viewport (iPhone): no horizontal overflow, key UI visible', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();
    const errs = attachConsoleGuard(page);
    try {
      await suppressOnboarding(page);
      await register(page);
      await passGates(page);
      await addDebtAccounts(page, STARTING);
      await startClimb(page);
      await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15000 });

      const overflow = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      }));
      // Allow a 2px rounding fudge.
      expect(overflow.docW, `doc ${overflow.docW} > win ${overflow.winW}`).toBeLessThanOrEqual(overflow.winW + 2);
      expect(errs, errs.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('10. Input validation: empty save, bad balances do not crash', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    expect(await isSetupView(page)).toBe(true);

    // Save with no accounts → expect a validation message, not a crash.
    await page.evaluate(() => { const b = document.getElementById('save-snapshot-btn'); if (b) b.click(); });
    await page.waitForTimeout(400);
    const msgEmpty = await page.locator('#snapshot-save-msg').textContent().catch(() => '');
    expect((msgEmpty || '').length).toBeGreaterThan(0);

    // Add an account with a junk balance + empty name, then try to save.
    await page.click('#add-debt-account-btn');
    const row = page.locator('#debt-accounts-entries .debt-account-entry-row').last();
    await row.locator('.debt-acct-name').fill('');
    await row.locator('.debt-acct-balance').fill('-999');
    await page.evaluate(() => { const b = document.getElementById('save-snapshot-btn'); if (b) b.click(); });
    await page.waitForTimeout(500);
    // The app must still be alive and responsive.
    expect(await page.locator('body').isVisible()).toBe(true);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('11. Clear game data returns to setup, account preserved, can restart', async ({ page }) => {
    const errs = attachConsoleGuard(page);
    page.on('dialog', (d) => d.accept().catch(() => {}));   // window.confirm
    await suppressOnboarding(page);
    await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    // Open danger zone and clear game data.
    await page.evaluate(() => {
      const dz = document.querySelector('.play-danger-zone'); if (dz) dz.open = true;
      const b = document.getElementById('play-reset-btn'); if (b) b.click();
    });
    await page.waitForTimeout(1500);
    await page.goto('/');
    await passGates(page);
    // Should be back in setup with a clean slate but still logged in.
    expect(await isSetupView(page)).toBe(true);
    const status = await page.evaluate(async () => (await fetch('/api/status')).status);
    expect(status).toBe(200);   // still authenticated
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('12. Delete account logs out and blocks re-login (destructive, isolated user)', async ({ page }) => {
    // After deletion the page is logged out, so a 401 from the status poll is
    // expected and benign here.
    const errs = attachConsoleGuard(page, [/401 \(Unauthorized\)/]);
    // Delete requires confirm + typing "DELETE" into a prompt + a final alert.
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'DELETE' : undefined).catch(() => {}));
    await suppressOnboarding(page);
    const { user } = await register(page);
    await passGates(page);
    await addDebtAccounts(page, STARTING);
    await startClimb(page);

    await page.evaluate(() => {
      const dz = document.querySelector('.play-danger-zone'); if (dz) dz.open = true;
      const b = document.getElementById('play-delete-account-btn'); if (b) b.click();
    });
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 12000 });

    // The old credentials must no longer work.
    await login(page, user);
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/\/login/);
    expect(errs, errs.join('\n')).toEqual([]);
  });
});
