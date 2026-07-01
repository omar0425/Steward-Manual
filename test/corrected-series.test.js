'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCorrectedDebtSeries, removalSafeStreakSeries, computeStreak } = require('../services/climbMetrics');

// Two accounts present from the start, one forgotten account logged late.
const HISTORY = [
  { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 1000 },
  { accountId: 'b', recordedAt: '2026-01-01T00:00:00Z', balance: 500 },
  { accountId: 'a', recordedAt: '2026-02-01T00:00:00Z', balance: 900 },  // paid 100
  { accountId: 'b', recordedAt: '2026-02-01T00:00:00Z', balance: 500 },
  { accountId: 'a', recordedAt: '2026-03-01T00:00:00Z', balance: 900 },
  { accountId: 'b', recordedAt: '2026-03-01T00:00:00Z', balance: 500 },
  { accountId: 'c', recordedAt: '2026-03-01T00:00:00Z', balance: 2000 }, // appears late
];

test('forgotten debt is carried back — no spike, line starts at the full total', () => {
  // 'c' has no origin → treated as always-yours → carried back to its first balance.
  const series = buildCorrectedDebtSeries(HISTORY, { gameStartAt: '2026-01-01T00:00:00Z' });
  assert.equal(series.length, 3);
  assert.equal(series[0].debt, 1000 + 500 + 2000, 'c counted from day one (3500)');
  assert.equal(series[1].debt, 900 + 500 + 2000, '3400 after $100 paydown');
  assert.equal(series[2].debt, 900 + 500 + 2000, '3400');
  // Monotonic-ish: never jumps UP when the forgotten account appears.
  assert.ok(series[1].debt <= series[0].debt);
});

test('a genuinely-new loan (origin "new") shows as a rise when taken on', () => {
  const series = buildCorrectedDebtSeries(HISTORY, {
    gameStartAt: '2026-01-01T00:00:00Z',
    originById: { c: 'new' },
  });
  assert.equal(series[0].debt, 1000 + 500, 'c not owed yet → 1500');
  assert.equal(series[1].debt, 900 + 500, '1400');
  assert.equal(series[2].debt, 900 + 500 + 2000, 'new loan appears → rises to 3400');
  assert.ok(series[2].debt > series[1].debt, 'real new debt is visible as a rise');
});

test('removed account counts while active, then drops (no carry-forward double-count)', () => {
  const h = [
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 1000 },
    { accountId: 'b', recordedAt: '2026-01-01T00:00:00Z', balance: 800 },
    { accountId: 'a', recordedAt: '2026-02-01T00:00:00Z', balance: 700 }, // b removed
  ];
  const series = buildCorrectedDebtSeries(h, { gameStartAt: '2026-01-01T00:00:00Z' });
  assert.equal(series[0].debt, 1000 + 800, 'b counts while it was tracked');
  assert.equal(series[1].debt, 700, 'b dropped after removal — latest total = real current debt');
});

test('gameStartAt filters pre-climb pulls', () => {
  const h = [
    { accountId: 'a', recordedAt: '2025-12-01T00:00:00Z', balance: 9999 }, // pre-climb
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 1000 },
  ];
  const series = buildCorrectedDebtSeries(h, { gameStartAt: '2026-01-01T00:00:00Z' });
  assert.equal(series.length, 1);
  assert.equal(series[0].debt, 1000);
});

test('empty history → empty series', () => {
  assert.deepEqual(buildCorrectedDebtSeries([], {}), []);
});

// ── removalSafeStreakSeries: streak immune to add/remove ────────────────────
test('removing an account does NOT count as a streak day', () => {
  const h = [
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 5000 },
    { accountId: 'b', recordedAt: '2026-01-01T00:00:00Z', balance: 5000 },
    { accountId: 'a', recordedAt: '2026-01-15T00:00:00Z', balance: 5000 }, // b removed, a unchanged
  ];
  const series = removalSafeStreakSeries(h);
  // Only 'a' is common across both pulls and it didn't move → no decrease.
  assert.equal(series.length, 2);
  assert.equal(series[0].debt_remaining, series[1].debt_remaining, 'removal is not a drop');
  assert.equal(computeStreak(series).current, 0, 'no fake streak from removal');
});

test('a real paydown on a continuing account DOES count as a streak day', () => {
  const h = [
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 5000 },
    { accountId: 'b', recordedAt: '2026-01-01T00:00:00Z', balance: 5000 },
    { accountId: 'a', recordedAt: '2026-01-15T00:00:00Z', balance: 4000 }, // paid 1000
    { accountId: 'b', recordedAt: '2026-01-15T00:00:00Z', balance: 5000 },
  ];
  const series = removalSafeStreakSeries(h);
  assert.ok(series[0].debt_remaining < series[1].debt_remaining, 'real paydown shows as a drop');
  assert.equal(computeStreak(series).current, 1, 'genuine paydown counts');
});

test('a first-sighting (added) account does NOT break a streak', () => {
  const h = [
    { accountId: 'a', recordedAt: '2026-01-01T00:00:00Z', balance: 5000 },
    { accountId: 'a', recordedAt: '2026-01-15T00:00:00Z', balance: 4000 }, // paid 1000
    { accountId: 'c', recordedAt: '2026-01-15T00:00:00Z', balance: 3000 }, // appears now
  ];
  const series = removalSafeStreakSeries(h);
  // 'c' is new at t1 → excluded from the delta, so the $1000 paydown on 'a' stands.
  assert.ok(series[0].debt_remaining < series[1].debt_remaining, 'addition ignored, paydown stands');
  assert.equal(computeStreak(series).current, 1);
});
