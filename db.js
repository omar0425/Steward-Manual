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
// Wait up to 5s for a lock instead of failing instantly with SQLITE_BUSY.
// This process holds two separate connections to the same file (db.js and
// db-auth.js); without a busy_timeout a write on one can throw "database is
// locked" while the other is mid-transaction. busy_timeout is per-connection.
db.exec("PRAGMA busy_timeout = 5000");

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

  -- App-level (not user-scoped) settings: VAPID keys for web push, etc.
  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Web-push subscriptions (one row per browser/device the user opted in on).
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id    INTEGER NOT NULL,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, endpoint)
  );

  -- Bug reports captured from ANY user's session, readable only by the admin
  -- account (deliberately NOT scoped through withUser — the whole point is a
  -- cross-user view for the operator). Deduped by signature; count tracks
  -- recurrences. user_id records whose session produced the report.
  CREATE TABLE IF NOT EXISTS bug_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    signature     TEXT    NOT NULL UNIQUE,
    kind          TEXT    NOT NULL,              -- 'error'|'metrics'|'invariant'|'user'
    user_id       INTEGER NOT NULL,
    first_seen_at TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL,
    count         INTEGER NOT NULL DEFAULT 1,
    severity      TEXT,                          -- 'high'|'medium'|'low'|NULL (triage pending)
    title         TEXT,
    report        TEXT,                          -- AI triage in plain English
    raw           TEXT    NOT NULL DEFAULT '',   -- trimmed technical payload (JSON)
    status        TEXT    NOT NULL DEFAULT 'new' -- 'new' | 'seen'
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

// Migration: per-account reconcile stamp — when the user last confirmed the
// balance against the real account (via the ✓ tick or by entering a changed
// number). Older rows NULL. Runs after ensureUserScopedTables so a rebuilt
// legacy table gets the column too.
if (!tableColumns('debt_account_balances').some((c) => c.name === 'last_verified_at')) {
  db.exec(`ALTER TABLE debt_account_balances ADD COLUMN last_verified_at TEXT`);
}

_schemaInitDone = true;

// ── Transactions ──────────────────────────────────────────────────────────────
// node:sqlite has a single connection, so transactions can't safely nest with raw
// BEGIN/COMMIT ("cannot start a transaction within a transaction"). This helper
// tracks depth: the outermost call uses BEGIN/COMMIT, inner calls use SAVEPOINTs,
// so multi-write helpers (balance replace, history append, climb metric writes)
// can be composed inside one outer transaction and still roll back atomically.
let _txnDepth = 0;
function transaction(fn) {
  if (typeof fn !== 'function') throw new Error('transaction(fn): fn must be a function');
  if (_txnDepth > 0) {
    const name = `sp_${_txnDepth}`;
    db.exec(`SAVEPOINT ${name}`);
    _txnDepth += 1;
    try {
      const r = fn();
      db.exec(`RELEASE ${name}`);
      _txnDepth -= 1;
      return r;
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      _txnDepth -= 1;
      throw err;
    }
  }
  db.exec('BEGIN');
  _txnDepth += 1;
  try {
    const r = fn();
    db.exec('COMMIT');
    _txnDepth -= 1;
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    _txnDepth -= 1;
    throw err;
  }
}

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
 * UNFILTERED stored balances for the current user — including negative or
 * non-finite values that getAllDebtAccountBalances() silently drops. Only for
 * the ledger-invariant checks, whose whole job is to notice such rows.
 */
function rawDebtBalances() {
  return db
    .prepare(`SELECT ynab_account_id AS accountId, last_balance AS balance FROM debt_account_balances WHERE user_id = ?`)
    .all(currentUserId());
}

/**
 * Replace stored balances with the current pull (full snapshot of debt accounts).
 * @param {Map<string, number>} balanceByAccountId
 */
