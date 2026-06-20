'use strict';

/**
 * Builds the rich input payload for the Steward AI prompt, plus decides which
 * narrative mode is appropriate for THIS turn.
 *
 * Architecture (see also routes/api.js):
 *
 *   Layer 1 — Deterministic events (fire on their own, ignore rotation):
 *     - 'closing_certificate'  any account just hit $0
 *     - 'quarterly_letter'     ≥90 days since the last one
 *
 *   Layer 2 — Rotating dialog (server gates eligibility, AI picks mode):
 *     - 'adversary'             always eligible if monthlyInterestCost > $5
 *     - 'todays_deal'           eligible if APR data exists
 *     - 'climb_forecast'        eligible after ≥3 turns of positive pace data
 *     - 'if_you_do_nothing'     ≥30d since last fire AND ≤$50 paid in last 4 turns
 *     - 'anti_flattery'         this turn added debt OR stalled with $0 paid
 *     - 'observation'           always eligible (fallback)
 *
 *   Layer 3 — Always-on (computed regardless of mode):
 *     - account nicknames (persisted, sticky)
 *     - ledger entry (persisted from the same AI call)
 */

const {
  getConfig,
  setConfig,
  recentSnapshots,
  getDebtAccountHistory,
  getGameStart,
  latestSnapshot,
  getAllDebtAccountBalances,
  getDebtAccountFirstBalances,
} = require('../db');
const { getClimbTier, nextClimbTierInfo } = require('./tiers');
const {
  getClimbStatsFromConfig,
  getLastDebtSyncDebugForStatus,
} = require('./climbMetrics');
const { refreshNicknames } = require('./stewardAiNicknames');
const { monthlyPaceFromSnapshots, projectDebtFree, paidThisMonth, DAYS_PER_MONTH } = require('./pace');
const { buildPayoffPlan } = require('./payoffPlan');

// ── Config keys used by this module ───────────────────────────────────────────
const LAST_IF_DO_NOTHING_KEY    = 'steward_ai_last_if_do_nothing_at';
const LAST_QUARTERLY_LETTER_KEY = 'steward_ai_last_quarterly_at';

// ── Numeric helpers ───────────────────────────────────────────────────────────
function dollars(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : 0;
}
function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

// ── Interest rates ────────────────────────────────────────────────────────────
function readInterestRates() {
  const raw = getConfig('interest_rates');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Monthly $ cost of interest on current balances, if APRs are known. */
function monthlyInterestCost(currentAccounts, aprMap) {
  let total = 0;
  for (const acct of currentAccounts || []) {
    const apr = Number(aprMap[String(acct.id)]);
    const bal = Number(acct.balance);
    if (Number.isFinite(apr) && apr > 0 && Number.isFinite(bal) && bal > 0) {
      total += (bal * (apr / 100)) / 12;
    }
  }
  return round2(total);
}

/**
 * Identify the highest-cost account by monthly interest dollars.
 * Returns { name, monthlyCost, apr, balance } or null.
 */
function highestInterestAccount(currentAccounts, aprMap) {
  let best = null;
  for (const acct of currentAccounts || []) {
    const apr = Number(aprMap[String(acct.id)]);
    const bal = Number(acct.balance);
    if (!Number.isFinite(apr) || apr <= 0 || !Number.isFinite(bal) || bal <= 0) continue;
    const cost = (bal * (apr / 100)) / 12;
    if (!best || cost > best.monthlyCost) {
      best = { name: acct.name, monthlyCost: round2(cost), apr, balance: dollars(bal) };
    }
  }
  return best;
}

// ── Pace + forecasts ──────────────────────────────────────────────────────────
/**
 * Avg paydown per CALENDAR DAY across the recent window. Using calendar time
 * (not "per turn") gives stable forecast dates even when a user logs irregularly.
 * Returns null if the window is too narrow or pace isn't positive.
 */
function avgDailyPaydown(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
  const window = snapshots.slice(0, Math.min(6, snapshots.length));
  // snapshots are newest-first
  const newest = window[0];
  const oldest = window[window.length - 1];
  const msElapsed = new Date(newest.pulled_at) - new Date(oldest.pulled_at);
  const days = msElapsed / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(days) || days < 1) return null;
  const paydown = oldest.debt_remaining - newest.debt_remaining;
  if (!Number.isFinite(paydown) || paydown <= 0) return null;
  return round2(paydown / days);
}

