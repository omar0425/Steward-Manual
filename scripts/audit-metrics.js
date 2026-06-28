'use strict';

/*
 * Metrics sanity auditor — "do these numbers make sense to a human?"
 *
 * Feed it a /status payload (the same JSON the dashboard renders from) and it
 * runs a battery of domain-sense checks: the monthly ask is realistic, forecast
 * bands are ordered, probabilities are valid, interest figures are non-negative,
 * etc. Catches the class of bug that produced "CLEAR $7,189 THIS MONTH" — where
 * a value is technically correct but contextually absurd.
 *
 * Usage:
 *   node scripts/audit-metrics.js path/to/status.json
 *   curl -s --cookie "steward_sid=..." https://APP/api/status | node scripts/audit-metrics.js
 *
 * Exit code 1 if any FAIL — so it can also gate CI against a captured payload.
 */

const fs = require('fs');

const WANT_AI = process.argv.includes('--ai');

function readInput() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const raw = arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

const findings = [];
const fail = (msg) => findings.push({ level: 'FAIL', msg });
const warn = (msg) => findings.push({ level: 'WARN', msg });
const ok = (msg) => findings.push({ level: 'OK', msg });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function audit(status) {
  const stats = (status && status.stats) || {};
  const debt = num(stats.debtRemaining);

  // 1. The monthly ask must be realistic vs the balance — never a one-month payoff.
  const suggested = num(stats.suggestedMonthly);
  if (debt && debt > 0 && suggested != null) {
    if (suggested >= debt) fail(`suggestedMonthly ($${suggested}) ≥ balance ($${debt}) — implies paying it all at once`);
    else if (suggested > debt * 0.05) warn(`suggestedMonthly ($${suggested}) is >5% of balance ($${debt}) — aggressive for a monthly ask`);
    else ok(`suggestedMonthly $${suggested} is a realistic share of $${debt}`);
  }

  // 2. Debt-free projection: ≥1 month and a future-shaped date.
  const df = stats.debtFree;
  if (df && df.onTrack) {
    if (num(df.monthsToZero) != null && df.monthsToZero < 1) fail(`debtFree.monthsToZero < 1 (${df.monthsToZero})`);
    else ok(`debt-free projection: ${df.monthsToZero} months`);
  }

  // 3. Monte Carlo band ordering + probabilities.
  const f = stats.payoffForecast;
  if (f && f.ready && !f.alreadyFree) {
    if (num(f.optimisticMonths) != null && num(f.medianMonths) != null && f.optimisticMonths > f.medianMonths) {
      fail(`forecast optimistic (${f.optimisticMonths}) later than median (${f.medianMonths})`);
    }
    if (f.conservativeMonths != null && num(f.medianMonths) != null && f.conservativeMonths < f.medianMonths) {
      fail(`forecast conservative (${f.conservativeMonths}) sooner than median (${f.medianMonths})`);
    }
    for (const k of ['prob1yr', 'prob2yr', 'prob3yr']) {
      const p = num(f[k]);
      if (p != null && (p < 0 || p > 100)) fail(`${k} out of range: ${p}`);
    }
    if (num(f.prob1yr) != null && num(f.prob3yr) != null && f.prob1yr > f.prob3yr) {
      fail(`prob1yr (${f.prob1yr}) > prob3yr (${f.prob3yr}) — longer horizon should be ≥`);
    }
    const ri = f.remainingInterest;
    if (ri) {
      if (num(ri.low) > num(ri.median) || num(ri.median) > num(ri.high)) fail(`remainingInterest band unordered: ${JSON.stringify(ri)}`);
      if (num(ri.low) < 0) fail(`remainingInterest negative: ${ri.low}`);
    }
    if (num(f.interestSavedVsStatic) != null && f.interestSavedVsStatic < 0) fail(`interestSavedVsStatic negative: ${f.interestSavedVsStatic}`);
    if (findings.every((x) => x.level !== 'FAIL')) ok(`forecast band ordered; payoff most-likely ${f.medianMonths} months`);
  }

  // 4. Plain non-negativity / sanity on headline figures.
  for (const k of ['interestSavedToDate', 'cumulativePaidDown', 'cumulativeInterestAccrued']) {
    const v = num(stats[k]);
    if (v != null && v < 0) fail(`${k} is negative (${v})`);
  }
  if (debt != null && debt < 0) fail(`debtRemaining is negative (${debt})`);

  if (!findings.length) warn('no auditable metrics present in payload (was the climb started?)');
}

let status;
try { status = readInput(); }
catch (e) { console.error('Could not read/parse status JSON:', e.message); process.exit(2); }

async function maybeAiAudit() {
  if (!WANT_AI) return;
  let ai;
  try { ai = require('../services/stewardAi'); } catch { return; }
  if (!ai.isConfigured()) {
    console.log('\nAI audit skipped — no API key configured (set the Steward AI key to enable --ai).');
    return;
  }
  console.log('\n— AI sense-check —');
  const res = await ai.generateMetricsAudit({ payload: status });
  if (!res.ok) { console.log(`AI audit unavailable (${res.error}).`); return; }
  if (!res.findings.length) { console.log('✓ AI found nothing unrealistic.'); return; }
  for (const f of res.findings) console.log(`⚠ ${f.severity.toUpperCase()}  ${f.note}`);
}

(async () => {
  audit(status);
  for (const f of findings) console.log(`${f.level === 'FAIL' ? '✗' : f.level === 'WARN' ? '⚠' : '✓'} ${f.level}  ${f.msg}`);
  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  console.log(`\n${fails} fail · ${warns} warn · ${findings.filter((f) => f.level === 'OK').length} ok`);
  await maybeAiAudit();
  process.exit(fails ? 1 : 0);
})();