function replaceDebtAccountBalances(balanceByAccountId) {
  const now = new Date().toISOString();
  const userId = currentUserId();
  // Prior rows, read before the delete so the reconcile stamp survives the
  // replace. Entering a CHANGED balance is itself a verification (the user just
  // read the real account), so those rows — and brand-new accounts — get
  // stamped `now`; an untouched balance keeps whatever stamp it had.
  const prior = new Map(
    db.prepare(`
      SELECT ynab_account_id AS id, last_balance AS bal, last_verified_at AS verifiedAt
      FROM debt_account_balances WHERE user_id = ?
    `).all(userId).map((r) => [String(r.id), r]),
  );
  const del = db.prepare(`DELETE FROM debt_account_balances WHERE user_id = ?`);
  const ins = db.prepare(`
    INSERT INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at, last_verified_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  transaction(() => {
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
      const prev = prior.get(String(id));
      const changed = !prev || Math.round(Number(prev.bal) * 100) !== Math.round(b * 100);
      ins.run(userId, String(id), b, now, changed ? now : (prev.verifiedAt || null));
    }
  });
}

/**
 * Stamp an account as reconciled ("I checked this against the real statement
 * and it's still right") WITHOUT creating a snapshot — confirming an unchanged
 * balance is not a turn. Returns the ISO stamp, or null if no such account.
 */
function markDebtAccountVerified(accountId) {
  if (accountId == null || accountId === '') return null;
  const now = new Date().toISOString();
  const info = db
    .prepare(`UPDATE debt_account_balances SET last_verified_at = ? WHERE user_id = ? AND ynab_account_id = ?`)
    .run(now, currentUserId(), String(accountId));
  return info.changes > 0 ? now : null;
}

/**
 * Overwrite an account's reconcile stamp with an exact value (or clear it with
 * null). Used by undo to put back the PRE-pull stamps — the replace done during
 * an undo would otherwise mark rolled-back balances as "checked today".
 */
function setDebtAccountVerifiedAt(accountId, iso) {
  if (accountId == null || accountId === '') return 0;
  return db
    .prepare(`UPDATE debt_account_balances SET last_verified_at = ? WHERE user_id = ? AND ynab_account_id = ?`)
    .run(iso == null ? null : String(iso), currentUserId(), String(accountId)).changes;
}

/** Map(accountId → ISO last_verified_at) for the current user; unstamped rows omitted. */
function getDebtAccountVerifiedAt() {
  const rows = db
    .prepare(`SELECT ynab_account_id AS id, last_verified_at AS verifiedAt FROM debt_account_balances WHERE user_id = ?`)
    .all(currentUserId());
  const m = new Map();
  for (const r of rows) {
    if (r.verifiedAt) m.set(String(r.id), String(r.verifiedAt));
  }
  return m;
}

// ── Per-account balance history (spark lines, last 30 entries per account) ───

function appendDebtAccountHistory(balanceMap, recordedAt) {
  // recordedAt lets the caller pin history to the snapshot's exact timestamp so
  // an undo can later delete precisely the rows this pull added (see undoLastPull).
  const now = recordedAt ? String(recordedAt) : new Date().toISOString();
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
  transaction(() => {
    for (const [id, bal] of balanceMap) {
      ins.run(userId, String(id), now, Math.round(Number(bal) * 100) / 100);
      prune.run(userId, String(id), userId, String(id));
    }
  });
}

/**
 * Delete the current user's history rows recorded at an exact timestamp. Used by
 * undo to remove precisely the rows a reversed pull appended (no-op when the
 * timestamp is absent, e.g. legacy undo entries / aggregate pulls). Returns the
 * number of rows removed.
 */
function deleteDebtAccountHistoryAt(recordedAt) {
  if (recordedAt == null || recordedAt === '') return 0;
  return db
    .prepare(`DELETE FROM debt_account_history WHERE user_id = ? AND recorded_at = ?`)
    .run(currentUserId(), String(recordedAt)).changes;
}

/** Delete all of the current user's config rows whose key starts with `prefix`. */
function deleteConfigByPrefix(prefix) {
  if (!prefix) return 0;
  return db
    .prepare(`DELETE FROM config WHERE user_id = ? AND key LIKE ?`)
    .run(currentUserId(), `${String(prefix)}%`).changes;
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
  // Prefer the write-once origin balance the snapshot route persists (see
  // debt_account_first_balance). The history-derived MIN above is only a fallback
  // for accounts predating that persistence — and it drifts once the 30-row
  // prune drops an account's earliest rows. The persisted value never drifts.
  const raw = getConfig('debt_account_first_balance');
  if (raw) {
    try {
      const pinned = JSON.parse(raw);
      if (pinned && typeof pinned === 'object' && !Array.isArray(pinned)) {
        for (const [id, bal] of Object.entries(pinned)) {
          const n = Number(bal);
          if (Number.isFinite(n)) m.set(String(id), n);
        }
      }
    } catch { /* malformed → keep history-derived values */ }
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
    `SELECT ynab_account_id AS accountId, last_balance AS balance, updated_at AS updatedAt,
            last_verified_at AS lastVerifiedAt
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
function importUserData(data, { force = false } = {}) {
  const userId = currentUserId();
  if (!data || typeof data !== 'object') throw new Error('import payload must be an object');
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  const balances = Array.isArray(data.debtAccountBalances) ? data.debtAccountBalances : [];
  const history = Array.isArray(data.debtAccountHistory) ? data.debtAccountHistory : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};

  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // Safety net: this is a destructive full-replace. A shape-valid payload that
  // yields ZERO usable snapshots (e.g. a truncated/old/hand-edited file) would
  // silently erase everything the user has. Refuse unless the caller explicitly
  // forces it (an intentional wipe). Checked BEFORE any DELETE runs.
  const usableSnapshots = snapshots.filter((s) => s && s.pulled_at != null).length;
  const existingSnapshots = db
    .prepare('SELECT COUNT(*) AS n FROM snapshots WHERE user_id = ?')
    .get(userId).n;
  if (usableSnapshots === 0 && existingSnapshots > 0 && !force) {
    const err = new Error(
      'Refusing to restore: the payload has no usable snapshots and you already have data — ' +
      'this would erase everything. Re-send with force to wipe intentionally.',
    );
    err.code = 'EMPTY_RESTORE_GUARD';
    throw err;
  }

  const insSnap = db.prepare(`
    INSERT INTO snapshots
      (user_id, source, pulled_at, net_worth, total_assets, safety_liquid, total_debt,
       investment_value, debt_remaining, months_ahead, monthly_income, monthly_expenses, tier)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insBal = db.prepare(`
    INSERT OR REPLACE INTO debt_account_balances (user_id, ynab_account_id, last_balance, updated_at, last_verified_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insHist = db.prepare(`
    INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
    VALUES (?, ?, ?, ?)
  `);
  const insCfg = db.prepare(`INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();

  let counts = { snapshots: 0, balances: 0, history: 0, settings: 0 };
  let skipped = { snapshots: 0, balances: 0, history: 0, settings: 0 };
  transaction(() => {
    db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_balances WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM config WHERE user_id = ?').run(userId);

    for (const s of snapshots) {
      if (!s || s.pulled_at == null) { skipped.snapshots += 1; continue; }
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
      if (id == null || !Number.isFinite(bal) || bal < 0) { skipped.balances += 1; continue; }
      const verifiedAt = b.lastVerifiedAt || b.last_verified_at;
      insBal.run(
        userId, String(id), Math.round(bal * 100) / 100,
        String(b.updatedAt || b.updated_at || now),
        verifiedAt ? String(verifiedAt) : null,
      );
      counts.balances += 1;
    }
    for (const h of history) {
      const id = h && (h.accountId != null ? h.accountId : h.ynab_account_id);
      const at = h && (h.recordedAt || h.recorded_at);
      const bal = num(h && h.balance, NaN);
      if (id == null || !at || !Number.isFinite(bal) || bal < 0) { skipped.history += 1; continue; }
      insHist.run(userId, String(id), String(at), Math.round(bal * 100) / 100);
      counts.history += 1;
    }
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'climb_undo_stack') continue; // referenced now-stale snapshot ids
      if (value == null) { skipped.settings += 1; continue; }
      insCfg.run(userId, String(key), String(value));
      counts.settings += 1;
    }
  });
  return { ...counts, skipped };
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
  // Element-shape + size sanity (cheap, catches a corrupt/hostile file before the
  // destructive replace). Empty arrays remain valid; only present elements are checked.
  const MAX_ROWS = 100000;
  const isPlainObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (data.snapshots.length > MAX_ROWS) return { ok: false, error: 'Too many snapshots in payload.' };
  if (data.debtAccountBalances.length > MAX_ROWS) return { ok: false, error: 'Too many balance rows in payload.' };
  if (Array.isArray(data.debtAccountHistory) && data.debtAccountHistory.length > MAX_ROWS) {
    return { ok: false, error: 'Too many history rows in payload.' };
  }
  if (data.snapshots.some((s) => !isPlainObj(s))) return { ok: false, error: 'Each snapshot must be an object.' };
  if (data.debtAccountBalances.some((b) => !isPlainObj(b))) return { ok: false, error: 'Each balance row must be an object.' };
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
  transaction(() => {
    upsert.run(userId, GAME_START_DEBT_KEY,  debt);
    upsert.run(userId, GAME_START_AT_KEY,    at);
    upsert.run(userId, 'climb_baseline_debt', debt);
    upsert.run(userId, 'debt_start',          debt);
    upsert.run(userId, 'cumulative_paid_down',       '0');
    upsert.run(userId, 'cumulative_new_debt_added',  '0');
    // Reset accrued interest too — a new game must not inherit the prior game's
    // interest bucket (it's one of the three cumulative climb metrics).
    upsert.run(userId, 'cumulative_interest_accrued', '0');
    upsert.run(userId, 'last_aggregate_debt_for_climb', debt);
    upsert.run(userId, 'climb_per_account_map_seeded', '1');
    for (const key of KEYS_TO_CLEAR) del.run(userId, key);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT OR IGNORE INTO debt_account_history (user_id, ynab_account_id, recorded_at, balance)
      SELECT user_id, ynab_account_id, ?, last_balance FROM debt_account_balances WHERE user_id = ?
    `).run(at, userId);
    // Re-pin each account's origin balance to its game-start balance, mirroring
    // the history re-seed above. Without this, per-account "% paid" would keep
    // measuring from a pre-game setup entry (persisted during setup pulls) while
    // the aggregate baseline resets to game start — the two would disagree for a
    // user who logged several setup pulls before starting the climb.
    const balRows = db
      .prepare('SELECT ynab_account_id AS id, last_balance AS bal FROM debt_account_balances WHERE user_id = ?')
      .all(userId);
    const firstBalMap = {};
    for (const r of balRows) {
      const n = Number(r.bal);
      if (Number.isFinite(n)) firstBalMap[String(r.id)] = n;
    }
    upsert.run(userId, 'debt_account_first_balance', JSON.stringify(firstBalMap));
  });
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

// ── App-level meta (NOT user-scoped) ─────────────────────────────────────────
// For values that belong to the deployment, not a user — e.g. the VAPID key
// pair web push signs with (generated once, must stay stable across restarts).

function getAppMeta(key) {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(String(key));
  return row ? row.value : null;
}

function setAppMeta(key, value) {
  db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`).run(String(key), String(value));
}

// ── Web-push subscriptions ────────────────────────────────────────────────────

function savePushSubscription({ endpoint, p256dh, auth }) {
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(currentUserId(), String(endpoint), String(p256dh), String(auth), new Date().toISOString());
}

function deletePushSubscription(endpoint) {
  return db
    .prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
    .run(currentUserId(), String(endpoint)).changes;
}

function hasPushSubscription() {
  return !!db.prepare(`SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1`).get(currentUserId());
}

/** Cross-user: all subscriptions for one user id (reminder sweep runs outside withUser). */
function listPushSubscriptionsForUser(userId) {
  return db
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`)
    .all(Number(userId));
}

/** Cross-user delete by exact endpoint — used to prune dead (404/410) subscriptions. */
function deletePushSubscriptionAnyUser(endpoint) {
  return db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(String(endpoint)).changes;
}

// ── Bug reports (admin-only surface; cross-user by design) ───────────────────

/**
 * Record a bug occurrence. Same signature → bump count + last_seen (and
 * re-open a previously seen report). Returns { id, isNew, count }.
 */
function upsertBugReport({ signature, kind, userId, raw }) {
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT id, count FROM bug_reports WHERE signature = ?`)
    .get(String(signature));
  if (existing) {
    db.prepare(
      `UPDATE bug_reports SET count = count + 1, last_seen_at = ?, status = 'new' WHERE id = ?`,
    ).run(now, existing.id);
    return { id: existing.id, isNew: false, count: existing.count + 1 };
  }
  const res = db.prepare(`
    INSERT INTO bug_reports (signature, kind, user_id, first_seen_at, last_seen_at, raw)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    String(signature),
    String(kind),
    Number(userId) || 0,
    now,
    now,
    String(raw || '').slice(0, 8000),
  );
  return { id: Number(res.lastInsertRowid), isNew: true, count: 1 };
}

