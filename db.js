'use strict';

// Node 24 ships node:sqlite as a stable built-in — no native compilation needed.
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('path');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');
const db = new DatabaseSync(DB_PATH);
const userScope = new AsyncLocalStorage();

function currentUserId() {
  const id = Number(userScope.getStore());
  if (Number.isInteger(id) && id > 0) return id;
  // Outside a withUser() context — all queries fall back to user_id=0.
  // This is intentional during startup/schema init; unexpected during API requests.
  if (typeof userScope.getStore() !== 'undefined') {
    console.warn('[db] currentUserId: active scope has non-positive id (' + userScope.getStore() + ') — using 0');
  }
  return 0;
}

function withUser(userId, fn) {
  const id = Number(userId);
  return userScope.run(Number.isInteger(id) && id > 0 ? id : 0, fn);
}

// WAL mode + foreign keys via exec (node:sqlite has no .pragma() shorthand)
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Schema ────────────────────────────────────────────────────────────────────
// Migration: safety-relevant liquid column; older rows NULL
const _snapshotsExists = db
  .prepare(
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'snapshots' LIMIT 1`,
  )
  .get();
if (_snapshotsExists) {
  const _snapCols = db.prepare(`PRAGMA table_info(snapshots)`).all();
  if (!_snapCols.some((c) => c.name === 'safety_liquid')) {
    db.exec(`ALTER TABLE snapshots ADD COLUMN safety_liquid REAL`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS debt_account_balances (
    user_id         INTEGER NOT NULL DEFAULT 0,
    ynab_account_id TEXT NOT NULL,
    last_balance    REAL    NOT NULL,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (user_id, ynab_account_id)
  );

  CREATE TABLE IF NOT EXISTS debt_account_history (
    user_id         INTEGER NOT NULL DEFAULT 0,
    ynab_account_id TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    balance         REAL NOT NULL,
    PRIMARY KEY (user_id, ynab_account_id, recorded_at)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL DEFAULT 0,
    source           TEXT    NOT NULL,
    pulled_at        TEXT    NOT NULL,
    net_worth        REAL    NOT NULL DEFAULT 0,
    total_assets     REAL    NOT NULL DEFAULT 0,
    safety_liquid    REAL,
    total_debt       REAL    NOT NULL DEFAULT 0,
    investment_value REAL    NOT NULL DEFAULT 0,
    debt_remaining   REAL    NOT NULL DEFAULT 0,
    months_ahead     REAL,
    monthly_income   REAL    NOT NULL DEFAULT 0,
    monthly_expenses REAL    NOT NULL DEFAULT 0,
    tier             TEXT    NOT NULL DEFAULT 'rock_bottom'
  );

  CREATE TABLE IF NOT EXISTS config (
    user_id INTEGER NOT NULL DEFAULT 0,
    key   TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function ensureUserScopedTables() {
  const balanceCols = tableColumns('debt_account_balances');
  const balancePk = balanceCols.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name).join(',');
  if (balancePk !== 'user_id,ynab_account_id') {
    db.exec(`
      ALTER TABLE debt_account_balances RENAME TO debt_account_balances_old;
      CREATE TABLE debt_account_balances (
        user_id         INTEGER NOT NULL DEFAULT 0,
        ynab_account_id TEXT NOT NULL,
        last_balance    REAL    NOT NULL,
        updated_at      TEXT    NOT NULL,
        PRIMARY KEY (user_id, ynab_account_id)
      );
      INSERT OR IGNORE INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at)
      SELECT 0, ynab_account_id, last_balance, updated_at FROM debt_account_balances_old;
      DROP TABLE debt_account_balances_old;
    `);
  }

  const historyCols = tableColumns('debt_account_history');
  const historyPk = historyCols.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name).join(',');
  if (historyPk !== 'user_id,ynab_account_id,recorded_at') {
    db.exec(`
      ALTER TABLE debt_account_history RENAME TO debt_account_history_old;
      CREATE TABLE debt_account_history (
        user_id         INTEGER NOT NULL DEFAULT 0,
        ynab_account_id TEXT NOT NULL,
        recorded_at     TEXT NOT NULL,
        balance         REAL NOT NULL,
        PRIMARY KEY (user_id, ynab_account_id, recorded_at)
      );
      INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
      SELECT 0, ynab_account_id, recorded_at, balance FROM debt_account_history_old;
      DROP TABLE debt_account_history_old;
    `);
  }

  const snapshotCols = tableColumns('snapshots');
  if (!snapshotCols.some(c => c.name === 'user_id')) {
    db.exec(`ALTER TABLE snapshots ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
  }

  const configCols = tableColumns('config');
  const configPk = configCols.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name).join(',');
  if (configPk !== 'user_id,key') {
    db.exec(`
      ALTER TABLE config RENAME TO config_old;
      CREATE TABLE config (
        user_id INTEGER NOT NULL DEFAULT 0,
        key     TEXT    NOT NULL,
        value   TEXT    NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT OR IGNORE INTO config (user_id, key, value)
      SELECT 0, key, value FROM config_old;
      DROP TABLE config_old;
    `);
  }
}

