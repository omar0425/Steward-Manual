'use strict';

// Pure payoff amortization shared with the client "what if" slider.
// The module is browser ESM — load it via dynamic import.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'payoff-math.js')).href;

test('simulatePayoff: zero-APR math is exact', async () => {
  const { simulatePayoff } = await import(MOD_URL);
  const r = simulatePayoff(1000, 0, 100);
  assert.equal(r.months, 10);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.cleared, true);
});

test('simulatePayoff: interest extends the plan and is accounted', async () => {
  const { simulatePayoff } = await import(MOD_URL);
  const r = simulatePayoff(10000, 24, 500);
  assert.ok(r.cleared);
  assert.ok(r.months > 20, `24% APR must extend past the 20 zero-interest months (got ${r.months})`);
  assert.ok(r.totalInterest > 0);
  // Sanity: total paid ≈ principal + interest (within one final-payment rounding)
  const totalPaid = r.months * 500;
  assert.ok(totalPaid >= 10000 + r.totalInterest - 500, 'payments must cover principal + interest');
});

test('simulatePayoff: payment that loses to interest never clears', async () => {
  const { simulatePayoff } = await import(MOD_URL);
  // 10000 at 24% accrues $200/mo — a $150 payment goes backwards forever.
  const r = simulatePayoff(10000, 24, 150);
  assert.equal(r.months, null);
  assert.equal(r.cleared, false);
});

test('simulatePayoff: degenerate inputs', async () => {
  const { simulatePayoff } = await import(MOD_URL);
  assert.equal(simulatePayoff(0, 20, 100).months, 0);
  assert.equal(simulatePayoff(-5, 20, 100).months, 0);
  assert.equal(simulatePayoff(1000, 20, 0).months, null);
  assert.equal(simulatePayoff(NaN, 20, 100).months, null);
});

test('whatIfExtra: more payment → sooner and cheaper, monotonically', async () => {
  const { whatIfExtra } = await import(MOD_URL);
  const r = whatIfExtra(12000, 18, 400, 200);
  assert.ok(r, 'base plan is simulable');
  assert.ok(r.newMonths < r.baseMonths);
  assert.equal(r.monthsSooner, r.baseMonths - r.newMonths);
  assert.ok(r.interestSaved > 0);
  const more = whatIfExtra(12000, 18, 400, 500);
  assert.ok(more.newMonths <= r.newMonths, 'a bigger extra never finishes later');
  assert.ok(more.interestSaved >= r.interestSaved, 'a bigger extra never saves less');
});

test('whatIfExtra: zero extra is the identity', async () => {
  const { whatIfExtra } = await import(MOD_URL);
  const r = whatIfExtra(5000, 10, 250, 0);
  assert.equal(r.monthsSooner, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.baseMonths, r.newMonths);
});

test('whatIfExtra: unsimulable base plan returns null (never lies)', async () => {
  const { whatIfExtra } = await import(MOD_URL);
  assert.equal(whatIfExtra(10000, 24, 100, 50), null);
});

test('daysUntilDueDay: clamps short months and wraps year-end', async () => {
  const { daysUntilDueDay } = await import(MOD_URL);
  // From Feb 10 2026, a "31st" due day clamps to Feb 28 → 18 days.
  const feb10 = new Date(2026, 1, 10).getTime();
  assert.equal(daysUntilDueDay(31, feb10), 18);
  // Due day already passed this month → next month's occurrence.
  const jan20 = new Date(2026, 0, 20).getTime();
  assert.equal(daysUntilDueDay(5, jan20), 16); // Feb 5
  // Dec 30 → due day 15 wraps into January.
  const dec30 = new Date(2026, 11, 30).getTime();
  assert.equal(daysUntilDueDay(15, dec30), 16); // Jan 15
  // Due today → 0.
  const may12 = new Date(2026, 4, 12).getTime();
  assert.equal(daysUntilDueDay(12, may12), 0);
  assert.equal(daysUntilDueDay(0, may12), null);
  assert.equal(daysUntilDueDay(32, may12), null);
});