/**
 * Net debt reduction across the TRAILING WINDOW, summed over every account —
 * i.e. how far the whole balance moved, not how much a single card was paid.
 * Uses the snapshots table (the source of truth for monthly totals), so it is
 * immune to the "last entry only touched one card" trap that makes the
 * per-entry delta understate the month.
 *
 * Returns the dollar reduction (positive = paid down, negative = grew) or null
 * when there isn't a second snapshot to compare against. Falls back to the
 * oldest snapshot we have when none is a full `days` old, so the figure is
 * always honest about the period it actually covers (reported via `fromDate`).
 */
function paydownOverWindow(snapshots, days) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
  const newest = snapshots[0];
  const newestT = new Date(newest.pulled_at).getTime();
  if (!Number.isFinite(newestT)) return null;
  const cutoff = newestT - days * 86400000;
  let ref = null;
  for (let i = 1; i < snapshots.length; i++) {
    const t = new Date(snapshots[i].pulled_at).getTime();
    if (Number.isFinite(t) && t <= cutoff) { ref = snapshots[i]; break; }
  }
  if (!ref) ref = snapshots[snapshots.length - 1];
  const reduction = Number(ref.debt_remaining) - Number(newest.debt_remaining);
  if (!Number.isFinite(reduction)) return null;
  return {
    paydown: round2(reduction),
    fromDate: typeof ref.pulled_at === 'string' ? ref.pulled_at.slice(0, 10) : null,
  };
}

/**
 * Forecast calendar dates for the next 1–3 climb tiers from a MONTHLY paydown
 * pace (dollars/month). Returns [] when pace is null/non-positive or the
 * projected horizon exceeds ~2 years. Using the span-gated monthly pace (see
 * services/pace.js) keeps these dates honest even when entries cluster in time.
 */
function forecastTierDates({ currentDebt, baseline, monthlyPace }) {
  if (!Number.isFinite(monthlyPace) || monthlyPace <= 0) return [];
  if (!Number.isFinite(baseline) || baseline <= 0) return [];
  const perDay = monthlyPace / DAYS_PER_MONTH;
  const nonDebtFreeStages = 9;
  const forecasts = [];
  for (let i = 1; i <= nonDebtFreeStages; i++) {
    const exitPct = i / nonDebtFreeStages;
    const targetDebt = baseline * (1 - exitPct);
    if (currentDebt <= targetDebt) continue;
    const dollarsAway = currentDebt - targetDebt;
    const daysAway = dollarsAway / perDay;
    if (daysAway > 730) break;
    const date = new Date(Date.now() + daysAway * 86400 * 1000);
    forecasts.push({
      stage: i + 1, // user-facing stage number
      dollarsAway: dollars(dollarsAway),
      daysAway: Math.round(daysAway),
      date: date.toISOString().slice(0, 10),
    });
    if (forecasts.length >= 3) break;
  }
  return forecasts;
}

// ── Deterministic event detection ─────────────────────────────────────────────
/**
 * Did any account hit $0 on this turn? Returns the first paid-off account or
 * null. We use the per-turn account_lines from lastDebtSync — kind:'paid_off'
 * is set by climbMetrics.perAccountDebtDeltaDisplayRows when curr === 0.
 */
function detectClosingCertificate(lastDebtSync) {
  if (!lastDebtSync || !Array.isArray(lastDebtSync.account_lines)) return null;
  const paid = lastDebtSync.account_lines.find((l) => l && l.kind === 'paid_off');
  if (!paid) return null;
  return {
    name: paid.name || 'an account',
    amountPaid: dollars(Math.abs(paid.delta || 0)),
    at: lastDebtSync.pulled_at,
  };
}

function shouldFireQuarterlyLetter() {
  const last = getConfig(LAST_QUARTERLY_LETTER_KEY);
  if (!last) return true; // first-ever quarterly letter fires once the user has enough history
  const ms = Date.now() - new Date(last).getTime();
  return Number.isFinite(ms) && ms >= 90 * 86400 * 1000;
}

