'use strict';

const { test, expect } = require('@playwright/test');
const { register, login, uniqueUser, suppressOnboarding, passGates, PASSWORD } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await suppressOnboarding(page);
});

test.describe('Authentication', () => {
  test('registering a new account signs you in and leaves /login', async ({ page }) => {
    const { user } = await register(page);
    await expect(page).not.toHaveURL(/\/login/);
    // The app shell has loaded (commitment gate or app), not the login form.
    await expect(page.locator('#login-form')).toHaveCount(0);
    expect(user).toBeTruthy();
  });

  test('register rejects mismatched passwords (client-side, no request)', async ({ page }) => {
    const user = uniqueUser();
    await page.goto('/login');
    await page.click('#goto-register');
    await page.fill('#reg-username', user);
    await page.fill('#reg-email', `${user}@example.com`);
    await page.fill('#reg-password', PASSWORD);
    await page.fill('#reg-confirm', 'different-password-9');
    await page.click('#register-submit');
    await expect(page.locator('#register-error')).toContainText(/do not match/i);
    await expect(page).toHaveURL(/\/login|\/$/);
  });

  test('register rejects a too-short password', async ({ page }) => {
    const user = uniqueUser();
    await page.goto('/login');
    await page.click('#goto-register');
    await page.fill('#reg-username', user);
    await page.fill('#reg-email', `${user}@example.com`);
    await page.fill('#reg-password', 'short');
    await page.fill('#reg-confirm', 'short');
    await page.click('#register-submit');
    await expect(page.locator('#register-error')).toContainText(/at least 10 characters/i);
  });

  test('register rejects a duplicate username', async ({ page }) => {
    const { user } = await register(page);
    // Drop the session so /login doesn't redirect us back to the app, then
    // attempt to register the same username as an unauthenticated visitor.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.click('#goto-register');
    await page.fill('#reg-username', user);
    await page.fill('#reg-email', `${user}-2@example.com`);
    await page.fill('#reg-password', PASSWORD);
    await page.fill('#reg-confirm', PASSWORD);
    await page.click('#register-submit');
    await expect(page.locator('#register-error')).toContainText(/different username|could not create/i);
  });

  test('login with wrong password shows an error and stays on /login', async ({ page }) => {
    const { user } = await register(page);
    // Sign out (clear cookie) so /login renders the form instead of redirecting.
    await page.context().clearCookies();
    await login(page, user, 'wrong-password-xyz');
    await expect(page.locator('#login-error')).toContainText(/invalid username or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('register → logout → login round trip works', async ({ page }) => {
    const { user, password } = await register(page);
    // Enter the app so the nav (with Sign out) is interactable.
    await passGates(page);
    await page.locator('#nav-logout-btn').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Now sign back in with the same credentials.
    await login(page, user, password);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('#login-form')).toHaveCount(0);
  });
});
