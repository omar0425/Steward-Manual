'use strict';

/*
 * Metrics sanity auditor — "do these numbers make sense to a human?"
 *
 * Feed it a /status payload (the same JSON the dashboard renders from) and it
 * runs a battery of domain-sense checks: the monthly ask is realistic, forecast
 * bands are ordered, probabilities are valid + monotonic, interest figures are
 * non-negative, etc. Catches the class of bug that produced "CLEAR $7,189 THIS
 * MONTH" — where a value is technically correct but contextually absurd.
 *
 * Usage:
 *   node scripts/audit-metrics.js path/to/status.json
 *   curl -s --cookie "steward_sid=..." https://APP/api/status | node scripts/audit-metrics.js
 *   node scripts/audit-metrics.js today.json --baseline yesterday.json   # + drift check
 *
 * Flags:
 *   --baseline <file>  compare against a prior /status capture and flag drift
 *                      (a monotonic counter that fell, a metric that swung wildly).
 *   --strict-drift     promote drift WARNs to FAILs (non-zero exit) for hard alerts.
 *   --ai               also run the AI sense-check (needs an API key).
 *
 * Schedule it against the live /status (see RECOVERY.md → Ongoing health checks)
 * to get told when a figure drifts. Exit code 1 if any FAIL — so it can also gate
 * CI against a captured payload. `runChecks(status)` and
 * `runDriftChecks(status, baseline, opts)` are exported for tests.
 */

const fs = require('fs');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Pure: run every sanity check on a /status payload and return the findings
 * array ([{ level: 'FAIL'|'WARN'|'OK', msg }]). No I/O, no process exit.
 */
function runChecks(status) {
  const findings = [];
  const fail = (msg) => findings.push({ level: 'FAIL', msg });
  const warn = (msg) => findings.push({ level: 'WARN', msg });
  const ok = (msg) => findings.push({ level: 'OK', msg });

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
    const forecastFailsBefore = findings.filter((x) => x.level === 'FAIL').length;
    if (num(f.optimisticMonths) != null && num(f.medianMonths) != null && f.optimisticMonths > f.medianMonths) {
      fail(`forecast optimistic (${f.optimisticMonths}) later than median (${f.medianMonths})`);
    }
    if (f.conservativeMonths != null && num(f.medianMonths) != null && f.conservativeMonths < f.medianMonths) {
      fail(`forecast conservative (${f.conservativeMonths}) sooner than median (${f.medianMonths})`);
    }
    // Cumulative P(payoff ≤ horizon) must be in [0,100] AND non-decreasing across
    // 1yr → 2yr → 3yr. The old check only compared prob1yr vs prob3yr, so a corrupt
    // middle value (e.g. 80/40/90) slipped through — now every adjacent pair is checked.
    const probs = [['prob1yr', num(f.prob1yr)], ['prob2yr', num(f.prob2yr)], ['prob3yr', num(f.prob3yr)]];
    for (const [k, p] of probs) {
      if (p != null && (p < 0 || p > 100)) fail(`${k} out of range: ${p}`);
    }
    const present = probs.filter(([, p]) => p != null);
    for (let i = 1; i < present.length; i++) {
      if (present[i][1] < present[i - 1][1]) {
        fail(`${present[i][0]} (${present[i][1]}) < ${present[i - 1][0]} (${present[i - 1][1]}) — longer horizon should be ≥`);
      }
    }
    const ri = f.remainingInterest;
    if (ri) {
      if (num(ri.low) > num(ri.median) || num(ri.median) > num(ri.high)) fail(`remainingInterest band unordered: ${JSON.stringify(ri)}`);
      if (num(ri.low) < 0) fail(`remainingInterest negative: ${ri.low}`);
    }
    if (num(f.interestSavedVsStatic) != null && f.interestSavedVsStatic < 0) fail(`interestSavedVsStatic negative: ${f.interestSavedVsStatic}`);
    // Scope the OK to THIS section's checks (was a global "no fails anywhere" test,
    // which suppressed a legitimately-fine forecast OK whenever section 1/2 failed).
    if (findings.filter((x) => x.level === 'FAIL').length === forecastFailsBefore) {
      ok(`forecast band ordered; payoff most-likely ${f.medianMonths} months`);
    }
  }

  // 4. Plain non-negativity / sanity on headline figures.
  for (const k of ['interestSavedToDate', 'cumulativePaidDown', 'cumulativeInterestAccrued']) {
    const v = num(stats[k]);
    if (v != null && v < 0) fail(`${k} is negative (${v})`);
  }
  if (debt != null && debt < 0) fail(`debtRemaining is negative (${debt})`);

  if (!findings.length) warn('no auditable metrics present in payload (was the climb started?)');
  return findings;
}