function markQuarterlyLetterFired(at) {
  setConfig(LAST_QUARTERLY_LETTER_KEY, at);
}

// ── Rotating-mode eligibility ─────────────────────────────────────────────────
function buildEligibleModes({
  monthlyInterest,
  hasAnyApr,
  paceData,        // { monthlyPace, turnsAnalyzed }
  recentPaydownSum,
  lastPullPaydown,
  lastPullAdded,
}) {
  const modes = [];

  if (monthlyInterest > 5) modes.push('adversary');
  if (hasAnyApr) modes.push('todays_deal');
  if (paceData.turnsAnalyzed >= 3 && paceData.monthlyPace > 0) modes.push('climb_forecast');

  const lastIfNothing = getConfig(LAST_IF_DO_NOTHING_KEY);
  const cooledDown =
    !lastIfNothing ||
    Date.now() - new Date(lastIfNothing).getTime() >= 30 * 86400 * 1000;
  if (cooledDown && recentPaydownSum <= 50) modes.push('if_you_do_nothing');

  if (lastPullAdded > 0 || (lastPullPaydown === 0 && lastPullAdded === 0)) {
    modes.push('anti_flattery');
  }

  modes.push('observation'); // always present as fallback
  return modes;
}

function markIfDoNothingFired(at) {
  setConfig(LAST_IF_DO_NOTHING_KEY, at);
}

// ── Master context build ──────────────────────────────────────────────────────
/**
 * Build the full payload + event/mode decision for the current snapshot.
 * Returns { skip: true } when there's no data to comment on yet.
 */
