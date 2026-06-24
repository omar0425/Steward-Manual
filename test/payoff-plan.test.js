'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayoffPlan, interestSavedSinceStart } = require('../services/payoffPlan');

test('avalanche targets the highest APR; snowball the smallest balance', () => {
  const plan = buildPayoffPlan([
    { id: 'a', name: 'Visa', balance: 5000, apr: 24.99 },
    { id: 'b', name: 'Car', balance: 1200, apr: 6.5 },
    { id: 'c', name: 'Store', balance: 800, apr: 19.99 },
  ]);
  assert.equal(plan.recommended, 'avalanche');
  assert.equal(plan.hasApr, true);
  assert.equal(plan.avalanche.target.name, 'Visa');
  assert.equal(plan.snowball.target.name, 'Store'); // $800 smallest
  // monthly interest on the avalanche target = 5000 * .2499 / 12
  assert.equal(plan.avalanche.monthlyInterest, round2(5000 * 0.2499 / 12));
});

function round2(n) { return Math.round(n * 100) / 100; }

test('no APRs known → recommends snowball, avalanche null', () => {
  const plan = buildPayoffPlan([
    { id: 'a', name: 'Visa', balance: 5000, apr: null },
    { id: 'b', name: 'Car', balance: 1200 },
  ]);
  assert.equal(plan.recommended, 'snowball');
  assert.equal(plan.hasApr, false);
  assert.equal(plan.avalanche, null);
  assert.equal(plan.snowball.target.name, 'Car');
});

test('zero balances are ignored; null when nothing is owed', () => {
  assert.equal(buildPayoffPlan([{ id: 'a', name: 'Paid', balance: 0, apr: 20 }]), null);
  assert.equal(buildPayoffPlan([]), null);
});

test('partial APRs: avalanche only considers accounts with a known APR', () => {
  const plan = buildPayoffPlan([
    { id: 'a', name: 'NoApr', balance: 10000, apr: null },
    { id: 'b', name: 'KnownApr', balance: 3000, apr: 15 },
  ]);
  assert.equal(plan.recommended, 'avalanche');
  assert.equal(plan.avalanche.target.name, 'KnownApr');
  assert.equal(plan.snowball.target.name, 'KnownApr'); // 3000 < 10000
});

test('interestSavedSinceStart: monthly interest reduction from paydown', () => {
  // $10,000 → $8,000 at 12% APR: monthly rate 1% → start $100/mo, now $80/mo.
  const r = interestSavedSinceStart([
    { apr: 12, startBalance: 10000, balance: 8000 },
    { apr: 0, startBalance: 5000, balance: 5000 },   // no APR → ignored
  ]);
  assert.equal(r.startMonthly, 100);
  assert.equal(r.currentMonthly, 80);
  assert.equal(r.savedMonthly, 20);
  assert.equal(r.savedAnnual, 240);
  assert.equal(r.hasApr, true);
});

test('interestSavedSinceStart: no APRs → zeros, hasApr false', () => {
  const r = interestSavedSinceStart([{ apr: null, startBalance: 9000, balance: 8000 }]);
  assert.equal(r.hasApr, false);
  assert.equal(r.savedMonthly, 0);
});

test('interestSavedSinceStart: balance grew → negative saved (honest)', () => {
  const r = interestSavedSinceStart([{ apr: 24, startBalance: 1000, balance: 2000 }]);
  assert.equal(r.savedMonthly < 0, true);
});