ensureUserScopedTables();

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const INSERT_SNAPSHOT = db.prepare(`
  INSERT INTO snapshots
    (user_id, source, pulled_at, net_worth, total_assets, total_debt,
     investment_value, debt_remaining, months_ahead,
     monthly_income, monthly_expenses, tier, safety_liquid)
  VALUES
    (:user_id, :source, :pulled_at, :net_worth, :total_assets, :total_debt,
     :investment_value, :debt_remaining, :months_ahead,
     :monthly_income, :monthly_expenses, :tier, :safety_liquid)
`);

const PRUNE_SNAPSHOTS = db.prepare(`
  DELETE FROM snapshots
  WHERE user_id = ? AND source = ? AND id NOT IN (
    SELECT id FROM snapshots WHERE user_id = ? AND source = ? ORDER BY pulled_at DESC LIMIT 60
  )
`);

function insertSnapshot(data) {
  const row = { ...data, user_id: currentUserId() };
  const info = INSERT_SNAPSHOT.run(row);
  PRUNE_SNAPSHOTS.run(row.user_id, data.source, row.user_id, data.source);
  return info.lastInsertRowid;
}

function latestSnapshot(source) {
  const userId = currentUserId();
  if (source) {
    return db.prepare(
      `SELECT * FROM snapshots WHERE user_id = ? AND source = ? ORDER BY pulled_at DESC LIMIT 1`
    ).get(userId, source) || null;
  }
  return db.prepare(
    `SELECT * FROM snapshots WHERE user_id = ? ORDER BY pulled_at DESC LIMIT 1`
  ).get(userId) || null;
}

function latestCombined() {
  const snap = latestSnapshot();
  if (!snap) return null;
  return snap;
}

function recentSnapshots(limit = 60) {
  return db.prepare(
    `SELECT * FROM snapshots WHERE user_id = ? ORDER BY pulled_at DESC LIMIT ?`
  ).all(currentUserId(), limit);
}

// ── Per-account debt (liability balances, magnitude in dollars) ─────────────
// Used to diff climb metrics without treating removed accounts as paydown.

function getAllDebtAccountBalances() {
  const rows = db
    .prepare(`SELECT ynab_account_id, last_balance FROM debt_account_balances WHERE user_id = ?`)
    .all(currentUserId());
  const m = new Map();
  for (const r of rows) {
    const bal = Number(r.last_balance);
    if (Number.isFinite(bal) && bal >= 0) {
      m.set(String(r.ynab_account_id), Math.round(bal * 100) / 100);
    }
  }
  return m;
}

/**
 * Replace stored balances with the current pull (full snapshot of debt accounts).
 * @param {Map<string, number>} balanceByAccountId
 */
