'use strict';

/**
 * Prove that a Steward SQLite backup opens, contains the complete schema, and
 * passes integrity/data checks. With no file argument, create a fresh,
 * consistent snapshot of the live database and compare its row counts to the
 * live connection exactly. The live file is never replaced or modified.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPECTED_TABLES = [
  'users',
  'sessions',
  'password_reset_tokens',
  'snapshots',
  'debt_account_balances',
  'debt_account_history',
  'config',
  'app_meta',
  'push_subscriptions',
  'bug_reports',
];
const EXPECTED_INDEXES = ['idx_password_reset_tokens_user'];

function parseArgs(argv) {
  const opts = { backup: null, compare: null, json: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--compare') opts.compare = argv[++i] || null;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (!opts.backup) opts.backup = arg;
  }
  return opts;
}

function liveDbPath() {
  return process.env.STEWARD_DB_PATH
    ? path.resolve(process.env.STEWARD_DB_PATH)
    : path.join(__dirname, '..', 'steward.db');
}

function backupSearchDirs() {
  const dirs = [];
  const userHome = process.env.USERPROFILE || os.homedir();
  if (userHome) dirs.push(path.join(userHome, 'StewardBackups'));
  dirs.push(path.join(path.dirname(liveDbPath()), 'backups'));
  return dirs;
}

function findLatestBackup() {
  const candidates = [];
  for (const dir of backupSearchDirs()) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^steward-.*\.db$/.test(file)) continue;
      const full = path.join(dir, file);
      try {
        candidates.push({ full, mtime: fs.statSync(full).mtimeMs });
      } catch {
        // File disappeared between listing and stat.
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? candidates[0].full : null;
}

function uniqueTempPath(label = 'copy') {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return path.join(os.tmpdir(), `steward-restore-drill-${label}-${nonce}.db`);
}

function removeSqliteFiles(dbFile) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbFile}${suffix}`);
    } catch {
      // Already absent.
    }
  }
}

function createConsistentSnapshot(sourceFile, destFile) {
  if (!fs.existsSync(sourceFile)) throw new Error(`Live database not found: ${sourceFile}`);
  removeSqliteFiles(destFile);
  const db = new DatabaseSync(sourceFile);
  try {
    const quoted = destFile.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${quoted}'`);
  } finally {
    db.close();
  }
}

function emptyResult(dbFile) {
  return {
    file: dbFile,
    sizeBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
    integrity: null,
    foreignKeyViolations: null,
    missingTables: [],
    missingIndexes: [],
    rowCounts: {},
    moneyIssues: [],
    errors: [],
  };
}

function inspectOpenDatabase(db, result) {
  const integrityRows = db.prepare('PRAGMA integrity_check').all();
  result.integrity = integrityRows.map((row) => row.integrity_check).join('; ');
  const fkRows = db.prepare('PRAGMA foreign_key_check').all();
  result.foreignKeyViolations = fkRows.length;
  if (fkRows.length) result.errors.push(`${fkRows.length} foreign-key violation(s)`);

  const tableNames = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  const indexNames = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name),
  );
  for (const table of EXPECTED_TABLES) {
    if (!tableNames.has(table)) result.missingTables.push(table);
  }
  for (const index of EXPECTED_INDEXES) {
    if (!indexNames.has(index)) result.missingIndexes.push(index);
  }
  for (const table of EXPECTED_TABLES) {
    if (tableNames.has(table)) {
      result.rowCounts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    }
  }

  if (tableNames.has('snapshots')) {
    const invalid = db.prepare(
      `SELECT COUNT(*) AS n FROM snapshots
       WHERE debt_remaining < 0 OR total_debt < 0 OR total_assets < 0
          OR debt_remaining IS NULL OR total_debt IS NULL OR total_assets IS NULL`,
    ).get().n;
    if (invalid > 0) result.moneyIssues.push(`${invalid} snapshot row(s) with negative/null debt or assets`);
  }

  if (tableNames.has('config')) {
    const rows = db.prepare(
      `SELECT user_id, key, value FROM config
       WHERE key IN (
         'climb_baseline_debt',
         'cumulative_paid_down',
         'cumulative_new_debt_added',
         'cumulative_interest_accrued'
       )`,
    ).all();
    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, {});
      byUser.get(row.user_id)[row.key] = Number(row.value);
    }
    for (const [userId, climb] of byUser) {
      for (const key of [
        'climb_baseline_debt',
        'cumulative_paid_down',
        'cumulative_new_debt_added',
        'cumulative_interest_accrued',
      ]) {
        const value = climb[key];
        if (value != null && (!Number.isFinite(value) || value < 0)) {
          result.moneyIssues.push(`user ${userId}: ${key} is invalid (${String(value)})`);
        }
      }
    }
  }
}

function inspect(dbFile, { copy = true } = {}) {
  const result = emptyResult(dbFile);
  const openedFile = copy ? uniqueTempPath('inspect') : dbFile;
  try {
    if (copy) fs.copyFileSync(dbFile, openedFile);
    const db = new DatabaseSync(openedFile, { readOnly: true });
    try {
      inspectOpenDatabase(db, result);
    } finally {
      db.close();
    }
  } catch (error) {
    result.errors.push(error && error.message ? error.message : String(error));
  } finally {
    if (copy) removeSqliteFiles(openedFile);
  }
  return result;
}

function passed(result) {
  return (
    result.errors.length === 0
    && result.integrity === 'ok'
    && result.foreignKeyViolations === 0
    && result.missingTables.length === 0
    && result.missingIndexes.length === 0
    && result.moneyIssues.length === 0
  );
}

function compareCounts(current, reference, log = () => {}, { exact = false } = {}) {
  log('\nComparison vs reference:');
  let ok = true;
  for (const table of EXPECTED_TABLES) {
    const currentCount = current.rowCounts[table];
    const referenceCount = reference.rowCounts[table];
    if (currentCount == null || referenceCount == null) continue;
    const delta = currentCount - referenceCount;
    let warning = '';
    if (exact && delta !== 0) {
      warning = '  MISMATCH';
      ok = false;
    } else if (
      !exact
      && ['users', 'snapshots', 'debt_account_history'].includes(table)
      && referenceCount >= 4
      && currentCount < referenceCount * 0.5
    ) {
      warning = '  dropped more than 50%';
      ok = false;
    }
    log(
      `  ${table.padEnd(24)} ${String(currentCount).padStart(7)}`
      + `  (ref ${referenceCount}, delta ${delta >= 0 ? '+' : ''}${delta})${warning}`,
    );
  }
  return ok;
}

function printResult(result, ok, log) {
  log('');
  log(`  size:               ${(result.sizeBytes / 1024).toFixed(0)} KB`);
  log(`  integrity_check:    ${result.integrity}`);
  log(`  fk violations:      ${result.foreignKeyViolations}`);
  const missing = [...result.missingTables, ...result.missingIndexes];
  log(`  schema:             ${missing.length ? `MISSING ${missing.join(', ')}` : 'all expected tables + indexes present'}`);
  log('  row counts:');
  for (const [table, count] of Object.entries(result.rowCounts)) {
    log(`    ${table.padEnd(24)} ${count}`);
  }
  log(`  money invariants:   ${result.moneyIssues.length ? 'FAILED' : 'ok'}`);
  for (const issue of result.moneyIssues) log(`    - ${issue}`);
  for (const error of result.errors) log(`    - ${error}`);
  log('');
  log(ok ? '  RESTORE DRILL PASSED - this backup restores cleanly.' : '  RESTORE DRILL FAILED - do not rely on this backup.');
}

function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const log = (...args) => {
    if (!opts.quiet) console.log(...args);
  };
  if (opts.help) {
    console.log('Usage: node scripts/restore-drill.js [backup.db|latest] [--compare ref.db|live] [--json] [--quiet]');
    return 0;
  }

  const freshMode = !opts.backup;
  const liveFile = liveDbPath();
  let drilledFile = null;
  let cleanupFresh = false;

  try {
    if (freshMode) {
      drilledFile = uniqueTempPath('fresh');
      createConsistentSnapshot(liveFile, drilledFile);
      cleanupFresh = true;
      log(`[restore-drill] Created a consistent throwaway snapshot of:\n  ${liveFile}`);
    } else if (opts.backup === 'latest') {
      drilledFile = findLatestBackup();
      if (!drilledFile) throw new Error(`No backup found in:\n  ${backupSearchDirs().join('\n  ')}`);
      log(`[restore-drill] Restoring a throwaway copy of:\n  ${drilledFile}`);
    } else {
      drilledFile = path.resolve(opts.backup);
      if (!fs.existsSync(drilledFile)) throw new Error(`Backup not found: ${drilledFile}`);
      log(`[restore-drill] Restoring a throwaway copy of:\n  ${drilledFile}`);
    }

    const result = inspect(drilledFile);
    let comparisonOk = true;
    const compareArg = freshMode ? 'live' : opts.compare;
    if (compareArg) {
      const referenceFile = compareArg === 'live' ? liveFile : path.resolve(compareArg);
      if (!fs.existsSync(referenceFile)) throw new Error(`Reference database not found: ${referenceFile}`);
      const reference = inspect(referenceFile, { copy: compareArg !== 'live' });
      result.reference = referenceFile;
      if (!passed(reference)) {
        result.errors.push('reference database failed its own integrity/schema checks');
        comparisonOk = false;
      } else {
        comparisonOk = compareCounts(result, reference, log, { exact: freshMode });
        if (!comparisonOk) result.errors.push(freshMode
          ? 'fresh snapshot row counts did not exactly match live'
          : 'row counts shrank suspiciously vs reference');
      }
    }

    const ok = passed(result) && comparisonOk;
    if (opts.json) console.log(JSON.stringify({ ok, freshMode, ...result }, null, 2));
    else printResult(result, ok, log);
    return ok ? 0 : 1;
  } catch (error) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, freshMode, error: error.message }, null, 2));
    } else {
      console.error(`[restore-drill] ${error.message}`);
    }
    return 2;
  } finally {
    if (cleanupFresh && drilledFile) removeSqliteFiles(drilledFile);
  }
}

if (require.main === module) process.exit(run());

module.exports = {
  EXPECTED_TABLES,
  compareCounts,
  createConsistentSnapshot,
  inspect,
  parseArgs,
  passed,
  run,
};
