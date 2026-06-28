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
function monthlyPaydownSamples(snapshots, { minDays = 2 } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return [];
  const out = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const newer = snapshots[i];
    const older = snapshots[i + 1];
    const t1 = Date.parse(newer.pulled_at);
    const t0 = Date.parse(older.pulled_at);
    if (!Number.isFinite(t1) || !Number.isFinite(t0)) continue;
    const days = (t1 - t0) / 86400000;
    if (!(days >= minDays)) continue;
    const paydown = Number(older.debt_remaining) - Number(newer.debt_remaining);
    if (!Number.isFinite(paydown)) continue;
    out.push(paydown / (days / DAYS_PER_MONTH));
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

  if (Number.isFinite(debt0) && debt0 <= 0) return { ready: true, alreadyFree: true };
  if (!Number.isFinite(debt0) || !Array.isArray(samples) || samples.length < 3) {
    return { ready: false, reason: 'not_enough_history' };
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (!(mean > 0)) return { ready: false, reason: 'no_progress' };

  const months = new Array(runs);
  let reached = 0;
  for (let r = 0; r < runs; r++) {
    let debt = debt0;
    let m = 0;
    while (debt > 0 && m < maxMonths) {
      debt -= samples[(rng() * samples.length) | 0];
      m++;
    }
    if (debt <= 0) { months[r] = m; reached++; } else { months[r] = Infinity; }
  }
  months.sort((a, b) => a - b);

  const at = (p) => months[Math.min(months.length - 1, Math.max(0, Math.round((p / 100) * (months.length - 1))))];
  const toDate = (m) => (Number.isFinite(m) ? new Date(now + m * DAYS_PER_MONTH * 86400000).toISOString().slice(0, 10) : null);
  const probWithin = (mm) => Math.round((months.filter((x) => x <= mm).length / runs) * 100);

  const medianM = at(50);
  if (!Number.isFinite(medianM)) return { ready: false, reason: 'no_progress' };

  return {
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
}

module.exports = { monthlyPaydownSamples, monteCarloPayoff, DAYS_PER_MONTH };
