'use strict';

/**
 * Database guards: the live-DB integrity probe, the pre-destruction safety
 * snapshot (creation, VACUUM-consistency, rotation), and the destructive
 * routes actually writing one before they mutate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const apiRouter = require('../routes/api');
const {
  withUser, resetAllGameState, checkLiveDbIntegrity, safetySnapshot, setConfig,
} = require('../db');

const BACKUP_DIR = path.join(path.dirname(path.resolve(process.env.STEWARD_DB_PATH)), 'backups');

function safetyFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('steward-pre-')).sort();
  } catch { return []; }
}

function wipeSafetyFiles() {
  for (const f of safetyFiles()) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

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
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

test.beforeEach(() => {
  withUser(0, resetAllGameState);
  wipeSafetyFiles();
});

test('guards: the live DB passes the boot integrity probe', () => {
  const integ = checkLiveDbIntegrity();
  assert.equal(integ.ok, true, `quick_check verdict: ${integ.verdict}`);
  assert.equal(integ.verdict, 'ok');
});

test('guards: safetySnapshot writes a consistent, openable copy', () => {
  withUser(0, () => setConfig('guard_test_marker', 'present-before-destruction'));
  const dest = safetySnapshot('unit');
  assert.ok(dest, 'snapshot path returned');
  assert.ok(fs.existsSync(dest), 'snapshot file exists');
  // The copy opens, verifies, and contains the pre-destruction data.
  const copy = new DatabaseSync(dest);
  try {
    const integ = copy.prepare('PRAGMA integrity_check').get();
    assert.equal(String(Object.values(integ)[0]), 'ok', 'snapshot passes integrity_check');
    const row = copy.prepare(`SELECT value FROM config WHERE key = 'guard_test_marker'`).get();
    assert.equal(row.value, 'present-before-destruction');
  } finally {
    copy.close();
  }
});

test('guards: safety snapshots rotate — newest 5 kept', () => {
  for (let i = 0; i < 7; i++) safetySnapshot(`rot${i}`);
  const files = safetyFiles();
  assert.equal(files.length, 5, `kept: ${files.join(', ')}`);
  // The oldest two (rot0, rot1) fell off.
  assert.ok(!files.some((f) => f.includes('-rot0-')), 'rot0 rotated out');
  assert.ok(!files.some((f) => f.includes('-rot1-')), 'rot1 rotated out');
  assert.ok(files.some((f) => f.includes('-rot6-')), 'newest kept');
});

test('guards: reset-game writes a pre-destruction snapshot before wiping', async () => {
  await withApp(async (baseUrl) => {
    withUser(0, () => setConfig('guard_test_marker', 'reset-me'));
    const res = await fetch(`${baseUrl}/api/reset-game`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(res.status, 200);
    const files = safetyFiles().filter((f) => f.includes('-reset-'));
    assert.equal(files.length, 1, 'one pre-reset snapshot written');
    // The snapshot holds the data the reset just destroyed.
    const copy = new DatabaseSync(path.join(BACKUP_DIR, files[0]));
    try {
      const row = copy.prepare(`SELECT value FROM config WHERE key = 'guard_test_marker'`).get();
      assert.equal(row.value, 'reset-me', 'pre-reset data recoverable from the snapshot');
    } finally { copy.close(); }
  });
});

test('guards: restore writes a pre-destruction snapshot before replacing data', async () => {
  await withApp(async (baseUrl) => {
    // Existing data that a wrong-file restore would obliterate.
    let res = await fetch(`${baseUrl}/api/snapshot`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 1000 }] }),
    });
    assert.equal(res.status, 200);
    // Minimal valid restore payload (force — it replaces the data above).
    res = await fetch(`${baseUrl}/api/restore?force=1`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshots: [], debtAccountBalances: [], debtAccountHistory: [], settings: {} }),
    });
    assert.equal(res.status, 200, await res.text());
    const files = safetyFiles().filter((f) => f.includes('-restore-'));
    assert.equal(files.length, 1, 'one pre-restore snapshot written');
    const copy = new DatabaseSync(path.join(BACKUP_DIR, files[0]));
    try {
      const row = copy.prepare(
        `SELECT last_balance FROM debt_account_balances WHERE ynab_account_id = 'card-a'`,
      ).get();
      assert.equal(row.last_balance, 1000, 'pre-restore balance recoverable from the snapshot');
    } finally { copy.close(); }
  });
});
