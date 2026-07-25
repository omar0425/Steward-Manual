'use strict';

/**
 * Probabilistic payoff forecast — Monte Carlo over the user's OWN paydown history.
 *
 * Instead of a single straight-line date, we bootstrap-resample the months of
 * real paydown the user has logged (including the bad months where debt grew)
 * and simulate thousands of futures. The spread of payoff dates becomes an
 * honest confidence band: "most likely March 2027, 90% by …, X% chance within
 * 2 years." No distribution assumptions — the samples ARE the model.
 *
 * Pure module (rng injectable) so it's deterministic under test.
 */

const DAYS_PER_MONTH = 30.44;

/**
 * Monthly paydown-rate samples ($/month) from consecutive snapshots
 * (newest-first). Negative samples (debt grew that interval) are kept on
 * purpose — that volatility is exactly what the simulation should feel.
 */
// minDays drops individual short intervals; a 3-day gap with any real drop
// annualizes into a fantasy $/month rate. minSpanDays additionally refuses to
// derive ANY samples until the overall history spans real calendar time — the
// same discipline services/pace.js enforces (MIN_SPAN_DAYS = 21), so a burst of
// same-week entries can't feed the Monte Carlo a wildly optimistic debt-free
// date that contradicts the linear projection.
//
// The history is PARTITIONED into consecutive non-overlapping windows of at
// least minDays, rather than read pair-by-adjacent-pair. Adjacent-pairs-only
// silently discarded every interval for anyone who checks in more often than
// minDays: weekly entries for a year produced ZERO samples, so the band never
// became ready and the user stayed on the volatile single-pace date — logging
// more made the forecast strictly worse. Re-anchoring after each window keeps
// the samples independent (no reading counted twice) while letting a cluster of
// same-day entries collapse into the one window that contains them.
function monthlyPaydownSamples(snapshots, { minDays = 10, minSpanDays = 21 } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return [];
  // Callers hand us newest-first; walk oldest→newest so the windows advance
  // with the calendar and a sample reads as (older debt − newer debt).
  const points = snapshots
    .map((s) => ({ t: Date.parse(s && s.pulled_at), debt: Number(s && s.debt_remaining) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.debt))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return [];
  const spanDays = (points[points.length - 1].t - points[0].t) / 86400000;
  if (spanDays < minSpanDays) return [];
  const out = [];
  let anchor = points[0];
  for (const p of points) {
    const days = (p.t - anchor.t) / 86400000;
    if (!(days >= minDays)) continue;
    out.push((anchor.debt - p.debt) / (days / DAYS_PER_MONTH));
    anchor = p;
  }
  return out;
}

/**
 * Run the simulation. Returns { ready:false, reason } until there's enough
 * positive-trending history; otherwise a band of percentile payoff dates plus
 * the probability of being debt-free within 1/2/3 years.
 *
 * Percentiles are taken over ALL runs — a run that never pays off inside
 * maxMonths counts as "beyond horizon" (Infinity), so an erratic payer honestly
 * gets a null conservative date instead of a fake one.
 */
function monteCarloPayoff(currentDebt, samples, opts = {}) {
  const { runs = 2000, maxMonths = 600, now = Date.now(), rng = Math.random } = opts;
  const debt0 = Number(currentDebt);
  // When an effective APR is supplied, also accumulate the interest paid along
  // each simulated path (interest on the running balance each month). This is
  // observational — it doesn't change the paydown model, so it can't double-count.
  const aprPct = Number(opts.annualAprPct);
  const trackInterest = Number.isFinite(aprPct) && aprPct > 0;
  const monthlyRate = trackInterest ? aprPct / 100 / 12 : 0;

  if (Number.isFinite(debt0) && debt0 <= 0) return { ready: true, alreadyFree: true };
  if (!Number.isFinite(debt0) || !Array.isArray(samples) || samples.length < 3) {
    return { ready: false, reason: 'not_enough_history' };
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (!(mean > 0)) return { ready: false, reason: 'no_progress' };

  const months = new Array(runs);
  const interestPaid = []; // only for runs that reach payoff (finite interest)
  let reached = 0;
  for (let r = 0; r < runs; r++) {
    let debt = debt0;
    let m = 0;
    let interest = 0;
    while (debt > 0 && m < maxMonths) {
      if (trackInterest) interest += debt * monthlyRate;
      debt -= samples[(rng() * samples.length) | 0];
      m++;
    }
    if (debt <= 0) { months[r] = m; reached++; if (trackInterest) interestPaid.push(interest); }
    else { months[r] = Infinity; }
  }
  months.sort((a, b) => a - b);

  const at = (p) => months[Math.min(months.length - 1, Math.max(0, Math.round((p / 100) * (months.length - 1))))];
  const toDate = (m) => (Number.isFinite(m) ? new Date(now + m * DAYS_PER_MONTH * 86400000).toISOString().slice(0, 10) : null);
  const probWithin = (mm) => Math.round((months.filter((x) => x <= mm).length / runs) * 100);

  const medianM = at(50);
  if (!Number.isFinite(medianM)) return { ready: false, reason: 'no_progress' };

  const result = {
    ready: true,
    runs,
    samples: samples.length,
    optimisticMonths: at(10), optimisticDate: toDate(at(10)),     // fastest decile
    medianMonths: medianM, medianDate: toDate(medianM),
    conservativeMonths: Number.isFinite(at(90)) ? at(90) : null,
    conservativeDate: toDate(at(90)),
    prob1yr: probWithin(12),
    prob2yr: probWithin(24),
    prob3yr: probWithin(36),
  };

  // Remaining-interest band (conditional on reaching payoff). Also a "tread
  // water" baseline: interest if the balance never dropped over the median
  // horizon — the difference is interest your paydown is projected to save.
  if (trackInterest && interestPaid.length) {
    interestPaid.sort((a, b) => a - b);
    const ipAt = (p) => Math.round(interestPaid[Math.min(interestPaid.length - 1, Math.max(0, Math.round((p / 100) * (interestPaid.length - 1))))]);
    const staticInterest = Math.round(debt0 * monthlyRate * medianM);
    result.remainingInterest = { low: ipAt(10), median: ipAt(50), high: ipAt(90) };
    result.interestIfStatic = staticInterest;
    result.interestSavedVsStatic = Math.max(0, staticInterest - ipAt(50));
  }

  return result;
}

/** Balance-weighted average APR (%) across accounts that have one. 0 if none. */
function effectiveAnnualAprPct(accounts) {
  let wsum = 0;
  let bsum = 0;
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const apr = Number(a && a.apr);
    const bal = Number(a && a.balance);
    if (!Number.isFinite(apr) || apr <= 0 || !Number.isFinite(bal) || bal <= 0) continue;
    wsum += apr * bal;
    bsum += bal;
  }
  return bsum > 0 ? wsum / bsum : 0;
}

module.exports = { monthlyPaydownSamples, monteCarloPayoff, effectiveAnnualAprPct, DAYS_PER_MONTH };
