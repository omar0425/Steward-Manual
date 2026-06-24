'use strict';

// Node 24 ships node:sqlite as a stable built-in — no native compilation needed.
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, 'steward.db');

// Ensure the parent directory exists. Matters on first Railway/Fly boot when
// the user mounts a fresh volume at e.g. /data — the directory exists but the
// .db file doesn't, and DatabaseSync would still throw if any intermediate
// directory is missing. mkdirSync with recursive:true is idempotent.
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (err) {
  // Fall through and let DatabaseSync produce the canonical error message —
  // suppressing here would only mask the real cause (e.g. read-only fs).
  console.error('[db] mkdir for DB parent failed:', err && err.message);
}

const db = new DatabaseSync(DB_PATH);
const userScope = new AsyncLocalStorage();

// While the schema is still being initialised at module load there is no
// AsyncLocalStorage scope yet — fall back to user_id=0 so DDL helpers work.
// Once schema init finishes, callers MUST be inside withUser().
let _schemaInitDone = false;

function currentUserId() {
  const store = userScope.getStore();
  const id = Number(store);
  if (Number.isInteger(id) && id > 0) return id;
  if (typeof store === 'undefined') {
    // No scope active at all. Permitted only during schema init at module load.
    if (_schemaInitDone) {
      throw new Error('currentUserId() called outside withUser() scope');
    }
    return 0;
  }
  // Scope is active but the user is anonymous (id <= 0) — keep the original
  // user_id=0 fallback so the route middleware can run for unauthenticated
  // requests without throwing.
  console.warn('[db] currentUserId: active scope has non-positive id (' + store + ') — using 0');
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
_schemaInitDone = true;

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
    SELECT id FROM snapshots WHERE user_id = ? AND source = ? ORDER BY pulled_at DESC, id DESC LIMIT 60
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
      `SELECT * FROM snapshots WHERE user_id = ? AND source = ? ORDER BY pulled_at DESC, id DESC LIMIT 1`
    ).get(userId, source) || null;
  }
  return db.prepare(
    `SELECT * FROM snapshots WHERE user_id = ? ORDER BY pulled_at DESC, id DESC LIMIT 1`
  ).get(userId) || null;
}

function recentSnapshots(limit = 60) {
  return db.prepare(
    `SELECT * FROM snapshots WHERE user_id = ? ORDER BY pulled_at DESC, id DESC LIMIT ?`
  ).all(currentUserId(), limit);
}

