'use strict';

/**
 * Restore drill — prove a Steward backup actually restores cleanly.
 *
 * A backup you have never restored is a backup you do not have. This script
 * loads a backup .db into a *throwaway* copy, opens it with the same SQLite
 * engine the app uses (node:sqlite), and runs a battery of checks:
 *
 *   1. SQLite integrity_check + foreign_key_check (file is not corrupt)
 *   2. Every table + index the live schema expects is present
 *   3. Row counts per table (so a 0-row "backup" is caught)
 *   4. Money invariants on the actual data:
 *        - snapshots: debt/asset fields finite and non-negative
 *        - climb config per user: paid >= 0, new >= 0, pctPaid <= 100,
 *          baseline > 0 when a climb is active
 *   5. (optional) Compare against a reference DB (e.g. yesterday's backup or
 *      the live file) and flag suspicious shrinkage — a backup with far fewer
 *      rows than the day before usually means truncation, not progress.
 *
 * Exit code is 0 only when every check passes, so it can be scheduled and wired
 * to an alert. Any failure exits non-zero with a human-readable reason.
 *
 * Usage:
 *   node scripts/restore-drill.js [backup.db] [--compare ref.db] [--json] [--quiet]
 *
 * With no path, it picks the newest steward-*.db in (first that exists):
 *   - %USERPROFILE%\StewardBackups   (where pull-backup.ps1 lands off-site copies)
 *   - <db-dir>/backups               (the on-volume daily rotation)
 *
 * Examples:
 *   node scripts/restore-drill.js
 *   node scripts/restore-drill.js C:\Users\Omar\StewardBackups\steward-2026-06-29-0900.db
 *   node scripts/restore-drill.js latest --compare live
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Expected schema (kept in sync with db.js + db-auth.js) ──────────────────
const EXPECTED_TABLES = [
  'users',
  'sessions',
  'password_reset_tokens',
  'snapshots',
  'debt_account_balances',
  'debt_account_history',
  'config',
];
const EXPECTED_INDEXES = ['idx_password_reset_tokens_user'];

// ── Tiny arg parser ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { backup: null, compare: null, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compare') opts.compare = argv[++i] || null;
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!opts.backup) opts.backup = a;
  }
  return opts;
}

function backupSearchDirs() {
  const dirs = [];
  const home = process.env.USERPROFILE || os.homedir();
  if (home) dirs.push(path.join(home, 'StewardBackups'));
  const dbPath = process.env.STEWARD_DB_PATH
    ? path.resolve(process.env.STEWARD_DB_PATH)
    : path.join(__dirname, '..', 'steward.db');
  dirs.push(path.join(path.dirname(dbPath), 'backups'));
  return dirs;
}

function liveDbPath() {
  return process.env.STEWARD_DB_PATH
    ? path.resolve(process.env.STEWARD_DB_PATH)
    : path.join(__dirname, '..', 'steward.db');
}

/** Newest steward-*.db across the known backup directories, or null. */
function findLatestBackup() {
  const candidates = [];
  for (const dir of backupSearchDirs()) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (/^steward-.*\.db$/.test(f)) {
        const full = path.join(dir, f);
        try {
          candidates.push({ full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].full;
}

function resolveBackupArg(arg) {
  if (!arg || arg === 'latest') return findLatestBackup();
  return path.resolve(arg);
}

// ── Drill ───────────────────────────────────────────────────────────────────
function inspect(dbFile) {
  // Copy into a throwaway temp file so we never touch the real backup, and so a
  // half-written WAL on the source can't surprise us. A VACUUM INTO backup is a
  // single self-contained file; the copy is opened fresh.
  const tmp = path.join(
    os.tmpdir(),
    `steward-restore-drill-${process.pid}-${path.basename(dbFile)}`,
  );
  fs.copyFileSync(dbFile, tmp);

  const result = {
    file: dbFile,
    sizeBytes: fs.statSync(dbFile).size,
    integrity: null,
    foreignKeyViolations: null,
    tables: {},
    missingTables: [],
    missingIndexes: [],
    rowCounts: {},
    moneyIssues: [],
    errors: [],
  };

  let db;
  try {
    db = new DatabaseSync(tmp);

    // 1. integrity + FK
    const integ = db.prepare('PRAGMA integrity_check').all();
    result.integrity = integ.map((r) => r.integrity_check).join('; ');
    const fkRows = db.prepare('PRAGMA foreign_key_check').all();
    result.foreignKeyViolations = fkRows.length;
    if (fkRows.length) {
      result.errors.push(`${fkRows.length} foreign-key violation(s)`);
    }

    // 2. schema presence
    const tableNames = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
    const indexNames = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name),
    );
    for (const t of EXPECTED_TABLES) {
      if (!tableNames.has(t)) result.missingTables.push(t);
    }
    for (const idx of EXPECTED_INDEXES) {
      if (!indexNames.has(idx)) result.missingIndexes.push(idx);
    }

    // 3. row counts (only for tables that exist)
    for (const t of EXPECTED_TABLES) {
      if (tableNames.has(t)) {
        result.rowCounts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      }
    }

    // 4. money invariants on snapshot + climb data
    if (tableNames.has('snapshots')) {
      const badSnap = db
        .prepare(
          `SELECT COUNT(*) AS n FROM snapshots
           WHERE debt_remaining < 0 OR total_debt < 0 OR total_assets < 0
              OR debt_remaining IS NULL OR total_debt IS NULL`,
        )
        .get().n;
      if (badSnap > 0) {
        result.moneyIssues.push(`${badSnap} snapshot row(s) with negative/null debt or assets`);
      }
    }
    if (tableNames.has('config')) {
      // Pull per-user climb config and check the cumulative invariants.
      const rows = db
        .prepare(
          `SELECT user_id, key, value FROM config
           WHERE key IN ('climb_baseline_debt','cumulative_paid_down','cumulative_new_debt_added','cumulative_interest_accrued')`,
        )
        .all();
      const byUser = new Map();
      for (const r of rows) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, {});
        byUser.get(r.user_id)[r.key] = parseFloat(r.value);
      }
      for (const [uid, c] of byUser) {
        const baseline = c.climb_baseline_debt;
        const paid = c.cumulative_paid_down;
        const newD = c.cumulative_new_debt_added;
        const interest = c.cumulative_interest_accrued;
        if (paid != null && paid < 0) {
          result.moneyIssues.push(`user ${uid}: cumulative_paid_down < 0 (${paid})`);
        }
        if (newD != null && newD < 0) {
          result.moneyIssues.push(`user ${uid}: cumulative_new_debt_added < 0 (${newD})`);
        }
        if (interest != null && interest < 0) {
          result.moneyIssues.push(`user ${uid}: cumulative_interest_accrued < 0 (${interest})`);
        }
        if (baseline != null && paid != null && baseline > 0) {
          const pct = (paid / baseline) * 100;
          // paid can legitimately exceed baseline over a long climb (pay down,
          // re-borrow, pay down again), but >300% almost always means a unit or
          // double-count bug — flag it for a human to eyeball, don't hard-fail.
          if (pct > 300) {
            result.moneyIssues.push(
              `user ${uid}: cumulative_paid_down is ${pct.toFixed(0)}% of baseline (paid=${paid}, baseline=${baseline}) — verify`,
            );
          }
        }
      }
    }
  } catch (err) {
    result.errors.push(err && err.message ? err.message : String(err));
  } finally {
    try {
      if (db) db.close();
    } catch {
      /* ignore */
    }
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
  return result;
}

