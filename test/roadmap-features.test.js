'use strict';

// Roadmap features: debt terms (min payment + due day), the payoff plan's
// minimums summary, due-date reminder selection, the account-cleared
// celebration lifecycle, and push subscription validation.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { db, resetAllGameState, withUser } = require('../db');
const { selectDueReminders, markReminded, nextDueDate } = require('../services/reminders');
const { createLocalUser } = require('../db-auth');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try { return await fn(baseUrl); }
  finally { await new Promise((r) => server.close(r)); }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  withUser(0, resetAllGameState);
});

// ── Debt terms ────────────────────────────────────────────────────────────────

test('debt-terms: round-trips valid terms, drops junk', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/config/debt-terms', {
      terms: {
        visa: { minPayment: 85.5, dueDay: 17 },
        loan: { minPayment: -3, dueDay: 45 },      // both invalid → entry dropped
        med:  { dueDay: 1 },                        // dueDay-only is fine
        junk: 'not-an-object',
      },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.terms, { visa: { minPayment: 85.5, dueDay: 17 }, med: { dueDay: 1 } });

    res = await fetch(`${baseUrl}/api/config/debt-terms`);
    assert.deepEqual((await res.json()).terms, { visa: { minPayment: 85.5, dueDay: 17 }, med: { dueDay: 1 } });

    res = await postJson(baseUrl, '/api/config/debt-terms', { terms: 'nope' });
    assert.equal(res.status, 400);
  });
});

test('status payoffPlan sums known minimums over accounts still owing', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 7000,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 5000 },
        { id: 'med', name: 'Medical', balance: 2000 },
      ],
    });
    assert.equal(res.status, 200);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await postJson(baseUrl, '/api/config/debt-terms', {
      terms: { visa: { minPayment: 120 }, med: { minPayment: 40 } },
    });
    const status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.equal(status.stats.payoffPlan.minimumsMonthly, 160);
    assert.equal(status.stats.payoffPlan.minimumsKnown, 2);
  });
});

// ── Due reminders ─────────────────────────────────────────────────────────────

test('due reminders: window, once-per-cycle, and paid-off exclusion', async () => {
  const user = createLocalUser(`due_${Date.now().toString(36)}`, 'due-test-password-1', `due-${Date.now()}@x.test`);
  try {
    // Balance + terms straight into the DB (the sweep reads cross-user).
    db.prepare(`INSERT INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at) VALUES (?, 'visa', 900, ?)`)
      .run(user.id, new Date().toISOString());
    db.prepare(`INSERT INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at) VALUES (?, 'paid', 0, ?)`)
      .run(user.id, new Date().toISOString());
    db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, 'debt_terms', ?)`)
      .run(user.id, JSON.stringify({ visa: { minPayment: 35, dueDay: 20 }, paid: { dueDay: 20 } }));
    db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, 'debt_account_name_map', ?)`)
      .run(user.id, JSON.stringify({ visa: 'Visa' }));

    // 3 days before the 20th → selected (visa only; paid-off account excluded).
    const jun17 = new Date(2026, 5, 17, 12).getTime();
    let due = selectDueReminders({ now: jun17 }).filter((r) => r.userId === user.id);
    assert.equal(due.length, 1);
    assert.equal(due[0].accountId, 'visa');
    assert.equal(due[0].daysUntil, 3);
    assert.equal(due[0].minPayment, 35);

    // 5 days out → outside the window.
    const jun15 = new Date(2026, 5, 15, 12).getTime();
    assert.equal(selectDueReminders({ now: jun15 }).filter((r) => r.userId === user.id).length, 0);

    // Marked → silent for the rest of THIS cycle, re-arms next month.
    markReminded(user.id, 'visa', due[0].cycleKey);
    assert.equal(selectDueReminders({ now: jun17 }).filter((r) => r.userId === user.id).length, 0);
    const jul18 = new Date(2026, 6, 18, 12).getTime();
    due = selectDueReminders({ now: jul18 }).filter((r) => r.userId === user.id);
    assert.equal(due.length, 1, 're-arms for the next statement cycle');
  } finally {
    db.prepare(`DELETE FROM debt_account_balances WHERE user_id = ?`).run(user.id);
    db.prepare(`DELETE FROM config WHERE user_id = ?`).run(user.id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
  }
});

test('nextDueDate clamps to short months', () => {
  const feb5 = new Date(2026, 1, 5).getTime();
  const due = nextDueDate(31, feb5);
  assert.equal(due.getMonth(), 1);
  assert.equal(due.getDate(), 28); // 2026 is not a leap year
});

// ── Account cleared celebration ───────────────────────────────────────────────

test('clearing a balance arms the celebration exactly once', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 3000,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 2000 },
        { id: 'med', name: 'Medical', balance: 1000 },
      ],
    });
    assert.equal(res.status, 200);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });

    // Pay the Visa to EXACTLY zero.
    res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 1000,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 0 },
        { id: 'med', name: 'Medical', balance: 1000 },
      ],
    });
    assert.equal(res.status, 200);

    let status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.equal(status.accountCleared.length, 1);
    assert.equal(status.accountCleared[0].name, 'Visa');
    assert.equal(status.accountCleared[0].startBalance, 2000);

    // Seen → cleared, and a later unrelated save must not re-arm it.
    res = await fetch(`${baseUrl}/api/config/account-cleared-seen`, { method: 'POST' });
    assert.equal(res.status, 200);
    status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.deepEqual(status.accountCleared, []);

    res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 900,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 0 },
        { id: 'med', name: 'Medical', balance: 900 },
      ],
    });
    assert.equal(res.status, 200);
    status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.deepEqual(status.accountCleared, [], 'an already-zero account is not "cleared" again');
  });
});

// ── Push subscription plumbing ────────────────────────────────────────────────

test('push: public key is a stable VAPID key; subscribe validates shape', async () => {
  await withApp(async (baseUrl) => {
    const k1 = await (await fetch(`${baseUrl}/api/push/public-key`)).json();
    assert.equal(k1.ok, true);
    assert.ok(typeof k1.publicKey === 'string' && k1.publicKey.length > 40);
    const k2 = await (await fetch(`${baseUrl}/api/push/public-key`)).json();
    assert.equal(k2.publicKey, k1.publicKey, 'key must be persisted, not regenerated');

    let res = await postJson(baseUrl, '/api/push/subscribe', { subscription: { endpoint: 'http://not-https', keys: {} } });
    assert.equal(res.status, 400);
    res = await postJson(baseUrl, '/api/push/subscribe', {
      subscription: { endpoint: 'https://push.example.com/sub/abc', keys: { p256dh: 'BExampleKey', auth: 'authsecret' } },
    });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/push/unsubscribe', { endpoint: 'https://push.example.com/sub/abc' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed, 1);
  });
});
