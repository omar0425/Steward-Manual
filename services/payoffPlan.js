'use strict';

/**
 * "Pay this next" recommendation, shared by the dashboard card and the Steward
 * so the advice never disagrees.
 *
 *   - Avalanche: attack the HIGHEST-APR balance first → least interest paid
 *     overall (the money-optimal move). Requires at least one known APR.
 *   - Snowball: attack the SMALLEST balance first → a fast, motivating win you
 *     can then roll into the next card. Always available.
 *
 * We compute BOTH and mark the recommended one (avalanche when any APR is
 * known, else snowball) so the UI can offer a toggle without a server round-trip.
 *
 * @param {Array<{id:string,name:string,balance:number,apr:number|null}>} accounts
 * @returns {object|null} null when there are no positive balances to target.
 */
function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function buildPayoffPlan(accounts) {
  const active = (Array.isArray(accounts) ? accounts : [])
    .map((a) => ({
      id: String(a && a.id != null ? a.id : ''),
      name: a && typeof a.name === 'string' && a.name.trim() ? a.name.trim() : 'Account',
      // Keep full precision: filter on the real balance BEFORE rounding so a
      // genuine sub-$1 balance isn't rounded to 0 and dropped (which could leave
      // "pay this next" with no target at all). Round only for display, not here.
      balance: Number(a && a.balance),
      apr: Number.isFinite(Number(a && a.apr)) && Number(a.apr) > 0 ? Number(a.apr) : null,
    }))
    .filter((a) => Number.isFinite(a.balance) && a.balance > 0);

  if (active.length === 0) return null;

  const withApr = active.filter((a) => a.apr != null);
  const hasApr = withApr.length > 0;

  // Avalanche — highest APR, tie-broken by larger balance (more interest $).
  let avalanche = null;
  if (hasApr) {
    const t = [...withApr].sort((a, b) => b.apr - a.apr || b.balance - a.balance)[0];
    avalanche = {
      target: t,
      monthlyInterest: round2((t.balance * (t.apr / 100)) / 12),
    };
  }

  // Snowball — smallest balance, tie-broken by higher APR.
  const t = [...active].sort((a, b) => a.balance - b.balance || (b.apr || 0) - (a.apr || 0))[0];
  const snowball = { target: t };

  return {
    recommended: hasApr ? 'avalanche' : 'snowball',
    hasApr,
    avalanche,
    snowball,
    accountsConsidered: active.length,
  };
}

/**
 * "Interest saved" framing — how much LESS interest your balances cost per month
 * now versus your starting balances, i.e. money paying down has rescued from the
 * bank. Honest and derivable from data we already keep (each account's first-
 * known balance, current balance, and APR).
 *
 *   monthlyInterest = Σ balance × (apr/100) / 12   (only accounts with a known APR)
 *
 * @param {Array<{apr:number|null, startBalance:number, balance:number}>} accounts
 * @returns {{ startMonthly:number, currentMonthly:number, savedMonthly:number,
 *             savedAnnual:number, hasApr:boolean }}
 */
function interestSavedSinceStart(accounts) {
  let startMonthly = 0;
  let currentMonthly = 0;
  let hasApr = false;
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const apr = Number(a && a.apr);
    if (!Number.isFinite(apr) || apr <= 0) continue;
    hasApr = true;
    const rate = apr / 100 / 12;
    const start = Number(a.startBalance);
    const curr = Number(a.balance);
    if (Number.isFinite(start) && start > 0) startMonthly += start * rate;
    if (Number.isFinite(curr) && curr > 0) currentMonthly += curr * rate;
  }
  startMonthly = round2(startMonthly);
  currentMonthly = round2(currentMonthly);
  const savedMonthly = round2(startMonthly - currentMonthly);
  return { startMonthly, currentMonthly, savedMonthly, savedAnnual: round2(savedMonthly * 12), hasApr };
}

module.exports = { buildPayoffPlan, interestSavedSinceStart };
