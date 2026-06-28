'use strict';

/**
 * Domain-sense invariants. These don't test a single function's mechanics — they
 * assert that the NUMBERS the UI shows always make human sense, so the class of
 * bug that produced "CLEAR $7,189 THIS MONTH" on a $77K balance can't come back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestedMonthlyTarget, projectDebtFree, DAYS_PER_MONTH } = require('../services/pace');
const { monteCarloPayoff } = require('../services/forecast');

const NOW = new Date('2026-06-20T12:00:00Z').getTime();
const DEBTS = [5000, 25000, 77000, 150000, 400000];

test('invariant: the suggested monthly ask is never a one-month payoff demand', () => {
  for (const d of DEBTS) {
    const m = suggestedMonthlyTarget(d);
    assert.ok(m != null && m > 0, `suggested for $${d} should be positive`);
    assert.ok(m < d, `suggested ($${m}) must be well below the balance ($${d})`);
    assert.ok(m <= d * 0.05, `suggested ($${m}) must be ≤5% of balance ($${d}) — not a sprint`);
    // At the suggested rate it should take many months, never ~one.
    assert.ok(d / m >= 12, `clearing $${d} at $${m}/mo should take ≥12 months, got ${(d / m).toFixed(1)}`);
  }
});

test('invariant: a projected debt-free date is always ≥1 month out and in the future', () => {
  for (const d of DEBTS) {
    const r = projectDebtFree([], d, { monthlyPace: suggestedMonthlyTarget(d), now: NOW });
    if (!r.onTrack) continue;
    assert.ok(r.monthsToZero >= 1, `monthsToZero must be ≥1, got ${r.monthsToZero}`);
    assert.ok(r.debtFreeDate > new Date(NOW).toISOString().slice(0, 10), 'date must be in the future');
  }
});

test('invariant: Monte Carlo bands are ordered and probabilities are sane', () => {
  const samples = [800, 600, 1000, 400, 700]; // mean positive, some variance
  const r = monteCarloPayoff(40000, samples, { now: NOW, runs: 1500, annualAprPct: 22 });
  assert.equal(r.ready, true);
  // Sooner ≤ likely ≤ later (months); conservative may be null (open-ended) but
  // if present must not be before the median.
  assert.ok(r.optimisticMonths <= r.medianMonths, 'optimistic ≤ median');
  assert.ok(r.medianMonths >= 1, 'median ≥ 1 month');
  if (r.conservativeMonths != null) assert.ok(r.conservativeMonths >= r.medianMonths, 'conservative ≥ median');
  // Probabilities are real percentages and non-decreasing across horizons.
  for (const p of [r.prob1yr, r.prob2yr, r.prob3yr]) assert.ok(p >= 0 && p <= 100, `prob in 0..100, got ${p}`);
  assert.ok(r.prob1yr <= r.prob2yr && r.prob2yr <= r.prob3yr, 'longer horizon ≥ shorter');
  // Interest band ordered and non-negative; treading water never "saves" money.
  assert.ok(r.remainingInterest.low <= r.remainingInterest.median, 'interest low ≤ median');
  assert.ok(r.remainingInterest.median <= r.remainingInterest.high, 'interest median ≤ high');
  assert.ok(r.remainingInterest.low >= 0, 'interest ≥ 0');
  assert.ok(r.interestSavedVsStatic >= 0, 'savings vs static ≥ 0');
});

test('invariant: no fantasy forecast without real positive progress', () => {
  // Flat history (no paydown) must NOT yield a payoff date.
  const flat = [{ pulled_at: new Date(NOW).toISOString(), debt_remaining: 9000 }];
  const r = projectDebtFree(flat, 9000, { now: NOW });
  assert.equal(r.onTrack, false);
  const mc = monteCarloPayoff(9000, [0, -10, 5], { now: NOW });
  assert.equal(mc.ready, false);
  // sanity: DAYS_PER_MONTH is a real month length (guards date math)
  assert.ok(DAYS_PER_MONTH > 28 && DAYS_PER_MONTH < 31);
});
