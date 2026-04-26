'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDebtSyncState, aggregateSumTolerance, sumMapValues } = require('../services/debtSyncValidation');

test('validateDebtSyncState: multiple accounts sum to aggregate', () => {
  const ynab = new Map([
    ['a', 1000.5],
    ['b', 2500.25],
    ['c', 100.0],
  ]);
  const stored = new Map(ynab);
  const agg = sumMapValues(ynab);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: agg,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, []);
});

test('validateDebtSyncState: aggregate vs per-account rounding within tolerance', () => {
  const ynab = new Map([
    ['x', 100.0],
    ['y', 200.0],
  ]);
  const stored = new Map(ynab);
  const rawAggregate = 300.008;
  const tol = aggregateSumTolerance(ynab.size);
  assert.ok(Math.abs(sumMapValues(ynab) - rawAggregate) <= tol);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: rawAggregate,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, true);
});

test('validateDebtSyncState: missing account (YNAB has id not in stored)', () => {
  const ynab = new Map([
    ['a', 100],
    ['b', 200],
  ]);
  const stored = new Map([['a', 100]]);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: 300,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, false);
  assert.ok(r.errors.some((e) => e.includes('missing account')));
});

test('validateDebtSyncState: ghost account (stored id not in YNAB)', () => {
  const ynab = new Map([['a', 100]]);
  const stored = new Map([
    ['a', 100],
    ['gone', 50],
  ]);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: 100,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, false);
  assert.ok(r.errors.some((e) => e.includes('ghost account')));
});

test('validateDebtSyncState: account removed — new map and aggregate align', () => {
  const ynab = new Map([['stay', 2000]]);
  const stored = new Map(ynab);
  const agg = 2000;
  const r = validateDebtSyncState({
    aggregateDebtRemaining: agg,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, true);
});

test('validateDebtSyncState: all accounts removed — empty map, aggregate 0', () => {
  const ynab = new Map();
  const stored = new Map();
  const r = validateDebtSyncState({
    aggregateDebtRemaining: 0,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, []);
});

test('validateDebtSyncState: first pull anchor — seeded map, no delta scenario still valid', () => {
  const ynab = new Map([
    ['cc1', 15000],
    ['loan1', 42000.5],
  ]);
  const stored = new Map(ynab);
  const agg = sumMapValues(ynab);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: agg,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, true);
});

test('validateDebtSyncState: negative stored balance fails', () => {
  const ynab = new Map([['a', 100]]);
  const stored = new Map([['a', -1]]);
  const r = validateDebtSyncState({
    aggregateDebtRemaining: 100,
    storedDebtByAccountId: stored,
    ynabDebtByAccountId: ynab,
  });
  assert.equal(r.isValid, false);
  assert.ok(r.errors.some((e) => e.includes('negative')));
});
