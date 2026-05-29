'use strict';

const { expect } = require('@playwright/test');

const PASSWORD = 'e2e-password-123';
let _counter = 0;

/** Unique username per call so tests never collide in the shared test DB. */
function uniqueUser() {
  _counter += 1;
  return `e2e_${Date.now().toString(36)}_${_counter}_${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Suppress the first-run guided onboarding tour for this page's context.
 * Must be called BEFORE the first navigation. addInitScript persists across
 * navigations within the same context.
 */
async function suppressOnboarding(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('steward_dashboard_guided_tour_v2', '1'); } catch (_) { /* ignore */ }
  });
}

/**
 * Register a brand-new user through the /login UI. Returns { user, password }.
 * After submit the app redirects to '/'.
 */
async function register(page, opts = {}) {
  const user = opts.user || uniqueUser();
  await page.goto('/login');
  await page.click('#goto-register');
  await page.fill('#reg-username', user);
  await page.fill('#reg-email', `${user}@example.com`);
  await page.fill('#reg-password', opts.password || PASSWORD);
  await page.fill('#reg-confirm', opts.password || PASSWORD);
  await page.click('#register-submit');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return { user, password: opts.password || PASSWORD };
}

/** Log in an existing user through the UI. */
async function login(page, user, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#login-username', user);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
}

/**
 * Drive past the commitment / start-session gates until the app finishes
 * booting (appMode === 'ready'). Works for both the setup view and the
 * full dashboard — the caller inspects body.dataset.setupMode to tell which.
 */
async function passGates(page) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const mode = await page.evaluate(() => document.body && document.body.dataset.appMode || '');
    if (mode === 'ready') return;
    for (const sel of ['#commitment-confirm-btn', '#start-game-btn']) {
      const loc = page.locator(sel);
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => {});
        await page.waitForTimeout(250);
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error('App never reached appMode="ready" (stuck on a gate or loading)');
}

/** True when the app is showing the first-run setup (manual-entry) view. */
async function isSetupView(page) {
  return page.evaluate(() => document.body && document.body.dataset.setupMode === 'first');
}

/**
 * From the setup view, add the given debt accounts and click "Save Debts".
 * accounts: [{ name, balance }]
 */
async function addDebtAccounts(page, accounts) {
  for (let i = 0; i < accounts.length; i++) {
    await page.click('#add-debt-account-btn');
    const rows = page.locator('#debt-accounts-entries .debt-account-entry-row');
    const row = rows.nth(i);
    await row.locator('.debt-acct-name').fill(accounts[i].name);
    await row.locator('.debt-acct-balance').fill(String(accounts[i].balance));
  }
  await page.click('#save-snapshot-btn');
  // "Start Climb" becomes visible once a non-zero account is saved.
  await expect(page.locator('#start-climb-btn, #start-climb-empty-btn').first()).toBeVisible();
}

/** Click whichever "Start Climb" button is visible to lock the baseline. */
async function startClimb(page) {
  const btn = page.locator('#start-climb-btn:visible, #start-climb-empty-btn:visible').first();
  await btn.click();
  // Climb start triggers a soft refresh into the dashboard; wait for the
  // setup view to clear and the tier card to render.
  await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15_000 });
}

/**
 * POST a snapshot through the page's own session (cookie) via fetch. Used to
 * set up post-climb balance history deterministically before asserting the UI.
 * Returns the parsed JSON response.
 */
async function apiSnapshot(page, body) {
  return page.evaluate(async (b) => {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
    return res.json();
  }, body);
}

/** Reload and re-pass gates (used after API-driven state changes). */
async function reloadToDashboard(page) {
  await page.goto('/');
  await passGates(page);
  await expect(page.locator('#card-tier-name')).toBeVisible({ timeout: 15_000 });
}

module.exports = {
  PASSWORD,
  uniqueUser,
  suppressOnboarding,
  register,
  login,
  passGates,
  isSetupView,
  addDebtAccounts,
  startClimb,
  apiSnapshot,
  reloadToDashboard,
};
