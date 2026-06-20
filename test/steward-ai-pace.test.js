'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyPaceFromSnapshots } = require('../services/pace');
const { forecastTierDates } = require('../services/stewardAiContext');
const { hasDailyFraming } = require('../services/stewardAi');

// Snapshots are newest-first, matching recentSnapshots() ordering.
function snap(daysAgo, debt) {
  const t = Date.now() - daysAgo * 86400000;
  return { pulled_at: new Date(t).toISOString(), debt_remaining: debt };
}

test('monthlyPaceFromSnapshots: normal monthly cadence yields a sane rate', () => {
  // $1,000 paid over ~60 days => ~$500/month.
  const pace = monthlyPaceFromSnapshots([snap(1, 79000), snap(31, 79500), snap(61, 80000)]);
  assert.ok(pace > 450 && pace < 550, `expected ~500, got ${pace}`);
});

test('monthlyPaceFromSnapshots: clustered entries do NOT explode into a fantasy rate', () => {
  // Six entries within three days — the old per-day math turned this into
  // thousands per month. Span is under the gate, so we refuse to project.
  const clustered = [snap(0, 79000), snap(1, 79200), snap(2, 79500), snap(3, 80000)];
  assert.equal(monthlyPaceFromSnapshots(clustered), null);
});

test('monthlyPaceFromSnapshots: null when the balance did not fall', () => {
  assert.equal(monthlyPaceFromSnapshots([snap(1, 80000), snap(31, 80000)]), null);
  assert.equal(monthlyPaceFromSnapshots([snap(1, 80500), snap(31, 80000)]), null);
});

test('forecastTierDates: projects from a monthly pace, capped at ~2 years', () => {
  const out = forecastTierDates({ currentDebt: 9000, baseline: 9000, monthlyPace: 1000 });
  assert.ok(Array.isArray(out) && out.length >= 1);
  assert.ok(out[0].date && /^\d{4}-\d{2}-\d{2}$/.test(out[0].date));
});

test('forecastTierDates: empty when pace is null or non-positive', () => {
  assert.deepEqual(forecastTierDates({ currentDebt: 9000, baseline: 9000, monthlyPace: null }), []);
  assert.deepEqual(forecastTierDates({ currentDebt: 9000, baseline: 9000, monthlyPace: 0 }), []);
});

test('hasDailyFraming: catches daily phrasing, passes monthly prose', () => {
  assert.equal(hasDailyFraming('You are paying about $277 a day.'), true);
  assert.equal(hasDailyFraming('roughly $300/day toward the balance'), true);
  assert.equal(hasDailyFraming('Interest costs you daily.'), true);
  assert.equal(hasDailyFraming('You paid down $866 last month; about 7 years to clear.'), false);
});
