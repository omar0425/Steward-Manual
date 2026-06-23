'use strict';

/**
 * Import/restore + admin tooling, against an isolated DB file. `zzz`-style early
 * env setup so the right DB is used before any module binds to it.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `steward-admin-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;
process.env.ADMIN_TOKEN = 'test-admin-token';

for (const m of ['../db', '../db-auth', '../services/climbMetrics', '../routes/admin']) {
  delete require.cache[require.resolve(m)];
}

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../db');
const dbAuth = require('../db-auth');
const { recomputeTotalsFromHistory } = require('../services/climbMetrics');
const adminRouter = require('../routes/admin');

test.after(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${tmpDb}${ext}`); } catch (_) { /* ignore */ }
  }
});

function startAdminApp() {
  const app = express();
  app.use('/admin/api', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}
async function withAdminApp(fn) {
  const { server, baseUrl } = await startAdminApp();
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}
const AUTH = { 'x-admin-token': 'test-admin-token' };

// ── Pure recompute ────────────────────────────────────────────────────────────

test('recomputeTotalsFromHistory: replays diffs from the game-start anchor', () => {
  const history = [
    { accountId: 'a', recordedAt: '2025-12-01T00:00:00Z', balance: 1000 }, // pre-game, ignored
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 1000 }, // anchor
    { accountId: 'b', recordedAt: '2026-01-01T00:00:00Z', balance: 500 },
    { accountId: 'a', recordedAt: '2026-02-01T00:00:00Z', balance: 800 },  // -200 paydown
    { accountId: 'b', recordedAt: '2026-02-01T00:00:00Z', balance: 500 },
    { accountId: 'a', recordedAt: '2026-03-01T00:00:00Z', balance: 800 },
    { accountId: 'b', recordedAt: '2026-03-01T00:00:00Z', balance: 700 },  // +200 new debt
    { accountId: 'c', recordedAt: '2026-03-01T00:00:00Z', balance: 300 },  // new account → +300
  ];
  const r = recomputeTotalsFromHistory(history, '2026-01-01T00:00:00Z');
  assert.equal(r.cumulativePaidDown, 200);
  assert.equal(r.cumulativeNewDebtAdded, 500);
  assert.equal(r.anchorAt, '2026-01-01T00:00:00Z');
  assert.equal(r.pullsReplayed, 2);
});

test('recomputeTotalsFromHistory: empty history is zero, not a crash', () => {
  const r = recomputeTotalsFromHistory([], '2026-01-01T00:00:00Z');
  assert.deepEqual(
    { p: r.cumulativePaidDown, n: r.cumulativeNewDebtAdded, pulls: r.pullsReplayed },
    { p: 0, n: 0, pulls: 0 },
  );
});

// ── isValidImportPayload ───────────────────────────────────────────────────────

test('isValidImportPayload: rejects junk, accepts a real export shape', () => {
  assert.equal(db.isValidImportPayload(null).ok, false);
  assert.equal(db.isValidImportPayload({}).ok, false);
  assert.equal(db.isValidImportPayload({ snapshots: [] }).ok, false);
  assert.equal(db.isValidImportPayload({ snapshots: [], debtAccountBalances: [] }).ok, true);
});

// ── importUserData round-trips and stays scoped to the user ─────────────────────

test('importUserData rebuilds a user and never bleeds into another user', () => {
  const alice = dbAuth.createLocalUser('alice', 'pw-aaaaaa', 'alice@example.com');
  const bob = dbAuth.createLocalUser('bob', 'pw-bbbbbb', 'bob@example.com');

  // Seed Alice with a small climb.
  db.withUser(alice.id, () => {
    db.insertSnapshot({
      source: 'manual', pulled_at: '2026-05-01T00:00:00Z', net_worth: -1000,
      total_assets: 0, total_debt: 1000, investment_value: 0, debt_remaining: 1000,
      months_ahead: null, monthly_income: 0, monthly_expenses: 0, tier: 'rock_bottom', safety_liquid: 0,
    });
    db.replaceDebtAccountBalances(new Map([['card', 1000]]));
    db.appendDebtAccountHistory(new Map([['card', 1000]]));
    db.setConfig('climb_baseline_debt', '1200');
    db.setConfig('cumulative_paid_down', '200');
  });

  const aliceExport = db.withUser(alice.id, () => db.exportUserData());
  assert.equal(aliceExport.snapshots.length, 1);

  // Restore Alice's export INTO Bob — Bob should now mirror Alice; Alice untouched.
  const counts = db.withUser(bob.id, () => db.importUserData(aliceExport));
  assert.equal(counts.snapshots, 1);
  assert.equal(counts.balances, 1);

  const bobExport = db.withUser(bob.id, () => db.exportUserData());
  assert.equal(bobExport.snapshots.length, 1);
  assert.equal(bobExport.debtAccountBalances[0].balance, 1000);
  assert.equal(bobExport.settings.climb_baseline_debt, '1200');
  // Alice still intact.
  const aliceAfter = db.withUser(alice.id, () => db.exportUserData());
  assert.equal(aliceAfter.snapshots.length, 1);
  // The undo stack is never restored (its snapshot ids would be stale).
  assert.equal(bobExport.settings.climb_undo_stack, undefined);
});

// ── Admin HTTP surface ──────────────────────────────────────────────────────────

test('admin API: token required', async () => {
  await withAdminApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/api/users`);
    assert.equal(res.status, 403);
    const ok = await fetch(`${baseUrl}/admin/api/users`, { headers: AUTH });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(Array.isArray(body.users));
  });
});

test('admin API: export / restore / recompute one user', async () => {
  const carol = dbAuth.createLocalUser('carol', 'pw-cccccc', 'carol@example.com');
  db.withUser(carol.id, () => {
    db.setConfig('game_start_at', '2026-01-01T00:00:00Z');
    db.appendDebtAccountHistory(new Map([['x', 1000]]));
    db.setConfig('cumulative_paid_down', '999'); // deliberately wrong
    db.setConfig('cumulative_new_debt_added', '999');
  });

  await withAdminApp(async (baseUrl) => {
    // export
    let res = await fetch(`${baseUrl}/admin/api/users/${carol.id}/export`, { headers: AUTH });
    assert.equal(res.status, 200);
    const exp = await res.json();
    assert.equal(exp.user.username, 'carol');

    // recompute dry-run does NOT write
    res = await fetch(`${baseUrl}/admin/api/users/${carol.id}/recompute`, { method: 'POST', headers: AUTH });
    let body = await res.json();
    assert.equal(body.applied, false);
    assert.equal(body.before.cumulativePaidDown, 999);
    const stillWrong = db.withUser(carol.id, () => db.getConfig('cumulative_paid_down'));
    assert.equal(stillWrong, '999', 'dry-run left the bad value in place');

    // recompute apply writes the rebuilt totals (single pull → no deltas → 0)
    res = await fetch(`${baseUrl}/admin/api/users/${carol.id}/recompute?apply=1`, { method: 'POST', headers: AUTH });
    body = await res.json();
    assert.equal(body.applied, true);
    const fixed = db.withUser(carol.id, () => db.getConfig('cumulative_paid_down'));
    assert.equal(fixed, '0', 'applied recompute corrected the total');

    // unknown user → 404
    res = await fetch(`${baseUrl}/admin/api/users/99999/export`, { headers: AUTH });
    assert.equal(res.status, 404);
  });
});