/** Attach the AI triage (or a fallback title) to a report. */
function setBugReportTriage(id, { severity, title, report }) {
  db.prepare(`UPDATE bug_reports SET severity = ?, title = ?, report = ? WHERE id = ?`).run(
    severity == null ? null : String(severity),
    title == null ? null : String(title).slice(0, 200),
    report == null ? null : String(report).slice(0, 2000),
    Number(id),
  );
}

/** Newest-first list for the admin panel (cross-user). */
function listBugReports(limit = 50) {
  return db.prepare(`
    SELECT id, kind, user_id, first_seen_at, last_seen_at, count, severity, title, report, raw, status
    FROM bug_reports ORDER BY last_seen_at DESC LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit) || 50)));
}

function countNewBugReports() {
  return db.prepare(`SELECT COUNT(*) AS n FROM bug_reports WHERE status = 'new'`).get().n;
}

function markAllBugReportsSeen() {
  return db.prepare(`UPDATE bug_reports SET status = 'seen' WHERE status = 'new'`).run().changes;
}

/** Cheap spam guard: occurrences recorded in the last 24h (all users). */
function bugReportsInLastDay() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return db.prepare(`SELECT COUNT(*) AS n FROM bug_reports WHERE last_seen_at >= ?`).get(since).n;
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
    'debt_account_first_balance',
    'debt_start',
    'game_start_at',
    'game_start_debt',
    'last_aggregate_debt_for_climb',
    'last_debt_sync_debug_snapshot_v1',
    'notifications_sent',
    'pending_account_cleared',
    'due_reminders_sent',
    'promise_made_at',
    'promise_text',
    'turn_start_at',
    'turn_start_balances',
    // AI commentary + cutscene state — a reset must not leave stale narration,
    // nicknames, fired-mode timers, or an armed cutscene describing the old game.
    'pending_cutscene',
    'cutscene_paydown_bucket',
    'cutscene_next_index',
    'cutscene_last_index',
    'steward_chat_history',
    'steward_situation_note',
    'steward_ai_ledger',
    'steward_ai_nicknames',
    'steward_ai_last_if_do_nothing_at',
    'steward_ai_last_quarterly_at',
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
  // Per-snapshot AI dialog/quote caches are keyed by pulled_at (a prefix), so the
  // explicit key list can't catch them — sweep by LIKE inside the same transaction.
  const delPrefix = db.prepare(`DELETE FROM config WHERE user_id = ? AND key LIKE ?`);
  transaction(() => {
    for (const key of GAME_STATE_KEYS) del.run(userId, key);
    delPrefix.run(userId, 'steward_ai_dialog_at:%');
    delPrefix.run(userId, 'steward_ai_quote_at:%');
    // Cached Monte Carlo forecasts are keyed by pulled_at (a prefix, like the
    // AI caches above) — sweep them so a reset can't leave the old game's
    // forecast row behind.
    delPrefix.run(userId, 'payoff_forecast_at:%');
    db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_balances WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM debt_account_history WHERE user_id = ?').run(userId);
  });

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
  transaction,
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
  rawDebtBalances,
  replaceDebtAccountBalances,
  markDebtAccountVerified,
  getDebtAccountVerifiedAt,
  setDebtAccountVerifiedAt,
  getAppMeta,
  setAppMeta,
  savePushSubscription,
  deletePushSubscription,
  hasPushSubscription,
  listPushSubscriptionsForUser,
  deletePushSubscriptionAnyUser,
  upsertBugReport,
  setBugReportTriage,
  listBugReports,
  countNewBugReports,
  markAllBugReportsSeen,
  bugReportsInLastDay,
  getConfig,
  setConfig,
  setConfigIfAbsent,
  deleteConfigByPrefix,
  appendDebtAccountHistory,
  deleteDebtAccountHistoryAt,
  getDebtAccountHistory,
  debtAccountHistoryRows,
  getDebtAccountFirstBalances,
  exportUserData,
  getGameStart,
  initGameState,
  lastNonZeroFinancials,
};