/**
 * Pure: drift check — compare this capture to a prior one and flag movements
 * that shouldn't happen on their own. Catches the slow-rot class of bug — a
 * figure that quietly goes wrong over time rather than being absurd in any
 * single snapshot. Returns a findings array. Drift is WARN by default (undo/
 * reset are legitimate); pass { strict: true } to promote it to FAIL.
 */
function runDriftChecks(status, baseline, { strict = false } = {}) {
  const findings = [];
  const fail = (msg) => findings.push({ level: 'FAIL', msg });
  const warn = (msg) => findings.push({ level: 'WARN', msg });
  const ok = (msg) => findings.push({ level: 'OK', msg });
  const flag = strict ? fail : warn;

  const cur = (status && status.stats) || {};
  const old = (baseline && baseline.stats) || {};

  // Monotonic counters should only ever rise (barring a deliberate undo/reset).
  for (const k of ['cumulativePaidDown', 'cumulativeInterestAccrued']) {
    const a = num(old[k]);
    const b = num(cur[k]);
    if (a != null && b != null && b < a - 0.01) {
      flag(`${k} fell ${a} → ${b} since last check — expected non-decreasing (undo/reset? else investigate)`);
    }
  }

  // pctPaid going backward materially.
  {
    const a = num(old.pctPaid);
    const b = num(cur.pctPaid);
    if (a != null && b != null && b < a - 5) flag(`pctPaid dropped ${a} → ${b} since last check`);
  }

  // Big one-period swings in headline figures usually mean a bad pull, not real life.
  const swing = (key, label, pctThreshold) => {
    const a = num(old[key]);
    const b = num(cur[key]);
    if (a != null && b != null && a > 0) {
      const pct = (Math.abs(b - a) / a) * 100;
      if (pct > pctThreshold) flag(`${label} swung ${pct.toFixed(0)}% (${a} → ${b}) in one period`);
    }
  };
  swing('debtRemaining', 'debtRemaining', 50);
  swing('suggestedMonthly', 'suggestedMonthly', 60);

  const cf = cur.payoffForecast || {};
  const of = old.payoffForecast || {};
  {
    const a = num(of.medianMonths);
    const b = num(cf.medianMonths);
    if (a != null && b != null && a > 0) {
      const pct = (Math.abs(b - a) / a) * 100;
      if (pct > 75) flag(`payoff medianMonths changed ${pct.toFixed(0)}% (${a} → ${b}) in one period`);
    }
  }

  if (!findings.length) ok('no suspicious drift vs baseline');
  return findings;
}

module.exports = { runChecks, runDriftChecks };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const WANT_AI = argv.includes('--ai');
  const STRICT_DRIFT = argv.includes('--strict-drift');
  const baselineIdx = argv.indexOf('--baseline');
  const BASELINE_FILE = baselineIdx !== -1 ? (argv[baselineIdx + 1] || null) : null;

  const readInput = () => {
    // First positional arg that isn't a flag or the --baseline value.
    let arg = null;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--baseline') { i++; continue; } // skip the flag and its value
      if (a.startsWith('--')) continue;
      arg = a;
      break;
    }
    const raw = arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
    return JSON.parse(raw);
  };

  let status;
  try { status = readInput(); }
  catch (e) { console.error('Could not read/parse status JSON:', e.message); process.exit(2); }

  const maybeAiAudit = async () => {
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
  };

  (async () => {
    const findings = runChecks(status);
    if (BASELINE_FILE) {
      try {
        const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
        findings.push(...runDriftChecks(status, baseline, { strict: STRICT_DRIFT }));
      } catch (e) {
        findings.push({ level: 'WARN', msg: `could not read baseline ${BASELINE_FILE} for drift check: ${e.message}` });
      }
    }
    for (const f of findings) console.log(`${f.level === 'FAIL' ? '✗' : f.level === 'WARN' ? '⚠' : '✓'} ${f.level}  ${f.msg}`);
    const fails = findings.filter((f) => f.level === 'FAIL').length;
    const warns = findings.filter((f) => f.level === 'WARN').length;
    console.log(`\n${fails} fail · ${warns} warn · ${findings.filter((f) => f.level === 'OK').length} ok`);
    await maybeAiAudit();
    process.exit(fails ? 1 : 0);
  })();
}