function replaceDebtAccountBalances(balanceByAccountId) {
  const now = new Date().toISOString();
  const userId = currentUserId();
  const del = db.prepare(`DELETE FROM debt_account_balances WHERE user_id = ?`);
  const ins = db.prepare(`
    INSERT INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    del.run(userId);
    for (const [id, bal] of balanceByAccountId) {
      const b = Math.round(Number(bal) * 100) / 100;
      if (!Number.isFinite(b) || b < 0) continue;
      ins.run(userId, String(id), b, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── Per-account balance history (spark lines, last 30 entries per account) ───

function appendDebtAccountHistory(balanceMap) {
  const now = new Date().toISOString();
  const userId = currentUserId();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
    VALUES (?, ?, ?, ?)
  `);
  const prune = db.prepare(`
    DELETE FROM debt_account_history
    WHERE user_id = ? AND ynab_account_id = ? AND recorded_at NOT IN (
      SELECT recorded_at FROM debt_account_history
      WHERE user_id = ? AND ynab_account_id = ? ORDER BY recorded_at DESC LIMIT 30
    )
  `);
  db.exec('BEGIN');
  try {
    for (const [id, bal] of balanceMap) {
      ins.run(userId, String(id), now, Math.round(Number(bal) * 100) / 100);
      prune.run(userId, String(id), userId, String(id));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getDebtAccountHistory(daysBack = 30) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT ynab_account_id, recorded_at, balance
    FROM debt_account_history
    WHERE user_id = ? AND recorded_at >= ?
    ORDER BY ynab_account_id, recorded_at ASC
  `).all(currentUserId(), since);
  const byAccount = {};
  for (const r of rows) {
    if (!byAccount[r.ynab_account_id]) byAccount[r.ynab_account_id] = [];
    byAccount[r.ynab_account_id].push({ date: r.recorded_at, balance: Number(r.balance) });
  }
  return byAccount;
}

// ── Turn-start snapshot (7-day rolling window for display deltas) ─────────────

const TURN_START_AT_KEY      = 'turn_start_at';
const TURN_START_BAL_KEY     = 'turn_start_balances';
const TURN_DURATION_MS       = 5 * 24 * 60 * 60 * 1000;

function getTurnStart() {
  const userId = currentUserId();
  const at  = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`).get(userId, TURN_START_AT_KEY);
  const raw = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`).get(userId, TURN_START_BAL_KEY);
  const balances = new Map();
  if (raw && raw.value) {
    try {
      const obj = JSON.parse(raw.value);
      for (const [id, bal] of Object.entries(obj)) {
        const b = Number(bal);
        if (Number.isFinite(b) && b >= 0) balances.set(String(id), b);
      }
    } catch { /* ignore */ }
  }
  return { turnStartAt: at ? at.value : null, turnStartBalances: balances };
}

function setTurnStart(at, balanceMap) {
  const userId = currentUserId();
  const obj = {};
  for (const [id, bal] of balanceMap) {
    obj[String(id)] = Math.round(Number(bal) * 100) / 100;
  }
  db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`).run(userId, TURN_START_AT_KEY, at);
  db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`).run(userId, TURN_START_BAL_KEY, JSON.stringify(obj));
}

// ── Game-start snapshot (write-once, seeded from first snapshot) ──────────────

const GAME_START_DEBT_KEY = 'game_start_debt';
const GAME_START_AT_KEY   = 'game_start_at';

function getGameStart() {
  const debt = getConfig(GAME_START_DEBT_KEY);
  const at   = getConfig(GAME_START_AT_KEY);
  return {
    gameStartDebt: debt != null ? Number(debt) : null,
    gameStartAt:   at   || null,
  };
}

/**
 * Lock in game start from the user's explicit "I'm in" action.
 * Sets the baseline debt + resets all climb counters to zero.
 * Called from POST /api/start-game. The current debt account balances are kept
 * as the starting inventory for future deltas.
 */
function initGameState(debtRemaining, pulledAt) {
  const userId = currentUserId();
  const debt = String(Math.round(Number(debtRemaining) * 100) / 100);
  const at   = String(pulledAt);
  const upsert = db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`);
  const del    = db.prepare(`DELETE FROM config WHERE user_id = ? AND key = ?`);
  const KEYS_TO_CLEAR = [
    'turn_start_at',
    'turn_start_balances',
    'notifications_sent',
  ];
  db.exec('BEGIN');
  try {
    upsert.run(userId, GAME_START_DEBT_KEY,  debt);
    upsert.run(userId, GAME_START_AT_KEY,    at);
    upsert.run(userId, 'climb_baseline_debt', debt);
    upsert.run(userId, 'debt_start',          debt);
    upsert.run(userId, 'cumulative_paid_down',       '0');
    upsert.run(userId, 'cumulative_new_debt_added',  '0');
    upsert.run(userId, 'last_aggregate_debt_for_climb', debt);
    upsert.run(userId, 'climb_per_account_map_seeded', '1');
    for (const key of KEYS_TO_CLEAR) del.run(userId, key);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
      SELECT user_id, ynab_account_id, ?, last_balance FROM debt_account_balances WHERE user_id = ?
    `).run(at, userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare(`SELECT value FROM config WHERE user_id = ? AND key = ?`).get(currentUserId(), key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`).run(currentUserId(), key, String(value));
}

