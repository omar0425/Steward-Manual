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
