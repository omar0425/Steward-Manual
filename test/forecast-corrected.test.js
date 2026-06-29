'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCorrectedDebtSeries,
  correctedDebtSnapshots,
} = require('../services/climbMetrics');
const { monthlyPaydownSamples, monteCarloPayoff } = require('../services/forecast');

// Per-account history for a user who, during setup, ENTERED a debt they always
// had (account 'b', a forgotten debt) one pull after starting. Account 'a' is
// being paid down $1,000/month the whole time.
//
//   raw aggregate debt_remaining: 50000 → 73153 → 72153 → 71153
//                                         ^ +23,153 jump = 'b' being entered
//   corrected debt:               74153 → 73153 → 72153 → 71153  (steady paydown)
//
// This mirrors the production report: total debt appeared to go UP during setup
// because accounts were being added, not because spending grew.
const MONTH = 30.44 * 86400000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const HISTORY = [
  { accountId: 'a', recordedAt: new Date(T0).toISOString(),            balance: 50000 },
  { accountId: 'a', recordedAt: new Date(T0 + 1 * MONTH).toISOString(), balance: 49000 },
  { accountId: 'b', recordedAt: new Date(T0 + 1 * MONTH).toISOString(), balance: 24153 }, // forgotten debt entered
  { accountId: 'a', recordedAt: new Date(T0 + 2 * MONTH).toISOString(), balance: 48000 },
  { accountId: 'b', recordedAt: new Date(T0 + 2 * MONTH).toISOString(), balance: 24153 },
  { accountId: 'a', recordedAt: new Date(T0 + 3 * MONTH).toISOString(), balance: 47000 },
  { accountId: 'b', recordedAt: new Date(T0 + 3 * MONTH).toISOString(), balance: 24153 },
];

// Raw aggregate snapshots (newest-first) the OLD forecast fed on — the 'b'
// entry shows up as a one-time $23k "debt growth" spike.
const RAW_SNAPSHOTS = [
  { pulled_at: new Date(T0 + 3 * MONTH).toISOString(), debt_remaining: 71153 },
  { pulled_at: new Date(T0 + 2 * MONTH).toISOString(), debt_remaining: 72153 },
  { pulled_at: new Date(T0 + 1 * MONTH).toISOString(), debt_remaining: 73153 },
  { pulled_at: new Date(T0).toISOString(),             debt_remaining: 50000 },
];

test('correctedDebtSnapshots: newest-first {pulled_at, debt_remaining} from the corrected series', () => {
  const snaps = correctedDebtSnapshots(HISTORY, { gameStartAt: new Date(T0).toISOString() });
  assert.equal(snaps.length, 4);
  // newest-first
  assert.ok(snaps[0].pulled_at > snaps[snaps.length - 1].pulled_at);
  assert.equal(snaps[0].debt_remaining, 71153); // latest = real current debt
  assert.equal(snaps[snaps.length - 1].debt_remaining, 74153); // forgotten debt carried back, no spike
});

test('regression: raw aggregate history poisons the forecast (the reported bug)', () => {
  const samples = monthlyPaydownSamples(RAW_SNAPSHOTS);
  // The setup spike makes one sample hugely negative, dragging the mean below 0.
  assert.ok(samples.some((s) => s < -1000), 'a setup-add interval reads as massive debt growth');
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  assert.ok(mean <= 0, 'mean pace is non-positive → no honest forecast');
  const r = monteCarloPayoff(71153, samples, { now: T0 + 3 * MONTH });
  assert.equal(r.ready, false, 'old behavior: forecast refuses (or, with worse data, lands decades out)');
});

test('fix: corrected history yields a clean positive pace and a realistic date', () => {
  const snaps = correctedDebtSnapshots(HISTORY, { gameStartAt: new Date(T0).toISOString() });
  const samples = monthlyPaydownSamples(snaps);
  assert.equal(samples.length, 3);
  for (const s of samples) assert.ok(Math.abs(s - 1000) < 1, 'every interval ≈ $1,000/mo paydown');
  const r = monteCarloPayoff(71153, samples, { now: T0 + 3 * MONTH, runs: 500, rng: () => 0 });
  assert.equal(r.ready, true);
  // ~71,153 / 1,000 ≈ 71 months, NOT a multi-decade horizon.
  assert.ok(r.medianMonths > 60 && r.medianMonths < 80, `median ${r.medianMonths} months is realistic`);
  assert.ok(r.medianDate);
});

test('a genuinely-new loan (origin "new") still registers as real debt growth', () => {
  // Same data, but 'b' is a new loan taken on, not a forgotten debt.
  const snaps = correctedDebtSnapshots(HISTORY, {
    gameStartAt: new Date(T0).toISOString(),
    originById: { b: 'new' },
  });
  // corrected: 50000 → 73153 (loan appears) → 72153 → 71153
  const samples = monthlyPaydownSamples(snaps);
  assert.ok(samples.some((s) => s < 0), 'real new borrowing is not hidden — it is a true negative month');
});

test('correctedDebtSnapshots: empty history → empty (callers fall back to raw)', () => {
  assert.deepEqual(correctedDebtSnapshots([], {}), []);
});
