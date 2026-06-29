'use strict';

/**
 * Backup restore drill — proves a backup can actually be recovered, instead of
 * assuming it. Two modes:
 *
 *   node scripts/restore-drill.js
 *     FRESH mode: snapshot the LIVE DB via `VACUUM INTO`, open the copy, and
 *     verify it passes integrity + foreign-key checks, has the full schema, and
 *     round-trips every key table's row count EXACTLY. This is the one to cron.
 *
 *   node scripts/restore-drill.js <path/to/backup.db>
 *     FILE mode: drill a specific backup file (e.g. one pulled off-box). Verifies
 *     integrity + schema and prints its row counts (no live comparison — a
 *     historical backup legitimately differs from current live).
 *
 * Exit code 0 = PASS, 1 = a check FAILED (so a scheduler can alert), 2 = setup
 * error (missing file). The live DB is never modified; the temp copy is removed.
 *
 * Honors STEWARD_DB_PATH exactly like db.js, so it drills the real database.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIVE_DB_PATH = process.env.STEWARD_DB_PATH
  ? path.resolve(process.env.STEWARD_DB_PATH)
  : path.join(__dirname, '..', 'steward.db');

// Tables the app depends on (auth + game data). Restoring without one of these
// is a silent disaster, so their presence is a hard check.
const EXPECTED_TABLES = [
  'users', 'sessions', 'password_reset_tokens',
  'snapshots', 'config', 'debt_account_balances', 'debt_account_history',
];
const COUNT_TABLES = ['users', 'snapshots', 'config', 'debt_account_balances', 'debt_account_history'];

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); failures += 1; };

function openDb(p, readOnly) {
  // Prefer a read-only handle (never touches the source); fall back if this
  // node:sqlite build doesn't accept the option.
  try { return new DatabaseSync(p, readOnly ? { readOnly: true } : undefined); }
  catch { return new DatabaseSync(p); }
}
function tableSet(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
}
function rowCounts(db, tables) {
  const present = tableSet(db);
  const out = {};
  for (const t of tables) out[t] = present.has(t) ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : null;
  return out;
}

const fileArg = process.argv[2];
let restorePath;
let mode;
let cleanup = false;
let liveCounts = null;

if (fileArg) {
  mode = 'file';
  restorePath = path.resolve(fileArg);
  if (!fs.existsSync(restorePath)) {
    console.error(`[restore-drill] backup file not found: ${restorePath}`);
    process.exit(2);
  }
  console.log(`\n[restore-drill] FILE mode — drilling: ${restorePath}\n`);
} else {
  mode = 'fresh';
  if (!fs.existsSync(LIVE_DB_PATH)) {
    console.error(`[restore-drill] live DB not found: ${LIVE_DB_PATH}\n  Set STEWARD_DB_PATH to the database you want to drill.`);
    process.exit(2);
  }
  console.log(`\n[restore-drill] FRESH mode — backing up then restoring live DB: ${LIVE_DB_PATH}\n`);
  const live = openDb(LIVE_DB_PATH, true);
  liveCounts = rowCounts(live, COUNT_TABLES);
  restorePath = path.join(os.tmpdir(), `steward-drill-${process.pid}-${Date.now()}.db`);
  // VACUUM INTO writes a compact, consistent snapshot even mid-WAL — the exact
  // mechanism server.js uses for /admin/backup and the daily rotation.
  live.exec(`VACUUM INTO '${restorePath.replace(/'/g, "''")}'`);
  live.close();
  cleanup = true;
  ok(`backup written via VACUUM INTO (${fs.statSync(restorePath).size} bytes)`);
}

const fmt = (c) => COUNT_TABLES.map((t) => `${t}=${c[t]}`).join(', ');
let rdb = null;
try {
  // A corrupt/truncated file may open lazily and only throw on first use, so the
  // whole verification runs inside this guard — any throw becomes a clean failure.
  rdb = openDb(restorePath, true);

  // 1. Integrity.
  const integ = rdb.prepare('PRAGMA integrity_check').get();
  const integVal = integ && (integ.integrity_check || Object.values(integ)[0]);
  if (integVal === 'ok') ok('integrity_check: ok'); else fail(`integrity_check: ${integVal}`);

  // 2. Foreign keys.
  const fkProblems = rdb.prepare('PRAGMA foreign_key_check').all();
  if (!fkProblems || fkProblems.length === 0) ok('foreign_key_check: clean');
  else fail(`foreign_key_check: ${fkProblems.length} violation(s)`);

  // 3. Schema completeness.
  const present = tableSet(rdb);
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length === 0) ok(`schema: all ${EXPECTED_TABLES.length} expected tables present`);
  else fail(`schema: missing table(s): ${missing.join(', ')}`);

  // 4. Row counts.
  const restoredCounts = rowCounts(rdb, COUNT_TABLES);
  if (mode === 'fresh') {
    let mismatch = false;
    for (const t of COUNT_TABLES) {
      if (liveCounts[t] !== restoredCounts[t]) {
        fail(`row-count mismatch in ${t}: live=${liveCounts[t]} restored=${restoredCounts[t]}`);
        mismatch = true;
      }
    }
    if (!mismatch) ok(`row counts round-trip exactly: ${fmt(restoredCounts)}`);
  } else {
    console.log(`  • restored row counts: ${fmt(restoredCounts)}`);
  }
} catch (e) {
  fail(`restored copy is unreadable / not a valid database: ${e && e.message}`);
} finally {
  try { if (rdb) rdb.close(); } catch { /* ignore */ }
  if (cleanup) { try { fs.unlinkSync(restorePath); } catch { /* best effort */ } }
}

if (failures > 0) {
  console.error(`\n[restore-drill] FAILED (${failures}) — this backup is NOT safe to rely on. Investigate before trusting recovery.\n`);
  process.exit(1);
}
console.log('\n[restore-drill] PASSED — backup opens, passes integrity, has the full schema, and round-trips the data.\n');
process.exit(0);