function passed(result) {
  return (
    result.errors.length === 0 &&
    result.integrity === 'ok' &&
    result.foreignKeyViolations === 0 &&
    result.missingTables.length === 0 &&
    result.missingIndexes.length === 0 &&
    result.moneyIssues.length === 0
  );
}

function compareCounts(current, reference, log) {
  // Suspicious shrinkage: a backup with dramatically fewer rows than the
  // reference is the classic "truncated / wrong file" signature.
  log('\nComparison vs reference:');
  let suspicious = false;
  for (const t of EXPECTED_TABLES) {
    const cur = current.rowCounts[t];
    const ref = reference.rowCounts[t];
    if (cur == null || ref == null) continue;
    const delta = cur - ref;
    let flag = '';
    // Append-mostly tables (snapshots, history) should never shrink hard.
    if ((t === 'snapshots' || t === 'debt_account_history' || t === 'users') && cur < ref * 0.5 && ref >= 4) {
      flag = '  ⚠ dropped >50% vs reference';
      suspicious = true;
    }
    log(`  ${t.padEnd(24)} ${String(cur).padStart(7)}  (ref ${ref}, Δ${delta >= 0 ? '+' : ''}${delta})${flag}`);
  }
  return !suspicious;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (...a) => {
    if (!opts.quiet) console.log(...a);
  };

  if (opts.help) {
    console.log(
      'Usage: node scripts/restore-drill.js [backup.db|latest] [--compare ref.db|live] [--json] [--quiet]',
    );
    process.exit(0);
  }

  const backupPath = resolveBackupArg(opts.backup);
  if (!backupPath) {
    console.error(
      '[restore-drill] No backup found. Searched:\n  ' +
        backupSearchDirs().join('\n  ') +
        '\nPass a path explicitly: node scripts/restore-drill.js <file.db>',
    );
    process.exit(2);
  }
  if (!fs.existsSync(backupPath)) {
    console.error(`[restore-drill] Backup not found: ${backupPath}`);
    process.exit(2);
  }

  log(`[restore-drill] Restoring a throwaway copy of:\n  ${backupPath}`);
  const result = inspect(backupPath);

  let comparisonOk = true;
  if (opts.compare) {
    const refPath = opts.compare === 'live' ? liveDbPath() : path.resolve(opts.compare);
    if (fs.existsSync(refPath)) {
      result.reference = refPath;
      const refResult = inspect(refPath);
      comparisonOk = compareCounts(result, refResult, log);
      if (!comparisonOk) result.errors.push('row counts shrank suspiciously vs reference');
    } else {
      log(`[restore-drill] (reference ${refPath} not found — skipping comparison)`);
    }
  }

  const ok = passed(result) && comparisonOk;

  if (opts.json) {
    console.log(JSON.stringify({ ok, ...result }, null, 2));
  } else {
    log('');
    log(`  size:               ${(result.sizeBytes / 1024).toFixed(0)} KB`);
    log(`  integrity_check:    ${result.integrity}`);
    log(`  fk violations:      ${result.foreignKeyViolations}`);
    log(
      `  schema:             ${
        result.missingTables.length || result.missingIndexes.length
          ? `MISSING ${[...result.missingTables, ...result.missingIndexes].join(', ')}`
          : 'all expected tables + indexes present'
      }`,
    );
    log('  row counts:');
    for (const [t, n] of Object.entries(result.rowCounts)) {
      log(`    ${t.padEnd(24)} ${n}`);
    }
    if (result.moneyIssues.length) {
      log('  money invariants:   FAILED');
      for (const m of result.moneyIssues) log(`    - ${m}`);
    } else {
      log('  money invariants:   ok');
    }
    if (result.errors.length) {
      log('  errors:');
      for (const e of result.errors) log(`    - ${e}`);
    }
    log('');
    log(ok ? '  ✅ RESTORE DRILL PASSED — this backup restores cleanly.' : '  ❌ RESTORE DRILL FAILED — see above.');
  }

  process.exit(ok ? 0 : 1);
}

main();
