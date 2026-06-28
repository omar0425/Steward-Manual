'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyPaydownSamples, monteCarloPayoff, effectiveAnnualAprPct, DAYS_PER_MONTH } = require('../services/forecast');

const NOW = new Date('2026-06-20T12:00:00Z').getTime();

test('monthlyPaydownSamples: derives $/month rate from consecutive snapshots', () => {
  const older = NOW - DAYS_PER_MONTH * 86400000; // exactly one month earlier
  const snaps = [
    { pulled_at: new Date(NOW).toISOString(), debt_remaining: 9500 },
    { pulled_at: new Date(older).toISOString(), debt_remaining: 10000 },
  ];
  const s = monthlyPaydownSamples(snaps);
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0] - 500) < 0.5); // ~$500/month
});

test('monteCarloPayoff: already debt-free', () => {
  const r = monteCarloPayoff(0, [500, 400, 600], { now: NOW });
  assert.equal(r.ready, true);
  assert.equal(r.alreadyFree, true);
});

test('monteCarloPayoff: not enough history (<3 samples)', () => {
  const r = monteCarloPayoff(5000, [500, 400], { now: NOW });
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'not_enough_history');
});

test('monteCarloPayoff: no positive progress → not ready', () => {
  const r = monteCarloPayoff(5000, [-100, 0, -50], { now: NOW });
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'no_progress');
});

test('monteCarloPayoff: steady payer → ordered band, future dates, high odds', () => {
  // Every sample is $500/mo, debt $5,000 → 10 months, deterministically.
  const r = monteCarloPayoff(5000, [500, 500, 500], { now: NOW, runs: 500, rng: () => 0 });
  assert.equal(r.ready, true);
  assert.equal(r.medianMonths, 10);
  assert.ok(r.optimisticMonths <= r.medianMonths);
  assert.ok(r.medianMonths <= (r.conservativeMonths ?? Infinity));
  assert.equal(r.prob1yr, 100); // 10 months < 12
  assert.ok(r.medianDate > new Date(NOW).toISOString().slice(0, 10));
});

test('effectiveAnnualAprPct: balance-weighted average; 0 when no APRs', () => {
  // $1,000 @ 10% and $3,000 @ 30% → weighted 25%.
  assert.equal(effectiveAnnualAprPct([
    { balance: 1000, apr: 10 },
    { balance: 3000, apr: 30 },
  ]), 25);
  assert.equal(effectiveAnnualAprPct([{ balance: 5000, apr: 0 }]), 0);
  assert.equal(effectiveAnnualAprPct([]), 0);
});

test('monteCarloPayoff: with an APR, returns a remaining-interest band', () => {
  // $5,000 paid at a steady $500/mo over 10 months at 24% APR.
  const r = monteCarloPayoff(5000, [500, 500, 500], {
    now: NOW, runs: 300, rng: () => 0, annualAprPct: 24,
  });
  assert.equal(r.ready, true);
  assert.ok(r.remainingInterest);
  // Steady run → all sims identical, so low == median == high, and > 0.
  assert.ok(r.remainingInterest.median > 0);
  assert.equal(r.remainingInterest.low, r.remainingInterest.median);
  assert.equal(r.remainingInterest.high, r.remainingInterest.median);
  // "Tread water" baseline pays interest on the full balance the whole time, so
  // it must exceed the shrinking-balance path → positive projected savings.
  assert.ok(r.interestIfStatic > r.remainingInterest.median);
  assert.ok(r.interestSavedVsStatic > 0);
});

test('monteCarloPayoff: no APR → no interest band (back-compat)', () => {
  const r = monteCarloPayoff(5000, [500, 500, 500], { now: NOW, runs: 100, rng: () => 0 });
  assert.equal(r.ready, true);
  assert.equal(r.remainingInterest, undefined);
});

test('monteCarloPayoff: erratic payer can leave the conservative case open-ended', () => {
  // Mean positive but lots of negative months; with a tiny horizon some runs
  // never finish → conservative (p90) date may be null. Just assert it runs and
  // the probabilities are sane (0..100, non-decreasing across horizons).
  const seeded = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const r = monteCarloPayoff(8000, [900, -400, 700, -300, 600], { now: NOW, runs: 1000, rng: seeded });
  assert.equal(r.ready, true);
  assert.ok(r.prob1yr >= 0 && r.prob3yr <= 100);
  assert.ok(r.prob1yr <= r.prob2yr && r.prob2yr <= r.prob3yr);
});