function setConfigIfAbsent(key, value) {
  db.prepare(`INSERT OR IGNORE INTO config (user_id, key, value) VALUES (?, ?, ?)`).run(currentUserId(), key, String(value));
  return getConfig(key);
}

/** All snapshot rows (net worth history, last pull pointers). */
function deleteAllSnapshots() {
  return db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(currentUserId());
}

/**
 * Full game reset — clears all DB-backed gameplay history so the next
 * snapshot starts a clean game.
 *
 * CLEARS: snapshots, debt account history/balances, and all config keys that
 * encode game state (baseline, paid-down counter, turn window, game-start,
 * climb metrics, notifications, debug cache).
 *
 * Preserves user preferences: interest_rates, steward-theme (localStorage, not DB).
 */
function resetAllGameState() {
  const userId = currentUserId();
  const GAME_STATE_KEYS = [
    'climb_baseline_debt',
    'climb_per_account_map_seeded',
    'cumulative_new_debt_added',
    'cumulative_paid_down',
    'debt_start',
    'game_start_at',
    'game_start_debt',
    'last_aggregate_debt_for_climb',
    'last_debt_sync_debug_snapshot_v1',
    'notifications_sent',
    'turn_start_at',
    'turn_start_balances',

  ];
  const del = db.prepare(`DELETE FROM config WHERE user_id = ? AND key = ?`);
  db.exec('BEGIN');
  try {
    for (const key of GAME_STATE_KEYS) del.run(userId, key);
    db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_balances WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function lastNonZeroFinancials() {
  const userId = currentUserId();
  const row = db.prepare(`
    SELECT monthly_income, monthly_expenses, total_assets, investment_value
    FROM snapshots
    WHERE user_id = ? AND (monthly_income > 0 OR monthly_expenses > 0 OR total_assets > 0)
    ORDER BY pulled_at DESC LIMIT 1
  `).get(userId);
  return row || null;
}

module.exports = {
  db,
  withUser,
  currentUserId,
  insertSnapshot,
  latestSnapshot,
  latestCombined,
  recentSnapshots,
  deleteAllSnapshots,
  resetAllGameState,
  getAllDebtAccountBalances,
  replaceDebtAccountBalances,
  getConfig,
  setConfig,
  setConfigIfAbsent,
  getTurnStart,
  setTurnStart,
  TURN_DURATION_MS,
  appendDebtAccountHistory,
  getDebtAccountHistory,
  getGameStart,
  initGameState,
  lastNonZeroFinancials,
};
