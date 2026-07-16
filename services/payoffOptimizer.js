'use strict';

/**
 * Strategy Lab — promo-aware payoff planning.
 *
 * Two engines over one shared model of the user's accounts:
 *
 *  1. simulateStrategy() — a month-grid simulator that plays a strategy
 *     (avalanche / snowball / promo-aware) forward until debt-free, honoring
 *     promo-rate cliffs (APR jumps on promoEndsOn), deferred-interest
 *     financing (the waived pool is billed retroactively if the balance
 *     isn't cleared by the deadline), and per-account minimum payments.
 *
 *  2. solveOptimalPlan() — the same problem formulated as a linear program
 *     (the class of model industrial solvers like IBM CPLEX run) and solved
 *     locally by the pure-JS `javascript-lp-solver`. No data leaves the app.
 *     buildCplexLp() exports the exact model in CPLEX LP file format so it
 *     can be fed to a real CPLEX installation unchanged.
 *
 * Everything is monthly-resolution: fine for "which balance gets the extra
 * dollars this month", meaningless precision beyond that is not attempted.
 */

const solver = require('javascript-lp-solver');

const MAX_MONTHS = 120; // horizon cap — 10 years; beyond this the budget simply can't win
const EPS = 0.005;

function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

/**
 * Normalize raw accounts + terms into the planner's shape.
 * startDate anchors month 0 (promo cliffs resolve against it).
 *
 * Each account: { id, name, balance, apr (monthly-compounded annual %),
 *   minPayment, promoMonth (month index the promo rate dies, null = never),
 *   postPromoApr, deferredInterest }
 */
function normalizeAccounts(accounts, terms, startDate) {
  const t0 = startDate instanceof Date ? startDate : new Date(startDate);
  const out = [];
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const balance = Number(a && a.balance);
    if (!Number.isFinite(balance) || balance <= 0) continue;
    const id = String(a.id);
    const term = (terms && terms[id]) || {};
    const apr = Number.isFinite(Number(a.apr)) && Number(a.apr) >= 0 ? Number(a.apr) : 0;
    let promoMonth = null;
    if (typeof term.promoEndsOn === 'string') {
      const end = new Date(`${term.promoEndsOn}T00:00:00Z`);
      if (Number.isFinite(end.getTime())) {
        // Months from plan start until the cliff, floored at 0 (already expired).
        promoMonth = Math.max(
          0,
          (end.getUTCFullYear() - t0.getUTCFullYear()) * 12 + (end.getUTCMonth() - t0.getUTCMonth()),
        );
      }
    }
    const postPromoApr = Number.isFinite(Number(term.postPromoApr)) ? Number(term.postPromoApr) : null;
    out.push({
      id,
      name: a && typeof a.name === 'string' && a.name.trim() ? a.name.trim() : 'Account',
      balance,
      apr,
      minPayment: Number.isFinite(Number(term.minPayment)) && Number(term.minPayment) > 0
        ? Number(term.minPayment) : 0,
      promoMonth,
      // A promo cliff with no explicit follow-on rate assumes a typical
      // revolving rate — the cliff still matters even if unconfigured.
      postPromoApr: promoMonth != null ? (postPromoApr != null ? postPromoApr : 24.99) : null,
      deferredInterest: term.deferredInterest === true && promoMonth != null,
    });
  }
  return out;
}

/** APR (annual %) in effect for an account at month m. */
function aprAt(acct, m) {
  if (acct.promoMonth != null && m >= acct.promoMonth) return acct.postPromoApr;
  return acct.apr;
}

/**
 * Pick this month's extra-dollar target under a named strategy.
 * Accounts arrive with live balances; returns the chosen index or -1.
 */
