'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyDeltaToTotals,
  getClimbStatsFromConfig,
  KEY_LAST,
  roundMoney,
  summarizePerAccountDebtDeltas,
  analyzePerAccountDebtDiff,
  perAccountDebtDeltaDisplayRows,
} = require('../services/climbMetrics');
const { resetAllGameState, setConfig } = require('../db');

test('applyDeltaToTotals: paydown increases cumulative paid only', () => {
  const a = applyDeltaToTotals(100000, 95000, 0, 0);
  assert.equal(a.cumulativePaidDown, 5000);
  assert.equal(a.cumulativeNewDebtAdded, 0);
  assert.equal(a.last, 95000);
});

test('applyDeltaToTotals: new debt increases new-debt only', () => {
  const a = applyDeltaToTotals(95000, 110000, 5000, 0);
  assert.equal(a.cumulativePaidDown, 5000);
  assert.equal(a.cumulativeNewDebtAdded, 15000);
  assert.equal(a.last, 110000);
});

test('applyDeltaToTotals: monotonic — paydown never decreases cumulative paid', () => {
  let last = 100000;
  let paid = 0;
  let newD = 0;
  const steps = [98000, 120000, 115000, 90000];
  for (const d of steps) {
    const n = applyDeltaToTotals(last, d, paid, newD);
    paid = n.cumulativePaidDown;
    newD = n.cumulativeNewDebtAdded;
    last = n.last;
  }
  assert.ok(paid >= 20000);
  assert.ok(newD >= 20000);
  assert.equal(last, 90000);
});

test('applyDeltaToTotals: flat delta leaves totals unchanged', () => {
  const a = applyDeltaToTotals(50000, 50000, 1000, 2000);
  assert.equal(a.cumulativePaidDown, 1000);
  assert.equal(a.cumulativeNewDebtAdded, 2000);
});

test('getClimbStatsFromConfig: exposes last aggregate debt for aggregate-only pulls', () => {
  resetAllGameState();
  setConfig(KEY_LAST, '1234.56');
  const stats = getClimbStatsFromConfig();
  assert.equal(stats.lastAggregateDebt, 1234.56);
});

test('roundMoney: two decimal places', () => {
  assert.equal(roundMoney(10.999), 11);
  assert.equal(roundMoney(10.994), 10.99);
});

test('summarizePerAccountDebtDeltas: payment on existing account', () => {
  const prev = new Map([['a', 10000]]);
  const curr = new Map([['a', 8200]]);
  const s = summarizePerAccountDebtDeltas(prev, curr);
  assert.equal(s.paydownSum, 1800);
  assert.equal(s.newDebtSum, 0);
});

test('summarizePerAccountDebtDeltas: removed account is not paydown', () => {
  const prev = new Map([
    ['gone', 10000],
    ['stay', 2000],
  ]);
  const curr = new Map([['stay', 2000]]);
  const s = summarizePerAccountDebtDeltas(prev, curr);
  assert.equal(s.paydownSum, 0);
  assert.equal(s.newDebtSum, 0);
});

test('summarizePerAccountDebtDeltas: new account counts as new debt', () => {
  const prev = new Map([['a', 5000]]);
  const curr = new Map([
    ['a', 5000],
    ['b', 3000],
  ]);
  const s = summarizePerAccountDebtDeltas(prev, curr);
  assert.equal(s.paydownSum, 0);
  assert.equal(s.newDebtSum, 3000);
});

test('summarizePerAccountDebtDeltas: balance increase on existing account', () => {
  const prev = new Map([['a', 4000]]);
  const curr = new Map([['a', 5500]]);
  const s = summarizePerAccountDebtDeltas(prev, curr);
  assert.equal(s.paydownSum, 0);
  assert.equal(s.newDebtSum, 1500);
});

test('analyzePerAccountDebtDiff: same id unchanged balance (rename-only in YNAB) — no fake movement', () => {
  const prev = new Map([['id-1', 4200.12]]);
  const curr = new Map([['id-1', 4200.12]]);
  const a = analyzePerAccountDebtDiff(prev, curr);
  assert.equal(a.paydownSum, 0);
  assert.equal(a.newDebtSum, 0);
  assert.equal(a.accountsDecreasedCount, 0);
  assert.equal(a.accountsIncreasedCount, 0);
  assert.equal(a.accountsAddedCount, 0);
  assert.equal(a.accountsRemovedCount, 0);
});

test('analyzePerAccountDebtDiff: all debt accounts gone — no paydown from removals', () => {
  const prev = new Map([['a', 8000]]);
  const curr = new Map();
  const a = analyzePerAccountDebtDiff(prev, curr);
  assert.equal(a.paydownSum, 0);
  assert.equal(a.newDebtSum, 0);
  assert.equal(a.accountsRemovedCount, 1);
});

test('analyzePerAccountDebtDiff: previous empty, current has debt — all new (first real account)', () => {
  const prev = new Map();
  const curr = new Map([['newcard', 2500]]);
  const a = analyzePerAccountDebtDiff(prev, curr);
  assert.equal(a.paydownSum, 0);
  assert.equal(a.newDebtSum, 2500);
  assert.equal(a.accountsAddedCount, 1);
});

test('analyzePerAccountDebtDiff: refi-shaped same pull (old id out, new id in, same total)', () => {
  const prev = new Map([['old-loan', 10000]]);
  const curr = new Map([['new-loan', 10000]]);
  const a = analyzePerAccountDebtDiff(prev, curr);
  assert.equal(a.accountsRemovedCount, 1);
  assert.equal(a.accountsAddedCount, 1);
  assert.equal(a.paydownSum, 0);
  assert.equal(a.newDebtSum, 10000);
});

test('perAccountDebtDeltaDisplayRows: mixed paydown and new debt with names', () => {
  const prev = new Map([
    ['amex', 1000],
    ['disc', 2000],
    ['cap', 500],
  ]);
  const curr = new Map([
    ['amex', 1092],
    ['disc', 2062],
    ['cap', 484],
  ]);
  const accounts = [
    { id: 'amex', name: 'Amex' },
    { id: 'disc', name: 'Discover' },
    { id: 'cap', name: 'Capital One' },
  ];
  const rows = perAccountDebtDeltaDisplayRows(prev, curr, accounts);
  assert.equal(rows.length, 3);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.Amex.delta, 92);
  assert.equal(byName.Amex.kind, 'increased');
  assert.equal(byName.Discover.delta, 62);
  assert.equal(byName.Discover.kind, 'increased');
  assert.equal(byName['Capital One'].delta, -16);
  assert.equal(byName['Capital One'].kind, 'decreased');
});

test('perAccountDebtDeltaDisplayRows: kind new vs removed', () => {
  const prev = new Map([['gone', 400]]);
  const curr = new Map([['fresh', 250]]);
  const accounts = [{ id: 'fresh', name: 'Fresh Card' }];
  const rows = perAccountDebtDeltaDisplayRows(prev, curr, accounts);
  assert.equal(rows.length, 2);
  const kinds = Object.fromEntries(rows.map((r) => [r.name, r.kind]));
  assert.equal(kinds['Fresh Card'], 'new');
  assert.equal(kinds['Account (no longer tracked)'], 'removed');
});
