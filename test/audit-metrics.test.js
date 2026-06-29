'use strict';

/**
 * Tests for the metrics sanity auditor (scripts/audit-metrics.js). Pure — no DB.
 * Guards the two fixes: cumulative-probability monotonicity across 1/2/3yr, and
 * the forecast OK being scoped to its own section (not suppressed by an unrelated
 * earlier FAIL).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { runChecks } = require('../scripts/audit-metrics');

const hasFail = (findings, re) => findings.some((f) => f.level === 'FAIL' && re.test(f.msg));
const hasOk = (findings, re) => findings.some((f) => f.level === 'OK' && re.test(f.msg));

test('audit-metrics: a non-monotonic prob2yr is caught', () => {
  const findings = runChecks({
    stats: {
      debtRemaining: 10000,
      payoffForecast: {
        ready: true, optimisticMonths: 10, medianMonths: 20, conservativeMonths: 30,
        prob1yr: 80, prob2yr: 40, prob3yr: 90, // 40 < 80 → must FAIL
      },
    },
  });
  assert.ok(hasFail(findings, /prob2yr/), 'prob2yr dip below prob1yr should FAIL');
});

test('audit-metrics: monotonic probabilities pass', () => {
  const findings = runChecks({
    stats: {
      debtRemaining: 10000,
      payoffForecast: {
        ready: true, optimisticMonths: 10, medianMonths: 20, conservativeMonths: 30,
        prob1yr: 10, prob2yr: 20, prob3yr: 30,
      },
    },
  });
  assert.ok(!hasFail(findings, /prob/), 'ordered probabilities must not FAIL');
  assert.ok(hasOk(findings, /forecast band ordered/), 'a clean forecast emits its OK');
});

test('audit-metrics: forecast OK is not suppressed by an unrelated earlier FAIL', () => {
  const findings = runChecks({
    stats: {
      debtRemaining: 1000,
      suggestedMonthly: 2000, // >= balance → section-1 FAIL
      payoffForecast: {
        ready: true, optimisticMonths: 5, medianMonths: 10, conservativeMonths: 20,
        prob1yr: 10, prob2yr: 20, prob3yr: 30,
        remainingInterest: { low: 1, median: 2, high: 3 }, interestSavedVsStatic: 5,
      },
    },
  });
  assert.ok(hasFail(findings, /suggestedMonthly/), 'the section-1 problem still FAILs');
  assert.ok(hasOk(findings, /forecast band ordered/), 'the forecast OK is scoped, not globally suppressed');
});

test('audit-metrics: negative headline figures FAIL', () => {
  const findings = runChecks({ stats: { debtRemaining: 5000, cumulativePaidDown: -1 } });
  assert.ok(hasFail(findings, /cumulativePaidDown is negative/));
});
