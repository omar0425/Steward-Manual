'use strict';

/**
 * Per-account origin pin (debt_account_first_balance) correctness.
 *
 * Regression: for accounts that predated the pin feature, the snapshot route
 * backfilled the pin from the CURRENT pull's balances — so every dollar paid
 * down before that deploy vanished from the "% paid" badge (accounts showed
 * 0% paid despite real paydown, with startingBalance == current balance).
 *
 * Two layers under test:
 *   1. Route seeding — a missing pin must seed from the account's earliest
 *      recorded history, falling back to the incoming balance only for
 *      genuinely new accounts (no history yet).
 *   2. Startup repair — pins already corrupted by the old backfill (pin
 *      matches a mid-history row, not the earliest) are re-pinned to the
 *      earliest surviving history balance, exactly once (app_meta flag).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const apiRouter = require('../routes/api');
const {
  withUser,
  resetAllGameState,
  setConfig,
  getDebtAccountFirstBalances,
} = require('../db');

const REPO_ROOT = path.join(__dirname, '..');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(baseUrl, urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  withUser(0, resetAllGameState);
});

test('snapshot: a missing origin pin re-seeds from earliest history, not the current pull', async () => {
  await withApp(async (baseUrl) => {
    // Two pulls build history at 1000 → 900.
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 1000 }],
    });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 900 }],
    });
    assert.equal(res.status, 200);

    // Simulate an account that predates the pin feature: history exists but
    // no pin was ever persisted.
    withUser(0, () => setConfig('debt_account_first_balance', '{}'));

    // The next pull must re-pin from the earliest history row (1000) — pinning
    // today's 800 would erase the paydown already on record.
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 800 }],
    });
    assert.equal(res.status, 200);

    const first = withUser(0, () => getDebtAccountFirstBalances());
    assert.equal(first.get('card-a'), 1000, 'pin re-seeded from earliest history');
  });
});

test('snapshot: a genuinely new account (no history) pins its first-seen balance', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-new', name: 'New Card', balance: 555 }],
    });
    assert.equal(res.status, 200);

    const first = withUser(0, () => getDebtAccountFirstBalances());
    assert.equal(first.get('card-new'), 555, 'new account pins the incoming balance');
  });
});

test('startup repair: mid-history origin pins re-pin to earliest surviving history, once', () => {
  const dbPath = path.join(os.tmpdir(), `steward-repin-${process.pid}-${Date.now()}.db`);
  const cleanup = () => {
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  };
  cleanup();

  const loadDbJs = () => {
    execFileSync(process.execPath, ['-e', "require('./db');"], {
      cwd: REPO_ROOT,
      env: { ...process.env, STEWARD_DB_PATH: dbPath, NODE_ENV: 'test' },
      stdio: 'pipe',
    });
  };
  const readPins = () => {
    const dbh = new DatabaseSync(dbPath);
    try {
      const row = dbh
        .prepare(`SELECT value FROM config WHERE user_id = 0 AND key = 'debt_account_first_balance'`)
        .get();
      const flag = dbh.prepare(`SELECT value FROM app_meta WHERE key = 'repin_first_balance_v1'`).get();
      return { pins: JSON.parse(row.value), flag };
    } finally {
      dbh.close();
    }
  };

  try {
    // Seed a current-schema DB directly (db.js not loaded yet, so the repair
    // hasn't run and the one-shot flag isn't set).
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE config (
        user_id INTEGER NOT NULL DEFAULT 0,
        key     TEXT    NOT NULL,
        value   TEXT    NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE debt_account_history (
        user_id         INTEGER NOT NULL DEFAULT 0,
        ynab_account_id TEXT NOT NULL,
        recorded_at     TEXT NOT NULL,
        balance         REAL NOT NULL,
        PRIMARY KEY (user_id, ynab_account_id, recorded_at)
      );
    `);
    const ins = seed.prepare(`INSERT INTO debt_account_history VALUES (0, ?, ?, ?)`);
    // Broken pin: matches the 2026-02-01 row, not the earliest → old backfill shape.
    ins.run('card-broken', '2026-01-01T00:00:00.000Z', 500);
    ins.run('card-broken', '2026-02-01T00:00:00.000Z', 400);
    ins.run('card-broken', '2026-03-01T00:00:00.000Z', 300);
    // Pruned origin: pin matches NO surviving row — its history was pruned, and
    // preserving exactly this is the pin's purpose. Must not be touched.
    ins.run('card-pruned', '2026-01-01T00:00:00.000Z', 600);
    ins.run('card-pruned', '2026-02-01T00:00:00.000Z', 550);
    // Healthy pin: equals the earliest surviving row.
    ins.run('card-ok', '2026-01-01T00:00:00.000Z', 700);
    ins.run('card-ok', '2026-02-01T00:00:00.000Z', 650);
    seed.prepare(`INSERT INTO config VALUES (0, 'debt_account_first_balance', ?)`)
      .run(JSON.stringify({ 'card-broken': 400, 'card-pruned': 800, 'card-ok': 700 }));
    seed.close();

    // First load runs the repair.
    loadDbJs();
    let { pins, flag } = readPins();
    assert.equal(pins['card-broken'], 500, 'mid-history pin re-pinned to earliest surviving balance');
    assert.equal(pins['card-pruned'], 800, 'pruned-origin pin untouched');
    assert.equal(pins['card-ok'], 700, 'healthy pin untouched');
    assert.ok(flag, 'one-shot flag recorded in app_meta');

    // Re-corrupt a pin and reload: the flag must make the repair a no-op.
    const again = new DatabaseSync(dbPath);
    again.prepare(`UPDATE config SET value = ? WHERE user_id = 0 AND key = 'debt_account_first_balance'`)
      .run(JSON.stringify({ 'card-broken': 400 }));
    again.close();
    loadDbJs();
    ({ pins } = readPins());
    assert.equal(pins['card-broken'], 400, 'repair does not run a second time');
  } finally {
    cleanup();
  }
});
