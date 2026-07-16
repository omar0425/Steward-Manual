'use strict';

/**
 * Strategy Lab engine tests — the promo-aware simulator and the LP-optimal
 * plan. The two load-bearing claims:
 *   1. With a promo-rate cliff ahead, promo-aware (and the LP) beat plain
 *      avalanche — avalanche only sees today's rates.
 *   2. Deferred-interest financing bills the waived pool when the deadline is
 *      missed, and strategies that clear it in time never pay it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  comparePayoffStrategies,
  simulateStrategy,
  normalizeAccounts,
  buildCplexLp,
} = require('../services/payoffOptimizer');

const START = new Date('2026-07-01T00:00:00Z');

// Four months out, the 0% promo card jumps to 29.99%. Plain avalanche chases
// the 12% card and walks blind into the cliff; promo-aware clears the promo
// balance just in time.
const CLIFF_ACCOUNTS = [
  { id: 'a', name: 'Big Slow Card', balance: 8000, apr: 12 },
  { id: 'b', name: 'Promo Card', balance: 1500, apr: 0 },
];
const CLIFF_TERMS = {
  b: { promoEndsOn: '2026-11-01', postPromoApr: 29.99 },
};

test('promo cliff: promo-aware and LP-optimal beat plain avalanche', () => {
  const cmp = comparePayoffStrategies(CLIFF_ACCOUNTS, CLIFF_TERMS, 500, START);
  assert.ok(cmp, 'comparison produced');
  const by = Object.fromEntries(cmp.strategies.map((s) => [s.strategy, s]));
  assert.ok(by.avalanche.debtFree, 'avalanche reaches debt-free');
  assert.ok(by['promo-aware'].debtFree, 'promo-aware reaches debt-free');
  // Avalanche hammers the 12% card and walks blind into the 29.99% cliff;
  // promo-aware clears the promo balance before the jump.
  assert.ok(
    by['promo-aware'].totalInterest < by.avalanche.totalInterest,
    `promo-aware (${by['promo-aware'].totalInterest}) should pay less interest than avalanche (${by.avalanche.totalInterest})`,
  );
  assert.ok(
    by['optimal-lp'].totalInterest <= by['promo-aware'].totalInterest + 1,
    `LP-optimal (${by['optimal-lp'].totalInterest}) should be at least as good as promo-aware (${by['promo-aware'].totalInterest})`,
  );
  // The cliff is surfaced to the UI.
  assert.equal(cmp.promoCliffs.length, 1);
  assert.equal(cmp.promoCliffs[0].id, 'b');
});

test('no promos: avalanche is already optimal, strategies agree', () => {
  const accounts = [
    { id: 'a', name: 'A', balance: 2000, apr: 25 },
    { id: 'b', name: 'B', balance: 4000, apr: 10 },
  ];
  const cmp = comparePayoffStrategies(accounts, {}, 400, START);
  const by = Object.fromEntries(cmp.strategies.map((s) => [s.strategy, s]));
  // Promo-aware degrades to plain avalanche without cliffs.
  assert.equal(by['promo-aware'].totalInterest, by.avalanche.totalInterest);
  // Snowball pays more here (it targets the small high-rate card FIRST only
  // by accident of size; make sizes adversarial): with the small balance also
  // the highest rate they coincide — so just sanity-check ordering exists.
  assert.ok(by.snowball.totalInterest >= by.avalanche.totalInterest - EPS_DOLLARS);
});
const EPS_DOLLARS = 0.02;

test('deferred interest: missing the deadline bills the waived pool; clearing in time avoids it', () => {
  const accounts = [
    { id: 'big', name: 'Big Slow Card', balance: 9000, apr: 18 },
    { id: 'bnpl', name: 'Deferred 0%', balance: 1200, apr: 0 },
  ];
  const terms = {
    bnpl: { promoEndsOn: '2026-11-01', postPromoApr: 26, deferredInterest: true },
  };
  // A generous budget clears the deferred card in time under promo-aware…
  const aware = simulateStrategy('promo-aware', normalizeAccounts(accounts, terms, START), 700);
  assert.equal(aware.deferredTriggered.length, 0, 'promo-aware clears the deferred card before the deadline');
  // …while avalanche (chasing the 18% card) walks into the retroactive bill.
  const ava = simulateStrategy('avalanche', normalizeAccounts(accounts, terms, START), 700);
  assert.equal(ava.deferredTriggered.length, 1, 'avalanche misses the deferred deadline');
  assert.equal(ava.deferredTriggered[0].id, 'bnpl');
  assert.ok(ava.deferredTriggered[0].amount > 0);
  assert.ok(aware.totalInterest < ava.totalInterest, 'dodging the retroactive bill saves real money');
});

test('starving budget: simulator reports not-debt-free instead of spinning', () => {
  const accounts = [{ id: 'a', name: 'A', balance: 50000, apr: 29.99 }];
  const sim = simulateStrategy('avalanche', normalizeAccounts(accounts, {}, START), 100);
  assert.equal(sim.debtFree, false);
  assert.equal(sim.months, null);
});

test('first-month allocation covers minimums then targets', () => {
  const accounts = [
    { id: 'a', name: 'A', balance: 1000, apr: 25 },
    { id: 'b', name: 'B', balance: 1000, apr: 5 },
  ];
  const terms = { a: { minPayment: 25 }, b: { minPayment: 25 } };
  const sim = simulateStrategy('avalanche', normalizeAccounts(accounts, terms, START), 300);
  const byId = Object.fromEntries(sim.firstMonth.map((p) => [p.id, p.amount]));
  assert.ok(byId.a >= 275 - 1, 'extra dollars go to the high-APR card');
  assert.equal(byId.b, 25, 'low-APR card gets its minimum only');
});

test('CPLEX LP export is well-formed and reflects the model', () => {
  const normalized = normalizeAccounts(CLIFF_ACCOUNTS, CLIFF_TERMS, START);
  const lp = buildCplexLp(normalized, 500, 12);
  assert.match(lp, /^\\ Steward Strategy Lab/, 'has the header comment');
  assert.match(lp, /Minimize/, 'has an objective section');
  assert.match(lp, /Subject To/, 'has constraints');
  assert.match(lp, /budget_0:/, 'has per-month budget constraints');
  assert.match(lp, /clear_0:/, 'has debt-free constraints');
  assert.match(lp, /pay_1_0/, 'has payment variables');
  assert.match(lp, /Bounds[\s\S]*0 <= pay_0_0/, 'declares non-negativity bounds');
  assert.match(lp, /End\s*$/, 'terminates properly');
});