/** Delete one snapshot by id (scoped to the current user). Used by undo. */
function deleteSnapshotById(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return 0;
  const info = db
    .prepare(`DELETE FROM snapshots WHERE user_id = ? AND id = ?`)
    .run(currentUserId(), n);
  return info.changes;
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
      if (!Number.isFinite(b) || b < 0) {
        console.warn(
          `[db] replaceDebtAccountBalances: dropping account ${JSON.stringify(String(id))} ` +
          `— balance is not a finite non-negative number (got ${JSON.stringify(bal)})`,
        );
        continue;
      }
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

/** Raw per-account history rows (ascending) for the current user — chart series. */
function debtAccountHistoryRows() {
  return db.prepare(
    `SELECT ynab_account_id AS accountId, recorded_at AS recordedAt, balance
     FROM debt_account_history WHERE user_id = ? ORDER BY recorded_at ASC, ynab_account_id ASC`,
  ).all(currentUserId());
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

/**
 * Earliest recorded balance per account across ALL history (no day window) —
 * each account's starting point, used to compute how far it has been paid
 * down in percentage terms. Returns Map(accountId → starting balance).
 */
function getDebtAccountFirstBalances() {
  const rows = db.prepare(`
    SELECT h.ynab_account_id AS id, h.balance AS balance
    FROM debt_account_history h
    JOIN (
      SELECT ynab_account_id, MIN(recorded_at) AS first_at
      FROM debt_account_history
      WHERE user_id = ?
      GROUP BY ynab_account_id
    ) f ON f.ynab_account_id = h.ynab_account_id AND f.first_at = h.recorded_at
    WHERE h.user_id = ?
  `).all(currentUserId(), currentUserId());
  const m = new Map();
  for (const r of rows) {
    // A row can tie on first_at for the same account only once in practice;
    // keep the first seen if a duplicate timestamp ever occurs.
    if (!m.has(String(r.id))) m.set(String(r.id), Number(r.balance));
  }
  return m;
}

/**
 * Everything the current user owns, for the "Export my data" download.
 * Full history (no day window), raw column names preserved so the file is a
 * faithful record rather than a UI projection.
 */
function exportUserData() {
  const userId = currentUserId();
  const snapshots = db.prepare(
    `SELECT * FROM snapshots WHERE user_id = ? ORDER BY pulled_at ASC, id ASC`,
  ).all(userId);
  const debtAccountBalances = db.prepare(
    `SELECT ynab_account_id AS accountId, last_balance AS balance, updated_at AS updatedAt
     FROM debt_account_balances WHERE user_id = ? ORDER BY ynab_account_id`,
  ).all(userId);
  const debtAccountHistory = db.prepare(
    `SELECT ynab_account_id AS accountId, recorded_at AS recordedAt, balance
     FROM debt_account_history WHERE user_id = ? ORDER BY ynab_account_id, recorded_at ASC`,
  ).all(userId);
  const settings = {};
  for (const row of db.prepare(`SELECT key, value FROM config WHERE user_id = ?`).all(userId)) {
    settings[row.key] = row.value;
  }
  return { snapshots, debtAccountBalances, debtAccountHistory, settings };
}

/**
 * Restore the CURRENT user's state from a prior export() payload — full replace
 * of snapshots, per-account balances, history, and config. Always scoped to the
 * current user (the export's own user_id/id fields are ignored, so an export can
 * never write into someone else's rows). The undo stack is cleared because its
 * snapshotIds referenced the pre-restore rows. Returns counts of what was written.
 */
function importUserData(data) {
  const userId = currentUserId();
  if (!data || typeof data !== 'object') throw new Error('import payload must be an object');
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  const balances = Array.isArray(data.debtAccountBalances) ? data.debtAccountBalances : [];
  const history = Array.isArray(data.debtAccountHistory) ? data.debtAccountHistory : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};

  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

  const insSnap = db.prepare(`
    INSERT INTO snapshots
      (user_id, source, pulled_at, net_worth, total_assets, safety_liquid, total_debt,
       investment_value, debt_remaining, months_ahead, monthly_income, monthly_expenses, tier)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insBal = db.prepare(`
    INSERT OR REPLACE INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const insHist = db.prepare(`
    INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
    VALUES (?, ?, ?, ?)
  `);
  const insCfg = db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();

  let counts = { snapshots: 0, balances: 0, history: 0, settings: 0 };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_balances WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM config WHERE user_id = ?').run(userId);

    for (const s of snapshots) {
      if (!s || s.pulled_at == null) continue;
      insSnap.run(
        userId,
        String(s.source || 'manual'),
        String(s.pulled_at),
        num(s.net_worth), num(s.total_assets),
        s.safety_liquid == null ? null : num(s.safety_liquid),
        num(s.total_debt), num(s.investment_value), num(s.debt_remaining),
        s.months_ahead == null ? null : num(s.months_ahead),
        num(s.monthly_income), num(s.monthly_expenses),
        String(s.tier || 'rock_bottom'),
      );
      counts.snapshots += 1;
    }
    for (const b of balances) {
      const id = b && (b.accountId != null ? b.accountId : b.ynab_account_id);
      const bal = num(b && (b.balance != null ? b.balance : b.last_balance), NaN);
      if (id == null || !Number.isFinite(bal) || bal < 0) continue;
      insBal.run(userId, String(id), Math.round(bal * 100) / 100, String(b.updatedAt || b.updated_at || now));
      counts.balances += 1;
    }
    for (const h of history) {
      const id = h && (h.accountId != null ? h.accountId : h.ynab_account_id);
      const at = h && (h.recordedAt || h.recorded_at);
      const bal = num(h && h.balance, NaN);
      if (id == null || !at || !Number.isFinite(bal) || bal < 0) continue;
      insHist.run(userId, String(id), String(at), Math.round(bal * 100) / 100);
      counts.history += 1;
    }
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'climb_undo_stack') continue; // referenced now-stale snapshot ids
      if (value == null) continue;
      insCfg.run(userId, String(key), String(value));
      counts.settings += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return counts;
}

/** Shape-check an import/restore payload before it touches the DB. */
function isValidImportPayload(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Payload must be a JSON object.' };
  if (!Array.isArray(data.snapshots)) return { ok: false, error: 'Payload is missing a "snapshots" array.' };
  if (!Array.isArray(data.debtAccountBalances)) return { ok: false, error: 'Payload is missing a "debtAccountBalances" array.' };
  if (data.debtAccountHistory != null && !Array.isArray(data.debtAccountHistory)) {
    return { ok: false, error: '"debtAccountHistory" must be an array.' };
  }
  if (data.settings != null && (typeof data.settings !== 'object' || Array.isArray(data.settings))) {
    return { ok: false, error: '"settings" must be an object.' };
  }
  return { ok: true };
}

/**
 * Loud warning when the SQLite file is on ephemeral storage on Railway, where a
 * redeploy would wipe ALL users. Heuristic: on Railway, the DB path must live
 * under the attached volume (RAILWAY_VOLUME_MOUNT_PATH). Returns a message or null.
 */
function storageDurabilityWarning() {
  const onRailway = !!(
    process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID
  );
  if (!onRailway) return null;
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!mount) {
    return 'No Railway volume detected (RAILWAY_VOLUME_MOUNT_PATH unset). The SQLite database is on ephemeral storage and WILL BE LOST on the next redeploy. Attach a volume and point STEWARD_DB_PATH inside it.';
  }
  if (!DB_PATH.startsWith(path.resolve(mount))) {
    return `The database (${DB_PATH}) is NOT under the Railway volume (${mount}); it will be LOST on redeploy. Set STEWARD_DB_PATH to a path inside the volume.`;
  }
  return null;
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
    'climb_undo_stack',
    'cumulative_interest_accrued',
    'cumulative_new_debt_added',
    'cumulative_paid_down',
    'debt_account_name_map',
    'debt_account_origin',
    'debt_start',
    'game_start_at',
    'game_start_debt',
    'last_aggregate_debt_for_climb',
    'last_debt_sync_debug_snapshot_v1',
    'notifications_sent',
    'promise_made_at',
    'promise_text',
    'turn_start_at',
    'turn_start_balances',
  ];
  // Counts collected so the API can tell the user what was actually cleared.
  const countOne = (sql, ...params) => db.prepare(sql).get(userId, ...params);
  const snapshotsBefore = countOne(`SELECT COUNT(*) AS n FROM snapshots WHERE user_id = ?`).n;
  const balancesBefore  = countOne(`SELECT COUNT(*) AS n FROM debt_account_balances WHERE user_id = ?`).n;
  const historyBefore   = countOne(`SELECT COUNT(*) AS n FROM debt_account_history WHERE user_id = ?`).n;
  const gameStateBefore = db
    .prepare(
      `SELECT COUNT(*) AS n FROM config WHERE user_id = ? AND key IN (${GAME_STATE_KEYS.map(() => '?').join(',')})`,
    )
    .get(userId, ...GAME_STATE_KEYS).n;
  // Things we deliberately do NOT touch — collect for the response so the user
  // sees their interest rates / theme weren't wiped out.
  const interestRatesRaw = db
    .prepare(`SELECT value FROM config WHERE user_id = ? AND key = 'interest_rates'`)
    .get(userId);
  let interestRatesCount = 0;
  if (interestRatesRaw && interestRatesRaw.value) {
    try {
      const o = JSON.parse(interestRatesRaw.value);
      if (o && typeof o === 'object') interestRatesCount = Object.keys(o).length;
    } catch (_) { /* ignore */ }
  }

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

  return {
    deleted: {
      snapshots: snapshotsBefore,
      debtAccountBalances: balancesBefore,
      debtAccountHistory: historyBefore,
      gameStateConfigKeys: gameStateBefore,
    },
    preserved: {
      interestRates: interestRatesCount,
    },
  };
}

function lastNonZeroFinancials() {
  const userId = currentUserId();
  const row = db.prepare(`
    SELECT monthly_income, monthly_expenses, total_assets, investment_value
    FROM snapshots
    WHERE user_id = ? AND (monthly_income > 0 OR monthly_expenses > 0 OR total_assets > 0)
    ORDER BY pulled_at DESC, id DESC LIMIT 1
  `).get(userId);
  return row || null;
}

module.exports = {
  db,
  withUser,
  currentUserId,
  insertSnapshot,
  latestSnapshot,
  recentSnapshots,
  deleteSnapshotById,
  importUserData,
  isValidImportPayload,
  storageDurabilityWarning,
  resetAllGameState,
  getAllDebtAccountBalances,
  replaceDebtAccountBalances,
  getConfig,
  setConfig,
  setConfigIfAbsent,
  appendDebtAccountHistory,
  getDebtAccountHistory,
  debtAccountHistoryRows,
  getDebtAccountFirstBalances,
  exportUserData,
  getGameStart,
  initGameState,
  lastNonZeroFinancials,
};