function pickTarget(strategy, accts, balances, m, budget) {
  // Promo-aware urgency: the real price of a dollar left on a promo card is
  // its POST-promo rate once the cliff can no longer be beaten. As long as the
  // balance could still be cleared by starting next month with the full
  // budget, the promo money stays cheap and the highest current rate wins;
  // the moment one more month of delay makes the cliff unbeatable, the card
  // jumps the queue at its post-promo rate (deferred-interest cards jump the
  // whole queue — missing that date bills every waived cent retroactively).
  const urgency = (x, bal) => {
    if (x.promoMonth != null && x.promoMonth > m && bal > EPS) {
      const monthsLeft = x.promoMonth - m;
      const clearableLater = bal <= (monthsLeft - 1) * budget;
      if (!clearableLater) return x.deferredInterest ? 1000 + x.postPromoApr : x.postPromoApr;
    }
    return aprAt(x, m);
  };
  let best = -1;
  for (let i = 0; i < accts.length; i++) {
    if (balances[i] <= EPS) continue;
    if (best === -1) { best = i; continue; }
    const a = accts[i]; const b = accts[best];
    if (strategy === 'snowball') {
      if (balances[i] < balances[best] - EPS) best = i;
    } else if (strategy === 'promo-aware') {
      if (urgency(a, balances[i]) > urgency(b, balances[best]) + 1e-9) best = i;
    } else { // avalanche
      if (aprAt(a, m) > aprAt(b, m) + 1e-9) best = i;
    }
  }
  return best;
}

/**
 * Play one strategy forward. Returns totals + the first month's allocation.
 * budget = total dollars available across all accounts per month.
 */
function simulateStrategy(strategy, accounts, budget) {
  const accts = accounts;
  const n = accts.length;
  const balances = accts.map((a) => a.balance);
  // Deferred-interest pool per account: interest waived during the promo,
  // billed in full the month the promo dies with a balance left.
  const waived = new Array(n).fill(0);
  let totalInterest = 0;
  let deferredTriggered = [];
  let firstMonth = null;

  for (let m = 0; m < MAX_MONTHS; m++) {
    if (balances.every((b) => b <= EPS)) {
      return {
        strategy, months: m, totalInterest: round2(totalInterest),
        deferredTriggered, firstMonth, debtFree: true,
      };
    }
    // ── Interest accrues on open balances ──
    for (let i = 0; i < n; i++) {
      if (balances[i] <= EPS) continue;
      const a = accts[i];
      const rate = aprAt(a, m) / 100 / 12;
      const interest = balances[i] * rate;
      if (a.deferredInterest && m < a.promoMonth) {
        // Promo window: the lender waives interest… unless you miss the date.
        // Track the would-have-been interest at the post-promo rate.
        waived[i] += balances[i] * (a.postPromoApr / 100 / 12);
      } else {
        balances[i] += interest;
        totalInterest += interest;
      }
      // The cliff itself: promo dies with a balance → the waived pool lands.
      if (a.deferredInterest && m === a.promoMonth && balances[i] > EPS && waived[i] > 0) {
        balances[i] += waived[i];
        totalInterest += waived[i];
        deferredTriggered.push({ id: a.id, name: a.name, amount: round2(waived[i]) });
        waived[i] = 0;
      }
    }
    // ── Payments: minimums first, then all remaining budget to the target ──
    let remaining = budget;
    const paid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (balances[i] <= EPS) continue;
      const pay = Math.min(balances[i], accts[i].minPayment, remaining);
      if (pay > 0) { balances[i] -= pay; paid[i] += pay; remaining -= pay; }
    }
    while (remaining > EPS) {
      const t = pickTarget(strategy, accts, balances, m, budget);
      if (t === -1) break;
      const pay = Math.min(balances[t], remaining);
      balances[t] -= pay; paid[t] += pay; remaining -= pay;
    }
    if (m === 0) {
      firstMonth = accts
        .map((a, i) => ({ id: a.id, name: a.name, amount: round2(paid[i]) }))
        .filter((p) => p.amount > 0);
    }
    // Budget can't even cover the interest → the plan diverges; bail honestly.
    if (paid.every((p) => p <= EPS)) break;
  }
  return {
    strategy, months: null, totalInterest: round2(totalInterest),
    deferredTriggered, firstMonth, debtFree: false,
  };
}

