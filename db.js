'use strict';

// Node 24 ships node:sqlite as a stable built-in — no native compilation needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');
const db = new DatabaseSync(DB_PATH);

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
    ynab_account_id TEXT PRIMARY KEY,
    last_balance    REAL    NOT NULL,
    updated_at      TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debt_account_history (
    ynab_account_id TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    balance         REAL NOT NULL,
    PRIMARY KEY (ynab_account_id, recorded_at)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
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
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const INSERT_SNAPSHOT = db.prepare(`
  INSERT INTO snapshots
    (source, pulled_at, net_worth, total_assets, total_debt,
     investment_value, debt_remaining, months_ahead,
     monthly_income, monthly_expenses, tier, safety_liquid)
  VALUES
    (:source, :pulled_at, :net_worth, :total_assets, :total_debt,
     :investment_value, :debt_remaining, :months_ahead,
     :monthly_income, :monthly_expenses, :tier, :safety_liquid)
`);

const PRUNE_SNAPSHOTS = db.prepare(`
  DELETE FROM snapshots
  WHERE source = ? AND id NOT IN (
    SELECT id FROM snapshots WHERE source = ? ORDER BY pulled_at DESC LIMIT 60
  )
`);

function insertSnapshot(data) {
  const info = INSERT_SNAPSHOT.run(data);
  PRUNE_SNAPSHOTS.run(data.source, data.source);
  return info.lastInsertRowid;
}

function latestSnapshot(source) {
  if (source) {
    return db.prepare(
      `SELECT * FROM snapshots WHERE source = ? ORDER BY pulled_at DESC LIMIT 1`
    ).get(source) || null;
  }
  return db.prepare(
    `SELECT * FROM snapshots ORDER BY pulled_at DESC LIMIT 1`
  ).get() || null;
}

function latestCombined() {
  const snap = latestSnapshot();
  if (!snap) return null;
  return snap;
}

function recentSnapshots(limit = 60) {
  return db.prepare(
    `SELECT * FROM snapshots ORDER BY pulled_at DESC LIMIT ?`
  ).all(limit);
}

// ── Per-account debt (liability balances, magnitude in dollars) ─────────────
// Used to diff climb metrics without treating removed accounts as paydown.

function getAllDebtAccountBalances() {
  const rows = db
    .prepare(`SELECT ynab_account_id, last_balance FROM debt_account_balances`)
    .all();
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
  const del = db.prepare(`DELETE FROM debt_account_balances`);
  const ins = db.prepare(`
    INSERT INTO debt_account_balances (ynab_account_id, last_balance, updated_at)
    VALUES (?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    del.run();
    for (const [id, bal] of balanceByAccountId) {
      const b = Math.round(Number(bal) * 100) / 100;
      if (!Number.isFinite(b) || b < 0) continue;
      ins.run(String(id), b, now);
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
  const ins = db.prepare(`
    INSERT OR IGNORE INTO debt_account_history (ynab_account_id, recorded_at, balance)
    VALUES (?, ?, ?)
  `);
  const prune = db.prepare(`
    DELETE FROM debt_account_history
    WHERE ynab_account_id = ? AND recorded_at NOT IN (
      SELECT recorded_at FROM debt_account_history
      WHERE ynab_account_id = ? ORDER BY recorded_at DESC LIMIT 30
    )
  `);
  db.exec('BEGIN');
  try {
    for (const [id, bal] of balanceMap) {
      ins.run(String(id), now, Math.round(Number(bal) * 100) / 100);
      prune.run(String(id), String(id));
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
    WHERE recorded_at >= ?
    ORDER BY ynab_account_id, recorded_at ASC
  `).all(since);
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
  const at  = db.prepare(`SELECT value FROM config WHERE key = ?`).get(TURN_START_AT_KEY);
  const raw = db.prepare(`SELECT value FROM config WHERE key = ?`).get(TURN_START_BAL_KEY);
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
  const obj = {};
  for (const [id, bal] of balanceMap) {
    obj[String(id)] = Math.round(Number(bal) * 100) / 100;
  }
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(TURN_START_AT_KEY, at);
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(TURN_START_BAL_KEY, JSON.stringify(obj));
}

// ── Game-start snapshot (write-once, seeded from first snapshot) ──────────────

const GAME_START_DEBT_KEY = 'game_start_debt';
const GAME_START_AT_KEY   = 'game_start_at';

/**
 * Record the very first total debt and date — never overwrites.
 * Call this on every pull; INSERT OR IGNORE makes it a no-op after the first time.
 */
function setGameStartIfAbsent(debtRemaining, pulledAt) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`);
  stmt.run(GAME_START_DEBT_KEY, String(Math.round(Number(debtRemaining) * 100) / 100));
  stmt.run(GAME_START_AT_KEY, String(pulledAt));
}

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
 * Called once from POST /api/start-game — never called automatically.
 */
function initGameState(debtRemaining, pulledAt) {
  const debt = String(Math.round(Number(debtRemaining) * 100) / 100);
  const at   = String(pulledAt);
  const upsert = db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`);
  const del    = db.prepare(`DELETE FROM config WHERE key = ?`);
  const KEYS_TO_CLEAR = [
    'last_aggregate_debt_for_climb',
    'climb_per_account_map_seeded',
    'turn_start_at',
    'turn_start_balances',
    'notifications_sent',
    'last_debt_sync_debug_snapshot_v1',
  ];
  db.exec('BEGIN');
  try {
    upsert.run(GAME_START_DEBT_KEY,  debt);
    upsert.run(GAME_START_AT_KEY,    at);
    upsert.run('climb_baseline_debt', debt);
    upsert.run('debt_start',          debt);
    upsert.run('cumulative_paid_down',       '0');
    upsert.run('cumulative_new_debt_added',  '0');
    for (const key of KEYS_TO_CLEAR) del.run(key);
    db.prepare('DELETE FROM debt_account_balances').run();
    db.prepare('DELETE FROM debt_account_history').run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(key, String(value));
}

function setConfigIfAbsent(key, value) {
  db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`).run(key, String(value));
  return getConfig(key);
}

/** All snapshot rows (net worth history, last pull pointers). */
function deleteAllSnapshots() {
  return db.prepare('DELETE FROM snapshots').run();
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
  const del = db.prepare(`DELETE FROM config WHERE key = ?`);
  db.exec('BEGIN');
  try {
    for (const key of GAME_STATE_KEYS) del.run(key);
    db.prepare('DELETE FROM snapshots').run();
    db.prepare('DELETE FROM debt_account_balances').run();
    db.prepare('DELETE FROM debt_account_history').run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  db,
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
  setGameStartIfAbsent,
  getGameStart,
  initGameState,
};