function buildContext() {
  const snap = latestSnapshot();
  if (!snap) return { skip: true, reason: 'no_snapshot' };
  const { gameStartDebt, gameStartAt } = getGameStart();
  if (gameStartDebt == null) return { skip: true, reason: 'setup_incomplete' };

  const snapshots = recentSnapshots(8); // newest-first
  const climb = getClimbStatsFromConfig();
  const tierObj = getClimbTier(snap.debt_remaining, climb.climbBaselineDebt);
  const next = nextClimbTierInfo(snap.debt_remaining, climb.climbBaselineDebt);

  const lastDebtSync = getLastDebtSyncDebugForStatus();
  const lastPullAccountLines =
    lastDebtSync && Array.isArray(lastDebtSync.account_lines) ? lastDebtSync.account_lines : [];

  let lastPullPaydown = 0;
  let lastPullAdded = 0;
  for (const l of lastPullAccountLines) {
    const d = Number(l && l.delta);
    if (Number.isFinite(d)) {
      if (d < 0) lastPullPaydown += Math.abs(d);
      else if (d > 0) lastPullAdded += d;
    }
  }
  lastPullPaydown = round2(lastPullPaydown);
  lastPullAdded = round2(lastPullAdded);

  // Direction (compares latest vs previous snapshot)
  let direction = 'unknown';
  if (snapshots.length >= 2) {
    const a = snapshots[0].debt_remaining;
    const b = snapshots[1].debt_remaining;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (a < b) direction = 'decreasing';
      else if (a > b) direction = 'increasing';
      else direction = 'stable';
    }
  }

  // Pace & forecast. The monthly pace is span-gated (services/pace.js): it
  // returns null until entries span real calendar time, so clustered logging
  // can no longer inflate it into a fantasy rate or over-optimistic dates.
  const monthlyPace = monthlyPaceFromSnapshots(snapshots);
  const forecasts = forecastTierDates({
    currentDebt: snap.debt_remaining,
    baseline: climb.climbBaselineDebt,
    monthlyPace,
  });
  // Debt-free date + what the user has actually done THIS month — so the Steward
  // can speak to current behavior and a real finish line, from the same history.
  const debtFreeProjection = projectDebtFree(snapshots, snap.debt_remaining, { monthlyPace });
  const netPaidThisMonth = paidThisMonth(snapshots);

  // True monthly paydown: total balance reduction across ALL cards over the
  // last ~30 days, from the snapshots table. This is the figure the Steward
  // should quote for "last month" — never a single entry's per-card delta.
  const last30 = paydownOverWindow(snapshots, 30);

  // Recent paydown sum (last 4 deltas, in dollars)
  let recentPaydownSum = 0;
  for (let i = 0; i < Math.min(snapshots.length - 1, 4); i++) {
    const diff = snapshots[i + 1].debt_remaining - snapshots[i].debt_remaining;
    if (Number.isFinite(diff) && diff > 0) recentPaydownSum += diff;
  }
  recentPaydownSum = round2(recentPaydownSum);

  // Days since previous snapshot
  let daysSinceLastTurn = null;
  if (snapshots.length >= 2) {
    const ms = new Date(snapshots[0].pulled_at) - new Date(snapshots[1].pulled_at);
    if (Number.isFinite(ms) && ms > 0) daysSinceLastTurn = Math.round(ms / 86400000);
  }

  // Days since game started
  let daysIntoClimb = null;
  if (gameStartAt) {
    const ms = Date.now() - new Date(gameStartAt).getTime();
    if (Number.isFinite(ms) && ms > 0) daysIntoClimb = Math.round(ms / 86400000);
  }

  // Account inventory + APRs
  const balanceMap = getAllDebtAccountBalances();
  const aprMap = readInterestRates();

  // We need account NAMES too — pull from the persisted name map.
  const nameMapRaw = getConfig('debt_account_name_map');
  let nameMap = {};
  if (nameMapRaw) {
    try { nameMap = JSON.parse(nameMapRaw) || {}; } catch { nameMap = {}; }
  }
  const currentAccounts = [];
  for (const [id, balance] of balanceMap) {
    currentAccounts.push({
      id,
      name: nameMap[id] || 'Account',
      balance: round2(balance),
    });
  }

  // Per-account history (last 30d), for nickname detection + pace context
  const historyByAccount = getDebtAccountHistory(30);
  // Each account's original balance (full history) → percent paid down so far.
  const firstBalances = getDebtAccountFirstBalances();

  const nicknames = refreshNicknames(currentAccounts, aprMap, historyByAccount);
  const annotatedAccounts = currentAccounts.map((a) => {
    const start = Number(firstBalances.get(String(a.id)));
    const pctPaid =
      Number.isFinite(start) && start > 0
        ? Math.max(0, Math.min(100, Math.round(((start - a.balance) / start) * 1000) / 10))
        : null;
    return {
      ...a,
      apr: Number.isFinite(Number(aprMap[a.id])) ? Number(aprMap[a.id]) : null,
      nickname: nicknames[a.id] || null,
      pctPaid, // % this card has been paid down from its starting balance
    };
  });

  const monthlyInterest = monthlyInterestCost(currentAccounts, aprMap);
  const topInterest = highestInterestAccount(currentAccounts, aprMap);
  // "Pay this next": avalanche (highest APR) + snowball (smallest balance), from
  // the same helper the dashboard card uses so the advice can never disagree.
  const payoffPlan = buildPayoffPlan(
    currentAccounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance, apr: aprMap[String(a.id)] })),
  );
  const hasAnyApr = Object.values(aprMap).some(
    (v) => Number.isFinite(Number(v)) && Number(v) > 0,
  );

  // Decide event vs rotation
  const closing = detectClosingCertificate(lastDebtSync);
  let event = null;
  if (closing) {
    event = { kind: 'closing_certificate', data: closing };
  } else if (shouldFireQuarterlyLetter() && (daysIntoClimb || 0) >= 30 && snapshots.length >= 4) {
    event = { kind: 'quarterly_letter' };
  }

  const eligibleModes = buildEligibleModes({
    monthlyInterest,
    hasAnyApr,
    paceData: { monthlyPace, turnsAnalyzed: snapshots.length - 1 },
    recentPaydownSum,
    lastPullPaydown,
    lastPullAdded,
  });

  // What we hand to the model. Names already truncated upstream; we cap once
  // more here just in case the persisted name map carries oversized strings.
  const safe = (s) => (typeof s === 'string' ? s.slice(0, 40) : '');
  const payloadAccounts = annotatedAccounts.map((a) => ({
    name: safe(a.name),
    balance: dollars(a.balance),
    apr: a.apr,
    nickname: a.nickname,
    pctPaid: a.pctPaid, // percent paid down from this card's starting balance
  }));
  const turnDeltas = lastPullAccountLines
    .filter((l) => l && Number.isFinite(Number(l.delta)) && Math.abs(Number(l.delta)) >= 1)
    .slice(0, 8)
    .map((l) => ({
      name: safe(l.name || ''),
      delta: dollars(l.delta),
      kind: l.kind, // 'decreased' | 'increased' | 'new' | 'paid_off' | 'removed'
    }));

  const snapshotTrail = snapshots
    .slice()
    .reverse() // oldest → newest
    .map((s) => ({ date: s.pulled_at.slice(0, 10), debt: dollars(s.debt_remaining) }));

  return {
    skip: false,
    snapshot: { pulledAt: snap.pulled_at },
    event,
    eligibleModes,
    payload: {
      tier: tierObj && { label: tierObj.label, badge: tierObj.badge, id: tierObj.id },
      nextTier: next.nextTier
        ? { label: next.nextTier.label, gapDollars: dollars(next.gapDollars) }
        : null,
      stats: {
        debtRemaining: dollars(snap.debt_remaining),
        baselineDebt: dollars(climb.climbBaselineDebt),
        totalPaidDown: dollars(climb.cumulativePaidDown),
        totalAdded: dollars(climb.cumulativeNewDebtAdded),
        // Interest the user has paid to carry the debt, tracked apart from new
        // spending. Real classified dollars (not the APR estimate in interest{}).
        totalInterestAccrued: dollars(climb.cumulativeInterestAccrued),
        pctPaid: Number.isFinite(Number(climb.pctPaid))
          ? Math.round(Number(climb.pctPaid) * 10) / 10
          : null,
        netImprovement: dollars(climb.netImprovement),
        // Most recent ENTRY only — may be a single card the user just updated,
        // NOT the month's total. Never quote this as "paid down last month".
        latestEntryPaydown: dollars(lastPullPaydown),
        latestEntryAdded: dollars(lastPullAdded),
        direction,
        daysSinceLastTurn,
        daysIntoClimb,
        recentPaydownSum4Turns: dollars(recentPaydownSum),
        // THE monthly figure to quote: total balance reduction across ALL cards
        // over the last ~30 days, from the snapshots table. fromDate is the start
        // of the window actually covered (positive = paid down, negative = grew).
        paidDownLast30Days: last30 ? dollars(last30.paydown) : null,
        paidDownLast30DaysFromDate: last30 ? last30.fromDate : null,
        // Typical monthly pace, span-gated (null until entries cover real time).
        // Safe to extrapolate a payoff horizon from; never a per-day number.
        avgMonthlyPaydown: monthlyPace != null ? dollars(monthlyPace) : null,
        // Net debt reduction so far THIS calendar month (positive = paid down,
        // negative = grew). The user's current-behavior signal — quote it when
        // they ask how they're doing "this month" / "lately".
        paidThisMonth: netPaidThisMonth != null ? dollars(netPaidThisMonth) : null,
        // Projected debt-free finish line at the current pace. onTrack is false
        // (with a reason) when there isn't enough progress to project honestly —
        // do NOT invent a date in that case.
        debtFreeDate: debtFreeProjection.onTrack ? debtFreeProjection.debtFreeDate : null,
        monthsToDebtFree: debtFreeProjection.onTrack ? debtFreeProjection.monthsToZero : null,
        debtFreeOnTrack: debtFreeProjection.onTrack === true,
      },
      interest: {
        monthlyCost: monthlyInterest,
        topAccount: topInterest && {
          name: safe(topInterest.name),
          monthlyCost: topInterest.monthlyCost,
          apr: topInterest.apr,
          balance: topInterest.balance,
        },
      },
      accounts: payloadAccounts,
      payoffPlan,
      turnDeltas,
      forecasts,
      snapshotTrail,
    },
  };
}

module.exports = {
  buildContext,
  markIfDoNothingFired,
  markQuarterlyLetterFired,
  // Exported for tests / debug routes:
  monthlyInterestCost,
  highestInterestAccount,
  avgDailyPaydown,
  paydownOverWindow,
  forecastTierDates,
};