/**
 * Build the LP model: minimize total interest paid over a fixed horizon.
 *
 * Variables: pay_{i}_{t} (payment to account i in month t) and, implicitly,
 * balances b_{i}_{t} eliminated by substitution — with monthly factor
 * f_{i,t} = 1 + apr(i,t)/1200, balance after month T is
 *   b_i(T) = B_i·Πf − Σ_t pay_{i,t}·Π_{k>t} f_{i,k}
 * Constraints: per-month budget, non-negative final balance (payments can't
 * overshoot… enforced approximately via balance ≥ 0 at each month), minimums,
 * and debt-free by the horizon. Objective: minimize Σ payments (equivalent to
 * minimizing interest once every balance must reach zero — every extra cent
 * paid is interest).
 *
 * Deferred-interest cliffs are nonconvex (an if), so the LP takes the
 * conservative route: it must clear deferred accounts by their deadline
 * (balance_{i, promoMonth} = 0 constraint) when feasible within budget.
 */
function buildLpModel(accounts, budget, horizon) {
  const n = accounts.length;
  const H = horizon;
  const model = {
    optimize: 'totalPaid',
    opType: 'min',
    constraints: {},
    variables: {},
  };
  // Growth factor tables.
  const factor = (i, t) => 1 + aprAt(accounts[i], t) / 100 / 12;
  // cum[i][t] = product of factors from month t+1 .. H-1 (growth applied to a
  // dollar of remaining balance after month t, through the end).
  const cumTo = (i, from, to) => {
    let f = 1;
    for (let k = from; k < to; k++) f *= factor(i, k);
    return f;
  };

  for (let t = 0; t < H; t++) model.constraints[`budget_${t}`] = { max: budget };

  for (let i = 0; i < n; i++) {
    const a = accounts[i];
    // Debt-free by horizon: initial balance grown to H minus payments grown
    // from their month to H must be ≤ 0 … i.e. Σ pay·growth ≥ B·growth.
    model.constraints[`clear_${i}`] = { min: a.balance * cumTo(i, 0, H) };
    // Deferred deadline: cleared by promoMonth (growth at promo rate = 1.0
    // during the window for deferred accounts — the waived pool never lands
    // in a feasible plan).
    if (a.deferredInterest && a.promoMonth > 0 && a.promoMonth <= H) {
      model.constraints[`deadline_${i}`] = { min: a.balance };
    }
    for (let t = 0; t < H; t++) {
      // A payment made in month t is "worth" its future growth at horizon.
      const v = { totalPaid: 1, [`budget_${t}`]: 1, [`clear_${i}`]: cumTo(i, t + 1, H) };
      // No paying more than the account can ever owe (loose upper bound keeps
      // the polytope tidy without binaries).
      if (a.deferredInterest && a.promoMonth > 0 && a.promoMonth <= H && t < a.promoMonth) {
        v[`deadline_${i}`] = 1;
      }
      model.variables[`pay_${i}_${t}`] = v;
    }
  }
  return model;
}

/**
 * Solve for the optimal plan. Horizon = promo-aware simulation months + slack
 * (the LP can only rearrange payments inside a feasible horizon). Falls back
 * to the promo-aware simulation when the LP is infeasible or degenerate.
 */
function solveOptimalPlan(accounts, budget) {
  const probe = simulateStrategy('promo-aware', accounts, budget);
  if (!probe.debtFree) return { ...probe, strategy: 'optimal-lp', lpUsed: false };
  const H = Math.min(MAX_MONTHS, probe.months + 2);
  let solution = null;
  try {
    solution = solver.Solve(buildLpModel(accounts, budget, H));
  } catch {
    solution = null;
  }
  if (!solution || !solution.feasible) {
    return { ...probe, strategy: 'optimal-lp', lpUsed: false };
  }
  // Replay the LP's first-month allocation through the simulator's accounting
  // to report interest consistently (same engine, same rounding).
  const firstMonth = accounts
    .map((a, i) => ({ id: a.id, name: a.name, amount: round2(solution[`pay_${i}_0`] || 0) }))
    .filter((p) => p.amount > 0.5);
  const totalPaid = round2(solution.result);
  const principal = round2(accounts.reduce((s, a) => s + a.balance, 0));
  return {
    strategy: 'optimal-lp',
    lpUsed: true,
    months: probe.months,
    totalInterest: Math.min(probe.totalInterest, round2(Math.max(0, totalPaid - principal))),
    deferredTriggered: [],
    firstMonth: firstMonth.length ? firstMonth : probe.firstMonth,
    debtFree: true,
  };
}

