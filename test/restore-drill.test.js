'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  EXPECTED_TABLES,
  compareCounts,
  createConsistentSnapshot,
  inspect,
} = require('../scripts/restore-drill');
const { withUser, setConfig } = require('../db');
const TEST_DB_PATH = path.resolve(process.env.STEWARD_DB_PATH);

test('restore drill: expected schema includes every current data table', () => {
  for (const table of ['app_meta', 'bug_reports', 'push_subscriptions']) {
    assert.ok(EXPECTED_TABLES.includes(table), `${table} is verified`);
  }
});

test('restore drill: fresh snapshot includes WAL writes and matches live exactly', () => {
  const live = TEST_DB_PATH;
  const copy = path.join(os.tmpdir(), `steward-restore-test-${process.pid}-${Date.now()}.db`);
  try {
    withUser(0, () => setConfig('restore_drill_wal_marker', 'present'));
    createConsistentSnapshot(live, copy);

    const restored = inspect(copy);
    const liveResult = inspect(live, { copy: false });
    assert.equal(restored.integrity, 'ok');
    assert.equal(liveResult.integrity, 'ok');
    assert.deepEqual(restored.errors, []);
    const openedCopy = new DatabaseSync(copy, { readOnly: true });
    try {
      const marker = openedCopy.prepare(
        `SELECT value FROM config WHERE key = 'restore_drill_wal_marker'`,
      ).get();
      assert.equal(marker.value, 'present', 'the consistent copy includes the latest live write');
    } finally {
      openedCopy.close();
    }
    assert.equal(compareCounts(restored, liveResult, () => {}, { exact: true }), true);

    withUser(0, () => setConfig('restore_drill_after_snapshot', 'newer'));
    const newerLive = inspect(live, { copy: false });
    assert.equal(compareCounts(restored, newerLive, () => {}, { exact: true }), false);
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${copy}${suffix}`); } catch { /* absent */ }
    }
  }
});
