'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectedDebugDebtSync } = require('../services/debtSyncDebugApi');

test('projectedDebugDebtSync: no sync yet → sync_valid null, sync_errors []', () => {
  assert.deepEqual(projectedDebugDebtSync(null), { sync_valid: null, sync_errors: [] });
  assert.deepEqual(projectedDebugDebtSync(undefined), { sync_valid: null, sync_errors: [] });
});

test('projectedDebugDebtSync: successful validation', () => {
  const r = projectedDebugDebtSync({
    sync_valid: true,
    sync_errors: [],
  });
  assert.equal(r.sync_valid, true);
  assert.deepEqual(r.sync_errors, []);
});

test('projectedDebugDebtSync: failed validation', () => {
  const r = projectedDebugDebtSync({
    sync_valid: false,
    sync_errors: ['sum of stored balances (1) does not match aggregate debt (2); tolerance ±0.02'],
  });
  assert.equal(r.sync_valid, false);
  assert.ok(r.sync_errors.length > 0);
});

test('projectedDebugDebtSync: lastDebtSync exists but sync_valid missing → null (?? null)', () => {
  const r = projectedDebugDebtSync({ sync_errors: [] });
  assert.equal(r.sync_valid, null);
  assert.deepEqual(r.sync_errors, []);
});

test('projectedDebugDebtSync: sync_errors always an array (non-array ignored → [])', () => {
  const r = projectedDebugDebtSync({ sync_valid: true, sync_errors: 'bad' });
  assert.equal(r.sync_valid, true);
  assert.deepEqual(r.sync_errors, []);
});
