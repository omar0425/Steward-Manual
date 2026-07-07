'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectDebtFree, paidThisMonth, DAYS_PER_MONTH } = require('../services/pace');

const NOW = new Date('2026-06-20T12:00:00Z').getTime();

test('projectDebtFree: returns a future date from a positive pace', () => {
  const r = projectDebtFree([], 5000, { monthlyPace: 500, now: NOW });
  assert.equal(r.onTrack, true);
  assert.equal(r.monthsToZero, 10); // 5000 / 500
  const expected = new Date(NOW + 10 * DAYS_PER_MONTH * 86400000).toISOString().slice(0, 10);
  assert.equal(r.debtFreeDate, expected);
});

test('projectDebtFree: no usable pace → not on track, no invented date', () => {
  const r = projectDebtFree([{ pulled_at: '2026-06-01T00:00:00Z', debt_remaining: 5000 }], 5000, { now: NOW });
  assert.equal(r.onTrack, false);
  assert.equal(r.reason, 'no_pace');
  assert.equal(r.debtFreeDate, undefined);
});

test('projectDebtFree: monthsToZero label agrees with debtFreeDate (no ceil inflation)', () => {
  // 101 / 100 = 1.01 months — the date lands ~31 days out, so the label must
  // say 1 month, not 2 (ceil used to inflate it a full month past the date).
  const r = projectDebtFree([], 101, { monthlyPace: 100, now: NOW });
  assert.equal(r.onTrack, true);
  assert.equal(r.monthsToZero, 1);
  const expected = new Date(NOW + 1.01 * DAYS_PER_MONTH * 86400000).toISOString().slice(0, 10);
  assert.equal(r.debtFreeDate, expected);
  // Tiny remainders still round up to the ≥1 floor rather than "0 months".
  const tiny = projectDebtFree([], 30, { monthlyPace: 100, now: NOW });
  assert.equal(tiny.monthsToZero, 1);
});

test('projectDebtFree: zero debt → already free', () => {
  const r = projectDebtFree([], 0, { monthlyPace: 500, now: NOW });
  assert.equal(r.onTrack, true);
  assert.equal(r.alreadyFree, true);
  assert.equal(r.monthsToZero, 0);
});

test('projectDebtFree: absurd horizon is refused', () => {
  const r = projectDebtFree([], 1000000, { monthlyPace: 10, now: NOW });
  assert.equal(r.onTrack, false);
  assert.equal(r.reason, 'too_far');
});

test('paidThisMonth: opening balance is the last snapshot before the 1st', () => {
  const snaps = [
    { pulled_at: '2026-06-15T12:00:00Z', debt_remaining: 8000 },
    { pulled_at: '2026-06-05T12:00:00Z', debt_remaining: 9000 },
    { pulled_at: '2026-05-28T12:00:00Z', debt_remaining: 10000 },
  ];
  assert.equal(paidThisMonth(snaps, { now: NOW }), 2000); // 10000 - 8000
});

test('paidThisMonth: negative when debt grew this month', () => {
  const snaps = [
    { pulled_at: '2026-06-15T12:00:00Z', debt_remaining: 10500 },
    { pulled_at: '2026-05-30T12:00:00Z', debt_remaining: 10000 },
  ];
  assert.equal(paidThisMonth(snaps, { now: NOW }), -500);
});

test('paidThisMonth: climb started this month → opening is earliest in-month reading', () => {
  const snaps = [
    { pulled_at: '2026-06-18T12:00:00Z', debt_remaining: 9000 },
    { pulled_at: '2026-06-02T12:00:00Z', debt_remaining: 12000 },
  ];
  assert.equal(paidThisMonth(snaps, { now: NOW }), 3000); // 12000 - 9000
});

test('paidThisMonth: no snapshots → null', () => {
  assert.equal(paidThisMonth([], { now: NOW }), null);
});

const { averageMonthlyPaydown, suggestedMonthlyTarget } = require('../services/pace');

test('suggestedMonthlyTarget: ~2% of balance, rounded, scales with debt', () => {
  assert.equal(suggestedMonthlyTarget(77000), 1550); // 2% = 1540 → round to $25
  assert.equal(suggestedMonthlyTarget(10000), 200);  // 2% = 200
  assert.equal(suggestedMonthlyTarget(1000), 50);    // 2% = 20 → floored at 50
  assert.equal(suggestedMonthlyTarget(0), null);
  assert.equal(suggestedMonthlyTarget(-5), null);
  // Bigger debt → bigger suggested monthly (so it scales / extends with debt).
  assert.ok(suggestedMonthlyTarget(150000) > suggestedMonthlyTarget(50000));
});

test('averageMonthlyPaydown: total cleared / months since start', () => {
  // $1,713 cleared, started 32 days before NOW → ~1.05 months → ~$1,629/mo.
  const start = new Date(NOW - 32 * 86400000).toISOString();
  const avg = averageMonthlyPaydown(1713, start, { now: NOW });
  const months = 32 / DAYS_PER_MONTH;
  assert.equal(avg, Math.round((1713 / months) * 100) / 100);
});

test('averageMonthlyPaydown: too early (< 14 days) → null', () => {
  const start = new Date(NOW - 5 * 86400000).toISOString();
  assert.equal(averageMonthlyPaydown(500, start, { now: NOW }), null);
});

test('averageMonthlyPaydown: no progress or bad input → null', () => {
  const start = new Date(NOW - 60 * 86400000).toISOString();
  assert.equal(averageMonthlyPaydown(0, start, { now: NOW }), null);
  assert.equal(averageMonthlyPaydown(1000, null, { now: NOW }), null);
});