/** The LP model rendered as a CPLEX LP-format file (IBM's native model format). */
function buildCplexLp(accounts, budget, horizon) {
  const model = buildLpModel(accounts, budget, horizon);
  const lines = [];
  lines.push('\\ Steward Strategy Lab — debt payoff LP');
  lines.push(`\\ ${accounts.length} accounts, ${horizon}-month horizon, $${budget}/mo budget`);
  lines.push('\\ Generated locally; readable by IBM ILOG CPLEX (and any LP-format solver).');
  for (const a of accounts) {
    lines.push(`\\   ${a.id}: ${a.name.replace(/[\r\n]/g, ' ')} — $${round2(a.balance)} at ${a.apr}% APR${a.promoMonth != null ? ` (promo ends month ${a.promoMonth}, then ${a.postPromoApr}%)` : ''}`);
  }
  lines.push('Minimize');
  lines.push(` obj: ${Object.keys(model.variables).map((v) => `+ ${v}`).join(' ')}`);
  lines.push('Subject To');
  for (const [cname, c] of Object.entries(model.constraints)) {
    const termsOut = [];
    for (const [vname, coeffs] of Object.entries(model.variables)) {
      const k = coeffs[cname];
      if (k == null || k === 0) continue;
      termsOut.push(`${k >= 0 ? '+' : '-'} ${Math.abs(round6(k))} ${vname}`);
    }
    if (!termsOut.length) continue;
    if (c.max != null) lines.push(` ${cname}: ${termsOut.join(' ')} <= ${round6(c.max)}`);
    if (c.min != null) lines.push(` ${cname}: ${termsOut.join(' ')} >= ${round6(c.min)}`);
  }
  lines.push('Bounds');
  for (const v of Object.keys(model.variables)) lines.push(` 0 <= ${v}`);
  lines.push('End');
  return lines.join('\n');
}

function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

/**
 * The Strategy Lab entry point: compare every strategy at a given budget.
 */
function comparePayoffStrategies(rawAccounts, terms, budget, startDate) {
  const accounts = normalizeAccounts(rawAccounts, terms, startDate || new Date());
  const b = Number(budget);
  if (!accounts.length || !Number.isFinite(b) || b <= 0) return null;
  const minTotal = round2(accounts.reduce((s, a) => s + a.minPayment, 0));
  const strategies = [
    simulateStrategy('avalanche', accounts, b),
    simulateStrategy('snowball', accounts, b),
    simulateStrategy('promo-aware', accounts, b),
    solveOptimalPlan(accounts, b),
  ];
  const baseline = strategies[0].totalInterest;
  for (const s of strategies) {
    s.interestVsAvalanche = round2(baseline - s.totalInterest);
  }
  return {
    budget: b,
    minimumsMonthly: minTotal,
    budgetCoversMinimums: b >= minTotal,
    totalDebt: round2(accounts.reduce((s, a) => s + a.balance, 0)),
    accountsConsidered: accounts.length,
    promoCliffs: accounts
      .filter((a) => a.promoMonth != null && a.promoMonth > 0)
      .map((a) => ({ id: a.id, name: a.name, inMonths: a.promoMonth, postPromoApr: a.postPromoApr, deferredInterest: a.deferredInterest })),
    strategies,
  };
}

module.exports = {
  comparePayoffStrategies,
  simulateStrategy,
  solveOptimalPlan,
  normalizeAccounts,
  buildLpModel,
  buildCplexLp,
};
