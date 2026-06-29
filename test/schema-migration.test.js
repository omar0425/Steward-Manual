'use strict';

/**
 * Schema-migration test: an OLD single-user database (no user_id columns, old
 * primary keys, no safety_liquid) must be upgraded in place by db.js's
 * migrations on first load, with all existing rows preserved under user_id=0.
 *
 * db.js runs its migrations once at module load against STEWARD_DB_PATH, so we
 * load it in a CHILD process pointed at a throwaway old-schema file, then reopen
 * that file here and assert the resulting schema + data.
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');

function pkOf(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .filter((c) => c.pk)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name)
    .join(',');
}
function columnsOf(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

test('schema migration: old single-user DB upgrades to user-scoped schema, data preserved', () => {
  const migPath = path.join(os.tmpdir(), `steward-migration-${process.pid}-${Date.now()}.db`);
  const cleanup = () => {
    for (const f of [migPath, `${migPath}-wal`, `${migPath}-shm`]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  };
  cleanup(); // ensure a clean slate

  try {
    // ── 1. Build the OLD schema (pre multi-user, pre safety_liquid) + seed rows.
    const old = new DatabaseSync(migPath);
    old.exec(`
      CREATE TABLE debt_account_balances (
        ynab_account_id TEXT PRIMARY KEY,
        last_balance    REAL NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE TABLE debt_account_history (
        ynab_account_id TEXT NOT NULL,
        recorded_at     TEXT NOT NULL,
        balance         REAL NOT NULL,
        PRIMARY KEY (ynab_account_id, recorded_at)
      );
      CREATE TABLE snapshots (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        source           TEXT NOT NULL,
        pulled_at        TEXT NOT NULL,
        net_worth        REAL NOT NULL DEFAULT 0,
        total_assets     REAL NOT NULL DEFAULT 0,
        total_debt       REAL NOT NULL DEFAULT 0,
        investment_value REAL NOT NULL DEFAULT 0,
        debt_remaining   REAL NOT NULL DEFAULT 0,
        months_ahead     REAL,
        monthly_income   REAL NOT NULL DEFAULT 0,
        monthly_expenses REAL NOT NULL DEFAULT 0,
        tier             TEXT NOT NULL DEFAULT 'rock_bottom'
      );
      CREATE TABLE config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    old.prepare(`INSERT INTO debt_account_balances VALUES (?, ?, ?)`).run('chase', 1234.56, '2026-01-01T00:00:00.000Z');
    old.prepare(`INSERT INTO debt_account_history VALUES (?, ?, ?)`).run('chase', '2026-01-01T00:00:00.000Z', 1234.56);
    old.prepare(
      `INSERT INTO snapshots (source, pulled_at, debt_remaining, total_debt) VALUES (?, ?, ?, ?)`,
    ).run('manual', '2026-01-01T00:00:00.000Z', 1234.56, 1234.56);
    old.prepare(`INSERT INTO config (key, value) VALUES (?, ?)`).run('debt_start', '5000');
    old.close();

    // Sanity: confirm the pre-migration schema really is the old shape.
    {
      const pre = new DatabaseSync(migPath);
      assert.strictEqual(pkOf(pre, 'debt_account_balances'), 'ynab_account_id', 'precondition: old balances PK');
      assert.strictEqual(pkOf(pre, 'config'), 'key', 'precondition: old config PK');
      assert.ok(!columnsOf(pre, 'snapshots').has('user_id'), 'precondition: snapshots has no user_id');
      assert.ok(!columnsOf(pre, 'snapshots').has('safety_liquid'), 'precondition: snapshots has no safety_liquid');
      pre.close();
    }

    // ── 2. Load db.js against the old file in a child → runs migrations on load.
    execFileSync(process.execPath, ['-e', "require('./db');"], {
      cwd: REPO_ROOT,
      env: { ...process.env, STEWARD_DB_PATH: migPath, NODE_ENV: 'test' },
      stdio: 'pipe',
    });

    // ── 3. Reopen and assert the upgraded schema + preserved data.
    const db = new DatabaseSync(migPath);
    try {
      assert.strictEqual(pkOf(db, 'debt_account_balances'), 'user_id,ynab_account_id', 'balances PK migrated');
      assert.strictEqual(pkOf(db, 'debt_account_history'), 'user_id,ynab_account_id,recorded_at', 'history PK migrated');
      assert.strictEqual(pkOf(db, 'config'), 'user_id,key', 'config PK migrated');

      const snapCols = columnsOf(db, 'snapshots');
      assert.ok(snapCols.has('user_id'), 'snapshots gained user_id');
      assert.ok(snapCols.has('safety_liquid'), 'snapshots gained safety_liquid');

      // Data preserved, scoped to user_id = 0.
      const bal = db.prepare(`SELECT * FROM debt_account_balances WHERE ynab_account_id = 'chase'`).get();
      assert.ok(bal, 'balance row survived');
      assert.strictEqual(bal.user_id, 0, 'balance row scoped to user 0');
      assert.strictEqual(bal.last_balance, 1234.56, 'balance value preserved');

      const hist = db.prepare(`SELECT * FROM debt_account_history WHERE ynab_account_id = 'chase'`).get();
      assert.ok(hist, 'history row survived');
      assert.strictEqual(hist.user_id, 0, 'history row scoped to user 0');

      const snap = db.prepare(`SELECT * FROM snapshots`).get();
      assert.strictEqual(snap.user_id, 0, 'snapshot row scoped to user 0');
      assert.strictEqual(snap.debt_remaining, 1234.56, 'snapshot debt preserved');
      assert.strictEqual(snap.safety_liquid, null, 'safety_liquid null for legacy row');

      const cfg = db.prepare(`SELECT * FROM config WHERE key = 'debt_start'`).get();
      assert.ok(cfg, 'config row survived');
      assert.strictEqual(cfg.user_id, 0, 'config row scoped to user 0');
      assert.strictEqual(cfg.value, '5000', 'config value preserved');
    } finally {
      db.close();
    }
  } finally {
    cleanup();
  }
});
