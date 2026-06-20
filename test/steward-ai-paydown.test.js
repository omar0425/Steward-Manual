'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paydownOverWindow } = require('../services/stewardAiContext');

// Snapshots are newest-first, matching recentSnapshots() ordering.
function snap(daysAgo, debt) {
  const t = Date.now() - daysAgo * 86400000;
  return { pulled_at: new Date(t).toISOString(), debt_remaining: debt };
}

test('paydownOverWindow: sums the whole balance drop, not one card', () => {
  // The user paid several cards over the month; total debt fell 80,000 → 79,000.
  // The most recent entry only nudged one card (last 2 days), but the monthly
  // figure must reflect the full 30-day drop across all cards.
  const snaps = [
    snap(1, 79000),   // latest entry (one card)
    snap(2, 79202),   // that card before the $202 payment
    snap(31, 80000),  // a month ago
  ];
  const res = paydownOverWindow(snaps, 30);
  assert.equal(res.paydown, 1000); // 80,000 - 79,000, NOT 202
});

test('paydownOverWindow: negative when the balance grew', () => {
  const snaps = [snap(1, 80500), snap(31, 80000)];
  const res = paydownOverWindow(snaps, 30);
  assert.equal(res.paydown, -500);
});

test('paydownOverWindow: falls back to oldest snapshot for a partial window', () => {
  // No snapshot is a full 30 days old; use the oldest we have and stay honest.
  const snaps = [snap(1, 78000), snap(10, 79000)];
  const res = paydownOverWindow(snaps, 30);
  assert.equal(res.paydown, 1000);
  assert.equal(res.fromDate, snaps[1].pulled_at.slice(0, 10));
});

test('paydownOverWindow: null without a second snapshot to compare', () => {
  assert.equal(paydownOverWindow([snap(1, 80000)], 30), null);
  assert.equal(paydownOverWindow([], 30), null);
});
