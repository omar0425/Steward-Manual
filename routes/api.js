'use strict';

const express = require('express');
const router  = express.Router();
const { Readable } = require('stream');

const {
  latestSnapshot,
  recentSnapshots,
  exportUserData,
  importUserData,
  getConfig,
  withUser,
  transaction,
  setConfig,
  deleteConfigByPrefix,
  getDebtAccountHistory,
  getGameStart,
  resetAllGameState,
  initGameState,
  insertSnapshot,
  replaceDebtAccountBalances,
  appendDebtAccountHistory,
  debtAccountHistoryRows,
  lastNonZeroFinancials,
  getAllDebtAccountBalances,
  getDebtAccountFirstBalances,
  markDebtAccountVerified,
  getDebtAccountVerifiedAt,
  savePushSubscription,
  deletePushSubscription,
} = require('../db');
const { monthlyPaceFromSnapshots, projectDebtFree, paidThisMonth, averageMonthlyPaydown, suggestedMonthlyTarget } = require('../services/pace');
const { monthlyPaydownSamples, monteCarloPayoff, effectiveAnnualAprPct } = require('../services/forecast');
const { buildPayoffPlan, interestSavedSinceStart } = require('../services/payoffPlan');
const { isCutsceneUser, paydownTriggersCutscene, selectCutsceneVideo } = require('../services/cutscene');
const {
  getClimbTier,
  nextClimbTierInfo,
  climbTierBandProgress,
  climbTierJourneyProgress,
  explainDebtTierBandProgress,
} = require('../services/tiers');
const {
  clearLastDebtSyncDebug,
  getClimbStatsFromConfig,
  reclassifyAddedDebt,
  recomputeClimbTotalsFromHistory,
  captureUndoState,
  undoLastPull,
  hasUndoState,
  peekUndoLabel,
  getLastDebtSyncDebugForStatus,
  computeStreak,
  removalSafeStreakSeries,
  applyClimbMetricsOnPull,
  KEY_MAP_SEEDED,
  setLastDebtSyncDebug,
  persistLastDebtSyncDebugSnapshot,
  perAccountDebtDeltaDisplayRows,
  buildCorrectedDebtSeries,
  recentCorrectedSnapshots,
  roundMoney,
} = require('../services/climbMetrics');
const {
  computeStability,
  stabilityNarrative,
} = require('../services/stability');
const stewardAi = require('../services/stewardAi');
const stewardAiContext = require('../services/stewardAiContext');
const stewardAiLedger = require('../services/stewardAiLedger');
const { findUserById, listAllUsers } = require('../db-auth');

router.use((req, res, next) => {
  withUser(req.user && req.user.userId, next);
});

// Config values are stored as JSON strings; tolerate missing/malformed data.
function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

// ── Monte Carlo forecast cache (per snapshot) ─────────────────────────────────
const FORECAST_CACHE_PREFIX = 'payoff_forecast_at:';

// Stable fingerprint of the forecast inputs. If any of these change the cached
// result is stale and we recompute; otherwise reloads reuse it for free.
function forecastSignature(currentDebt, samples, avgApr) {
  let sum = 0;
  for (const x of samples) sum += Number(x) || 0;
  return [
    Math.round(Number(currentDebt) * 100) || 0,
    samples.length,
    Math.round(sum * 100),
    Math.round((Number(avgApr) || 0) * 100),
  ].join('|');
}

function getCachedForecast(pulledAt, currentDebt, samples, avgApr) {
  const sig = forecastSignature(currentDebt, samples, avgApr);
  const key = FORECAST_CACHE_PREFIX + pulledAt;
  const raw = getConfig(key);
  if (raw) {
    try {
      const cached = JSON.parse(raw);
      if (cached && cached.sig === sig && cached.result) return cached.result;
    } catch { /* fall through and recompute */ }
  }
  const result = monteCarloPayoff(currentDebt, samples, { annualAprPct: avgApr });
  // Only the latest snapshot's forecast is ever needed — drop stale keys so this
  // never accumulates one row per historical snapshot.
  deleteConfigByPrefix(FORECAST_CACHE_PREFIX);
  setConfig(key, JSON.stringify({ sig, result }));
  return result;
}

// ── GET /api/status ───────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const debugDebtTier =
    req.query.debugDebtTier === '1';
  const snap = latestSnapshot();

  if (!snap) {
    return res.json({
      ready: false,
      noData: true,
      message: 'No data yet. Use the entry form to add your first snapshot.',
      lastError: null,
    });
  }

  const { gameStartDebt, gameStartAt } = getGameStart();
  const setupDebtSync = getLastDebtSyncDebugForStatus();
  let setupDebtAccountLines =
    setupDebtSync && Array.isArray(setupDebtSync.current_account_lines)
      ? setupDebtSync.current_account_lines
      : null;
  if (Array.isArray(setupDebtAccountLines) && setupDebtAccountLines.length) {
    // Same reconcile-stamp join the play-mode branch does below, so the
    // saved-debts rows read consistently during setup too.
    const setupVerifiedAt = getDebtAccountVerifiedAt();
    setupDebtAccountLines = setupDebtAccountLines.map((line) => ({
      ...line,
      lastVerifiedAt: setupVerifiedAt.get(String(line.id)) || null,
    }));
  }

  if (gameStartDebt == null) {
    // Tailor setup message based on whether the user actually has debt to
    // climb. A debt-free user hitting "In the hole" / "Add every debt" copy
    // reads as a bug from their perspective.
    const isDebtFree = Number(snap.debt_remaining) === 0 && Number(snap.total_debt) === 0;
    const message = isDebtFree
      ? 'No debt to track yet. When you have one, add it and start the climb. Until then, your snapshots still log net-worth history.'
      : 'Debt setup saved. Add every debt, then lock your starting debt to begin.';
    return res.json({
      ready: false,
      setupIncomplete: true,
      debtFree: isDebtFree,
      noData: false,
      message,
      lastError: null,
      aiEnabled: stewardAi.isConfigured(),
      stats: {
        debtRemaining: snap.debt_remaining,
        totalDebt: snap.total_debt,
        debtAccountLines: setupDebtAccountLines,
        gameStartDebt,
        gameStartAt,
      },
      meta: {
        lastSnapshotAt: snap.pulled_at,
        freshness: 'Setup',
        nextScheduled: null,
      },
    });
  }

  const snapshots = recentSnapshots(60);
  const climb     = getClimbStatsFromConfig();
  const tierObj   = getClimbTier(snap.debt_remaining, climb.climbBaselineDebt);
  const next      = nextClimbTierInfo(snap.debt_remaining, climb.climbBaselineDebt);
  const bandProg  = climbTierBandProgress(snap.debt_remaining, tierObj, climb.climbBaselineDebt);
  const nextGapRounded = Math.round(next.gapDollars * 100) / 100;
  const debtTierJourney = climbTierJourneyProgress(
    snap.debt_remaining,
    tierObj,
    nextGapRounded,
    next.nextTier,
    climb.climbBaselineDebt,
  );
  const debtTierBand =
    tierObj.id === 'wealthy'
      ? {
          bandLower: null,
          bandUpper: null,
          span: null,
          pctInBandRaw: 100,
          pctInBand: 100,
        }
      : {
          bandLower: bandProg.bandLower,
          bandUpper: bandProg.bandUpper,
          span: bandProg.span,
          pctInBandRaw: bandProg.pctInBandRaw,
          pctInBand: bandProg.pctInBand,
        };

  const investmentValue = snap.investment_value || 0;
  const adjustedNetWorth = snap.total_assets + investmentValue - snap.total_debt;

  const stabilityRaw = computeStability({
    safetyLiquid: snap.safety_liquid,
    totalAssets: snap.total_assets,
    monthlyExpenses: snap.monthly_expenses,
    debtRemaining: snap.debt_remaining,
    monthsAhead: snap.months_ahead,
  });
  const stabilityNarr = stabilityNarrative(tierObj.id, stabilityRaw);
  const stability = {
    ...stabilityRaw,
    narrative: stabilityNarr,
  };

  // Freshness label. "Live" implies "right now" to users; a 55-minute-old
  // snapshot wearing that label is dishonest. Add a "Recent" band for the
  // <1h window past the first ~10 minutes so the label tracks reality.
  const pulledAt  = new Date(snap.pulled_at);
  const ageMs     = Date.now() - pulledAt.getTime();
  const ageMin    = ageMs / (1000 * 60);
  const ageHours  = ageMs / (1000 * 60 * 60);
  let freshness;
  if (ageMin < 10)         freshness = 'Live';
  else if (ageHours < 1)   freshness = 'Recent';
  else if (ageHours < 48)  freshness = `${Math.floor(ageHours)}h ago`;
  else                     freshness = 'Stale >48h';

  // Streak from a per-account-delta series: only balance changes on accounts
  // present in BOTH consecutive pulls count, so neither a setup-time "forgot this
  // debt" addition (which spikes raw debt upward and would falsely BREAK a streak)
  // nor fully removing/untracking an account (which drops the aggregate with no
  // payment and would falsely INFLATE it) affects the momentum counter. Falls back
  // to the correction-aware snapshots for legacy aggregate-only users with no
  // per-account history.
  const streakSeries = removalSafeStreakSeries(debtAccountHistoryRows(), { gameStartAt });
  const streak = computeStreak(
    streakSeries.length >= 2
      ? streakSeries
      : recentCorrectedSnapshots({ gameStartAt, fallback: snapshots }),
  );
  const lastDebtSync = getLastDebtSyncDebugForStatus();
  const aggregatePaydownSinceGameStart =
    Number.isFinite(Number(gameStartDebt)) && Number.isFinite(Number(snap.debt_remaining))
      ? Math.max(0, Math.round((Number(gameStartDebt) - Number(snap.debt_remaining)) * 100) / 100)
      : 0;

  // "Last pull" rows are the per-turn deltas persisted at /snapshot time
  // (prevBalances → debtBalanceMap), not the last-N-pulls aggregate. Mixing
  // windows previously confused users: a fresh paydown of $1,500 would render
  // as the cumulative-since-baseline delta on the same card.
  const rawLastPullAccountLines =
    lastDebtSync && Array.isArray(lastDebtSync.account_lines) ? lastDebtSync.account_lines : null;
  let debtAccountLines =
    lastDebtSync && Array.isArray(lastDebtSync.current_account_lines)
      ? lastDebtSync.current_account_lines
      : null;
  if (!debtAccountLines) {
    // No last-pull debug snapshot (e.g. right after an undo, which clears it).
    // Fall back to the AUTHORITATIVE per-account balances so the panel still
    // shows real numbers — not just names. Reading balances only from the debug
    // snapshot made an undo look like it wiped every account.
    const nameMap = parseJsonObject(getConfig('debt_account_name_map'));
    const balances = getAllDebtAccountBalances();
    if (balances.size > 0) {
      debtAccountLines = [...balances.entries()].map(([id, balance]) => ({
        id,
        name: nameMap[id] || 'Account',
        balance,
      }));
    } else if (Object.keys(nameMap).length > 0) {
      debtAccountLines = Object.entries(nameMap).map(([id, name]) => ({ id, name }));
    }
  }

  // Per-account paid-down percentage: how far each card has come from its
  // original (first-ever recorded) balance. Attached for the panel to render.
  if (Array.isArray(debtAccountLines) && debtAccountLines.length) {
    const firstBalances = getDebtAccountFirstBalances();
    // Reconcile stamps — when the user last confirmed each balance against the
    // real account (via the ✓ tick or by entering a changed number).
    const verifiedAt = getDebtAccountVerifiedAt();
    debtAccountLines = debtAccountLines.map((line) => {
      const start = Number(firstBalances.get(String(line.id)));
      const bal = Number(line.balance);
      const out = { ...line, lastVerifiedAt: verifiedAt.get(String(line.id)) || null };
      if (Number.isFinite(start) && start > 0 && Number.isFinite(bal)) {
        const pct = Math.max(0, Math.min(100, Math.round(((start - bal) / start) * 1000) / 10));
        return { ...out, startBalance: roundMoney(start), pctPaid: pct };
      }
      return out;
    });
  }

  const lastPullAccountLines = rawLastPullAccountLines || [];
  let lastPullPaydownSum = 0;
  let lastPullNewDebtSum = 0;
  for (const line of lastPullAccountLines) {
    // Removing an account is not a payment — it must not inflate the "This Turn"
    // paydown the way it would a real balance decrease. Cumulative paid-down
    // already excludes removals; keep this consistent so the two never disagree.
    if (line && line.kind === 'removed') continue;
    const d = Number(line && line.delta);
    if (Number.isFinite(d)) {
      if (d < 0) lastPullPaydownSum += Math.abs(d);
      else if (d > 0) lastPullNewDebtSum += d;
    }
  }
  lastPullPaydownSum = Math.round(lastPullPaydownSum * 100) / 100;
  lastPullNewDebtSum = Math.round(lastPullNewDebtSum * 100) / 100;
  // No per-account lines this pull (aggregate-mode entry). Derive the real
  // THIS-TURN delta from the prior snapshot rather than overwriting it with the
  // cumulative-since-game-start figure, which made every status load misreport a
  // single turn as the whole climb's progress.
  if (lastPullPaydownSum === 0 && lastPullNewDebtSum === 0 && lastPullAccountLines.length === 0) {
    if (snapshots.length >= 2
        && Number.isFinite(Number(snapshots[0].debt_remaining))
        && Number.isFinite(Number(snapshots[1].debt_remaining))) {
      const turnDelta = Math.round((Number(snapshots[1].debt_remaining) - Number(snapshots[0].debt_remaining)) * 100) / 100;
      if (turnDelta > 0) lastPullPaydownSum = turnDelta;       // paid down this turn
      else if (turnDelta < 0) lastPullNewDebtSum = Math.abs(turnDelta); // added this turn
    } else if (aggregatePaydownSinceGameStart > 0) {
      // Genuine first pull (only one snapshot exists) — show progress vs game start.
      lastPullPaydownSum = aggregatePaydownSinceGameStart;
    }
  }
  const lastPullAccountChanges = lastPullAccountLines;
  const turnStartAt =
    lastDebtSync && lastDebtSync.turn_start_at ? lastDebtSync.turn_start_at : null;

  // Debt direction
  let debtDirection = 'unknown';
  if (snapshots.length >= 2) {
    const latest = snapshots[0].debt_remaining;
    const previous = snapshots[1].debt_remaining;
    if (Number.isFinite(latest) && Number.isFinite(previous)) {
      if (latest < previous) debtDirection = 'decreasing';
      else if (latest > previous) debtDirection = 'increasing';
      else debtDirection = 'stable';
    }
  }

  // Net worth history for chart
  const sortedSnaps = snapshots.slice().sort((a, b) => (a.pulled_at < b.pulled_at ? -1 : 1));
  const netWorthHistory = sortedSnaps.map((s) => ({
    date: s.pulled_at,
    netWorth: parseFloat((s.total_assets - s.total_debt).toFixed(2)),
    totalAssets: s.total_assets,
    totalDebt: s.total_debt,
  }));

  // Recent milestones: things that happened on the latest pull worth telling
  // the user about. Tier transitions previously slid by silently; paid-off
  // accounts emit no celebration. Each milestone has a stable `id`; the
  // server filters out IDs already recorded in notifications_sent so the
  // banner shows once per event, not on every refresh.
  const seenIds = new Set(parseJsonArray(getConfig('notifications_sent')));
  const candidateMilestones = [];
  if (snapshots.length >= 2 && snapshots[0].tier && snapshots[1].tier
      && snapshots[0].tier !== snapshots[1].tier) {
    candidateMilestones.push({
      id: `tier-change:${snapshots[1].tier}->${snapshots[0].tier}:${snap.pulled_at}`,
      type: 'tier-change',
      from: snapshots[1].tier,
      to: snapshots[0].tier,
      at: snap.pulled_at,
    });
  }
  for (const line of lastPullAccountLines) {
    if (line && line.kind === 'paid_off') {
      candidateMilestones.push({
        id: `account-paid-off:${line.name}:${snap.pulled_at}`,
        type: 'account-paid-off',
        accountName: line.name,
        at: snap.pulled_at,
      });
    }
  }
  // Paydown milestones — a small win each time Total Cleared crosses a threshold.
  // Permanent achievements (no timestamp in the id): dedup fires each once, ever.
  const PAYDOWN_MILESTONES = [1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const totalCleared = Number(climb.cumulativePaidDown) || 0;
  for (const threshold of PAYDOWN_MILESTONES) {
    if (totalCleared >= threshold) {
      candidateMilestones.push({ id: `paydown:${threshold}`, type: 'paydown-milestone', amount: threshold });
    }
  }
  const recentMilestones = candidateMilestones.filter((m) => !seenIds.has(m.id));

  // monthsEstimate: average monthly paydown from recent snapshots, applied to
  // the gap to the next climb tier. Requires at least a day of elapsed time
  // across the sample to avoid noisy estimates from rapid-fire snapshots
  // (e.g. correcting a typo) where dividing by near-zero elapsed time gives a
  // bogus "1 month away" answer.
  let monthsEstimateClimb = null;
  // Correction-aware history (same series the chart uses): setup-time account
  // additions are carried back so they don't read as debt growth and skew the
  // pace/forecast. Falls back to raw snapshots for legacy aggregate-only users.
  const paceSnapshots = recentCorrectedSnapshots({ gameStartAt, fallback: snapshots });
  // Shared span-gated monthly pace — same helper the Steward forecasts use,
  // so the dashboard estimate and the AI dates can never disagree, and a
  // burst of same-week entries can't produce a bogus "1 month away".
  const monthlyPace = monthlyPaceFromSnapshots(paceSnapshots);
  if (next.nextTier && next.gapDollars > 0 && monthlyPace && monthlyPace > 0) {
    monthsEstimateClimb = Math.ceil(next.gapDollars / monthlyPace);
  }
  // Projected debt-free date + this-month progress, from the same real history.
  const debtFreeProjection = projectDebtFree(paceSnapshots, snap.debt_remaining, { monthlyPace });
  const netPaidThisMonth = paidThisMonth(paceSnapshots);
  // Lifetime average paid down per month (Total Cleared ÷ months since start).
  const avgMonthlyPayment = averageMonthlyPaydown(climb.cumulativePaidDown, gameStartAt);

  // "Pay this next" — avalanche (highest APR) + snowball (smallest balance),
  // from authoritative balances joined with stored APRs and names.
  const planRates = parseJsonObject(getConfig('interest_rates'));
  const planNames = parseJsonObject(getConfig('debt_account_name_map'));
  const planFirstBalances = getDebtAccountFirstBalances();
  const planAccounts = [...getAllDebtAccountBalances().entries()].map(([id, balance]) => ({
    id,
    name: planNames[id] || 'Account',
    balance,
    apr: planRates[id],
    startBalance: Number(planFirstBalances.get(String(id))),
  }));
  const payoffPlan = buildPayoffPlan(planAccounts);
  // Attach payment terms: the sum of known minimum payments across accounts
  // that still carry a balance. Lets the "Pay this next" card say "cover your
  // ~$X of minimums first, then put every extra dollar here" — which is the
  // actually-correct avalanche/snowball instruction.
  if (payoffPlan) {
    const planTerms = parseJsonObject(getConfig('debt_terms'));
    let minimumsMonthly = 0;
    let minimumsKnown = 0;
    for (const a of planAccounts) {
      const t = planTerms[a.id];
      const min = t && Number(t.minPayment);
      if (Number(a.balance) > 0 && Number.isFinite(min) && min > 0) {
        minimumsMonthly += min;
        minimumsKnown += 1;
      }
    }
    payoffPlan.minimumsMonthly = Math.round(minimumsMonthly * 100) / 100;
    payoffPlan.minimumsKnown = minimumsKnown;
  }
  // "Interest saved" — how much less interest your balances cost per month now
  // versus your starting balances (money paydown has kept from the bank).
  const interestSaved = interestSavedSinceStart(planAccounts);

  // Probabilistic payoff (Monte Carlo over the user's own logged paydown), now
  // also carrying the effective APR so it returns a remaining-interest band and
  // the interest the paydown is projected to save vs treading water.
  // Balance-weighted average APR across debts that have a rate set (0 if none).
  // Surfaced on the dashboard and reused as the forecast's effective APR so the
  // two never disagree.
  const avgApr = effectiveAnnualAprPct(planAccounts);
  // Monte Carlo runs up to 2000 simulated payoff paths; recomputing it on every
  // /status load is wasted work (and, for an erratic payer, a real event-loop
  // cost). Cache the result per snapshot, keyed by a signature of the actual
  // inputs (current debt, the paydown samples, and the effective APR) so it's
  // reused across reloads but recomputed whenever any input changes — e.g. an
  // APR edit or an undo that doesn't add a new snapshot.
  const forecastSamples = monthlyPaydownSamples(paceSnapshots);
  const payoffForecast = getCachedForecast(snap.pulled_at, snap.debt_remaining, forecastSamples, avgApr);
  // Interest kept from the bank SO FAR — savings rate vs starting balances,
  // applied across the months since the climb started. Deterministic, honest.
  let monthsSinceStart = 0;
  if (gameStartAt) {
    const ms = Date.now() - Date.parse(gameStartAt);
    if (Number.isFinite(ms) && ms > 0) monthsSinceStart = ms / 86400000 / 30.44;
  }
  const interestSavedToDate = interestSaved.hasApr && interestSaved.savedMonthly > 0
    ? Math.round(interestSaved.savedMonthly * monthsSinceStart)
    : 0;

  // Bug #1 — an APR-COMPUTED estimate of interest accrued since the climb began,
  // shown alongside the user-logged figure. interestAccrued only counts interest
  // the user tagged; this estimates the real cost from current APRs × balances ×
  // months elapsed. It's approximate (current balances, and understated while any
  // APR is missing), so the client labels it "est." and flags missing APRs.
  let currentMonthlyInterest = 0;
  let anyAprMissing = false;
  for (const a of planAccounts) {
    const apr = Number(a.apr);
    const bal = Number(a.balance);
    // 0% is a valid, set rate (promo financing); "missing" = never entered.
    const aprSet = a.apr != null && a.apr !== '' && Number.isFinite(apr) && apr >= 0;
    if (Number.isFinite(bal) && bal > 0 && !aprSet) anyAprMissing = true;
    if (aprSet && apr > 0 && Number.isFinite(bal) && bal > 0) currentMonthlyInterest += (bal * apr) / 100 / 12;
  }
  const estimatedInterestAccrued = currentMonthlyInterest > 0
    ? Math.round(currentMonthlyInterest * monthsSinceStart)
    : 0;

  const payload = {
    ready: true,
    tier: tierObj,
    stability,
    streak,
    recentMilestones,
    aiEnabled: stewardAi.isConfigured(),
    // Personal easter egg: armed by the snapshot route on a $500+ debt drop for
    // the cutscene user. The dashboard plays it once, then POSTs cutscene-seen.
    cutsceneReady: getConfig('pending_cutscene') === '1',
    // One-shot "account CLEARED" celebration(s) armed by the snapshot route
    // when a balance hits exactly 0. Dismissed via account-cleared-seen.
    accountCleared: parseJsonArray(getConfig('pending_account_cleared')),
    stats: {
      debtRemaining:    snap.debt_remaining,
      debtDirection,
      climbBaselineDebt:     climb.climbBaselineDebt,
      cumulativePaidDown:    climb.cumulativePaidDown,
      cumulativeNewDebtAdded: climb.cumulativeNewDebtAdded,
      cumulativeInterestAccrued: climb.cumulativeInterestAccrued,
      estimatedInterestAccrued,
      estimatedInterestUnderstated: anyAprMissing,
      canUndo:               hasUndoState(),
      undoLabel:             peekUndoLabel(),
      monthlyPace:           monthlyPace || 0,
      debtFree:              debtFreeProjection,
      paidThisMonth:         netPaidThisMonth,
      avgMonthlyPayment,
      suggestedMonthly: suggestedMonthlyTarget(snap.debt_remaining),
      payoffForecast,
      interestSavedToDate,
      payoffPlan,
      interestSaved,
      // Balance-weighted average APR across debts with a rate set (0 = none set).
      // avgAprMissing flags that at least one positive balance has no APR, so the
      // average is computed over only the rated balances.
      avgApr,
      avgAprMissing: anyAprMissing,
      netImprovement:        climb.netImprovement,
      debtPaid:              climb.cumulativePaidDown,
      debtStart:             climb.climbBaselineDebt,
      pctPaid:               climb.pctPaid,
      debtTierBand,
      debtTierJourney,
      debtTierBandPct:  bandProg.pctInBand,
      netWorth:         parseFloat(adjustedNetWorth.toFixed(2)),
      totalAssets:      snap.total_assets,
      safetyLiquid:     snap.safety_liquid,
      totalDebt:        snap.total_debt,
      investmentValue:  investmentValue,

      monthsAhead:      snap.months_ahead,
      debtAccountLines,
      lastPullNewDebtSum,
      lastPullPaydownSum,
      lastPullAccountLines,
      lastPullAccountChanges,
      turnStartAt,
      gameStartDebt,
      gameStartAt,
    },
    nextTier: next.nextTier
      ? {
          id:             next.nextTier.id,
          label:          next.nextTier.label,
          badge:          next.nextTier.badge,
          gapDollars:     Math.round(next.gapDollars * 100) / 100,
          monthsEstimate: monthsEstimateClimb,
          nextCopy:       next.currentTier.nextCopy,
        }
      : null,
    meta: {
      lastSnapshotAt:     snap.pulled_at,
      freshness,
      nextScheduled:       null,
    },
    netWorthHistory,
    // Correction-aware debt line: forgotten debts carried back so they don't
    // read as spikes; genuinely-new loans still rise. The chart prefers this.
    correctedDebtSeries: buildCorrectedDebtSeries(debtAccountHistoryRows(), {
      originById: parseJsonObject(getConfig('debt_account_origin')),
      gameStartAt,
    }),
  };

  if (debugDebtTier) {
    payload.debug = {
      debtTierBand: explainDebtTierBandProgress(
        snap.debt_remaining,
        tierObj,
        snapshots,
        climb.climbBaselineDebt,
      ),
    };
  }

  res.json(payload);
});

// ── POST /api/snapshot (MANUAL ENTRY) ────────────────────────────────────────
//
// Body: {
//   totalAssets:    number,    (liquid + savings — what you own)
//   totalDebt:      number,    (total liabilities)
//   monthlyIncome:  number,    (optional, default 0)
//   monthlyExpenses:number,    (optional, default 0)
//   investmentValue:number,    (optional, default 0)
//   debtAccounts: [            (optional — individual debt accounts)
//     { id: "cc-visa", name: "Visa", balance: 4500 },
//     { id: "car-loan", name: "Car Loan", balance: 12000 },
//   ]
// }

function isNegativeFinite(n) {
  const x = Number(n);
  return Number.isFinite(x) && x < 0;
}

// Upper bound on any single money field / account balance. A value like 1e307
// is finite (so it passes Number.isFinite) but `x * 100` inside roundMoney
// overflows to Infinity, which then poisons the stored REAL column and every
// downstream sum. $1e12 is far above any real personal debt while staying well
// clear of the overflow threshold.
const MAX_MONEY = 1e12;
function exceedsMoneyCap(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > MAX_MONEY;
}
// Cap the number of debt accounts per pull. Each account drives several
// synchronous SQLite writes; an unbounded array (bounded only by the body size
// limit) would block the event loop for every other user.
const MAX_DEBT_ACCOUNTS = 200;

router.post('/snapshot', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (Object.keys(body).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Snapshot body is empty. Include totalAssets, totalDebt, or debtAccounts.',
      });
    }
    const {
      totalAssets = 0,
      totalDebt = 0,
      monthlyIncome = 0,
      monthlyExpenses = 0,
      investmentValue = 0,
      debtAccounts = [],
      // Account ids the user flagged as "I already had this debt, just hadn't
      // tracked it" — folded into the baseline rather than counted as new debt.
      // (Legacy shape; superseded by `classifications` below but still honored.)
      preexistingAccountIds = [],
      // Per-account category for this pull's increases / new accounts:
      // { accountId: 'purchase' | 'new_loan' | 'interest' | 'preexisting' }.
      classifications = {},
    } = body;

    const moneyFields = {
      totalAssets,
      totalDebt,
      monthlyIncome,
      monthlyExpenses,
      investmentValue,
    };
    const negativeField = Object.entries(moneyFields).find(([, value]) => isNegativeFinite(value));
    if (negativeField) {
      return res.status(400).json({
        ok: false,
        error: `${negativeField[0]} cannot be negative`,
      });
    }
    const oversizedField = Object.entries(moneyFields).find(([, value]) => exceedsMoneyCap(value));
    if (oversizedField) {
      return res.status(400).json({
        ok: false,
        error: `${oversizedField[0]} is unrealistically large (max ${MAX_MONEY}).`,
      });
    }
    // Reject non-finite money fields. Silent coercion (Number("$3,000") → NaN → 0)
    // previously zeroed totals and credited phantom paydown.
    for (const [name, value] of Object.entries(moneyFields)) {
      if (value !== undefined && value !== null && value !== '' && !Number.isFinite(Number(value))) {
        return res.status(400).json({
          ok: false,
          error: `${name} must be a number (got ${JSON.stringify(value)})`,
        });
      }
    }

    // Preserve non-zero financial fields when user submits 0 (blank form fields)
    // by walking back to the last non-zero snapshot. Surface which fields were
    // swapped so the response can tell the user — silent preservation has
    // confused users who couldn't see why their input was ignored. A genuine
    // zero can be recorded by passing { allowZero: true }.
    const allowZero = body.allowZero === true;
    const prevFinancials = lastNonZeroFinancials();
    const preservedFields = [];
    const resolveFinancial = (submitted, prevField, label) => {
      const s = roundMoney(submitted);
      if (s > 0) return s;
      if (allowZero) return s; // explicit opt-in: record 0 verbatim
      const p = prevFinancials ? roundMoney(prevFinancials[prevField] || 0) : 0;
      if (p > 0 && Number(submitted) === 0) {
        preservedFields.push({ field: label, value: p });
      }
      return p;
    };

    const assets   = resolveFinancial(totalAssets,    'total_assets',     'totalAssets');
    // Debt is tracked in whole dollars so displayed line items always sum to the
    // displayed total (no hidden cents → no "$20,000 ×3 = $60,001").
    const debt     = Math.round(roundMoney(totalDebt));
    const income   = resolveFinancial(monthlyIncome,  'monthly_income',   'monthlyIncome');
    const expenses = resolveFinancial(monthlyExpenses,'monthly_expenses', 'monthlyExpenses');
    const invest   = resolveFinancial(investmentValue,'investment_value', 'investmentValue');
    const now      = new Date().toISOString();
    const gameActive = getGameStart().gameStartDebt != null;

    // Compute debt_remaining from individual accounts if provided, else use totalDebt
    let debtRemaining = debt;
    const debtBalanceMap = new Map();
    const debtDisplayRows = [];

    if (Array.isArray(debtAccounts) && debtAccounts.length > 0) {
      if (debtAccounts.length > MAX_DEBT_ACCOUNTS) {
        return res.status(400).json({
          ok: false,
          error: `Too many debt accounts (max ${MAX_DEBT_ACCOUNTS}).`,
        });
      }
      let sumFromAccounts = 0;
      for (const acct of debtAccounts) {
        if (!acct || typeof acct !== 'object') {
          return res.status(400).json({ ok: false, error: 'debtAccounts entries must be objects' });
        }
        // Cap the id length too — it's a map key and a stored column; only `name`
        // was previously bounded.
        const id  = String(acct.id || `acct-${debtDisplayRows.length}`).slice(0, 100);
        if (debtBalanceMap.has(id)) {
          return res.status(400).json({ ok: false, error: `Duplicate debt account id: ${id}` });
        }
        if (isNegativeFinite(acct.balance)) {
          return res.status(400).json({ ok: false, error: `Debt account ${id} balance cannot be negative` });
        }
        if (exceedsMoneyCap(acct.balance)) {
          return res.status(400).json({ ok: false, error: `Debt account ${id} balance is unrealistically large (max ${MAX_MONEY}).` });
        }
        // Reject missing or non-finite balances. Silent coercion to 0 was the
        // root of two bugs: a typo like "$3,000.00" rolled the user to
        // "wealthy", and an omitted field silently recorded the account as
        // paid off. Both are now explicit 400s.
        if (acct.balance === undefined || acct.balance === null || acct.balance === '') {
          return res.status(400).json({
            ok: false,
            error: `Debt account ${id} is missing a balance. Send 0 explicitly to mark it paid off.`,
          });
        }
        if (!Number.isFinite(Number(acct.balance))) {
          return res.status(400).json({
            ok: false,
            error: `Debt account ${id} balance must be a number (got ${JSON.stringify(acct.balance)})`,
          });
        }
        const bal = Math.round(roundMoney(acct.balance));
        const rawName = typeof acct.name === 'string' && acct.name.trim() ? acct.name.trim() : 'Account';
        const name = rawName.slice(0, 100);
        // Keep zero balances in the map so explicit payoff (prev=X → curr=0)
        // is credited as paydown by the per-account diff. Accounts removed
        // entirely from the input still go through the "removed → no effect"
        // path, which is the right behavior for data cleanup / renames.
        sumFromAccounts += bal;
        debtBalanceMap.set(id, bal);
        debtDisplayRows.push({ id, name, balance: bal, paidOff: bal === 0 });
      }
      debtRemaining = roundMoney(sumFromAccounts);
    }

    // Safety liquid: use total assets as proxy (all manually entered assets are presumed liquid)
    const safetyLiquid = assets;

    // Months ahead (simple: assets / expenses)
    const monthsAhead = expenses > 0 ? roundMoney(assets / expenses) : null;

    // ── Increase classifications ──────────────────────────────────────────
    // Every balance increase (or new account) this pull is routed by category:
    // purchases/new loans count as new debt, interest is tracked separately, and
    // debt the user only now remembered ('preexisting') folds into the baseline
    // so it never reads as back-sliding. The routing itself lives in
    // applyClimbMetricsOnPull; here we just assemble the per-account map. The
    // legacy `preexistingAccountIds` array is honored as 'preexisting'.
    const increaseClassifications = {};
    if (classifications && typeof classifications === 'object' && !Array.isArray(classifications)) {
      for (const [id, cat] of Object.entries(classifications)) {
        if (typeof cat === 'string') increaseClassifications[String(id)] = cat;
      }
    }
    for (const rawId of Array.isArray(preexistingAccountIds) ? preexistingAccountIds : []) {
      increaseClassifications[String(rawId)] = 'preexisting';
    }

    // ── Record each account's ORIGIN the first time we see it ─────────────────
    // 'baseline' = a debt you always had (setup inventory, an existing account,
    // or one flagged pre-existing) → carried back on the chart so it never reads
    // as back-sliding. 'new' = a genuinely-new loan/spend taken on mid-climb →
    // shown as a real rise. This is the per-entry classification that lets the
    // corrected debt graph be exact going forward.
    if (debtBalanceMap.size > 0) {
      const originMap = parseJsonObject(getConfig('debt_account_origin'));
      const prevForOrigin = getAllDebtAccountBalances();
      let originChanged = false;
      // Write-once per-account starting balance. The per-account "% paid off"
      // was derived from MIN(recorded_at) over the history table, but history is
      // pruned to 30 rows/account — so after ~30 pulls the "start" silently
      // advanced to a later (lower) balance and the badge understated progress.
      // Pinning the true origin here keeps it stable forever.
      const firstBalMap = parseJsonObject(getConfig('debt_account_first_balance'));
      let firstBalChanged = false;
      for (const [id, bal] of debtBalanceMap.entries()) {
        if (firstBalMap[id] == null && Number.isFinite(Number(bal))) {
          firstBalMap[id] = Number(bal);
          firstBalChanged = true;
        }
        if (originMap[id]) continue; // first sighting only
        let origin;
        if (!gameActive) origin = 'baseline';            // setup inventory
        else if (prevForOrigin.has(id)) origin = 'baseline'; // pre-existed our tracking
        else origin = increaseClassifications[id] === 'preexisting' ? 'baseline' : 'new';
        originMap[id] = origin;
        originChanged = true;
      }
      if (originChanged) setConfig('debt_account_origin', JSON.stringify(originMap));
      if (firstBalChanged) setConfig('debt_account_first_balance', JSON.stringify(firstBalMap));
    }

    // Determine tier (relative to climb baseline, falls back to rock_bottom if
    // not yet set). 'preexisting' classifications will bump the baseline inside
    // applyClimbMetricsOnPull below; preview that bump here so the snapshot's
    // stored tier already reflects it and we don't fire a false "stage slipped".
    const climb = getClimbStatsFromConfig();
    let preexistingBumpPreview = 0;
    if (gameActive && debtBalanceMap.size > 0) {
      const prevForPreview = getAllDebtAccountBalances();
      for (const [id, cat] of Object.entries(increaseClassifications)) {
        if (cat !== 'preexisting') continue;
        const curr = debtBalanceMap.get(String(id));
        if (curr == null) continue;
        const prevBal = prevForPreview.get(String(id));
        const inc = prevBal == null ? curr : Math.max(0, roundMoney(curr - prevBal));
        preexistingBumpPreview = roundMoney(preexistingBumpPreview + inc);
      }
    }
    const effectiveBaseline = roundMoney((Number(climb.climbBaselineDebt) || 0) + preexistingBumpPreview);
    const tierObj = getClimbTier(debtRemaining, effectiveBaseline);

    // Insert snapshot — when individual accounts are provided their sum is authoritative
    // for both total_debt and debt_remaining so the two columns stay consistent.
    const effectiveTotalDebt = debtBalanceMap.size > 0 ? debtRemaining : debt;
    const netWorth = roundMoney(assets + invest - effectiveTotalDebt);
    // All writes for this pull are atomic: a crash mid-pull can't leave half-written
    // climb state (snapshot without balances, balances without metrics, etc.).
    transaction(() => {
    const snapshotId = insertSnapshot({
      source:           'manual',
      pulled_at:        now,
      net_worth:        netWorth,
      total_assets:     assets,
      total_debt:       effectiveTotalDebt,
      investment_value: invest,
      debt_remaining:   debtRemaining,
      months_ahead:     monthsAhead,
      monthly_income:   income,
      monthly_expenses: expenses,
      tier:             tierObj.id,
      safety_liquid:    safetyLiquid,
    });

    // Previous total debt, captured before any mutation, so we can tell if this
    // update cleared $500+ (the cutscene trigger).
    let prevTotalDebtForCutscene = null;

    // Update per-account debt tracking. During setup this is inventory only;
    // climb metrics begin after POST /api/start-game locks the baseline.
    if (debtBalanceMap.size > 0) {
      const prevBalances = getAllDebtAccountBalances();
      prevTotalDebtForCutscene = 0;
      for (const v of prevBalances.values()) prevTotalDebtForCutscene += Number(v) || 0;

      // Snapshot the pre-pull state so a wrong entry can be undone exactly.
      // Captured before any mutation, only while the climb is running.
      if (gameActive) captureUndoState(snapshotId, prevBalances, 'update', now);

      replaceDebtAccountBalances(debtBalanceMap);
      appendDebtAccountHistory(debtBalanceMap, now);

      if (gameActive) {
        // Per-account classifications route this pull's increases to new debt,
        // interest, or the baseline (forgot-a-debt) — see applyClimbMetricsOnPull.
        applyClimbMetricsOnPull(debtRemaining, prevBalances, debtBalanceMap, increaseClassifications);

        // Account CLEARED — a balance going >0 → exactly 0 in this pull is the
        // emotional peak of the whole climb. Arm a one-shot celebration the
        // client shows on the next status load (cleared by account-cleared-seen).
        const clearedNow = [];
        const firstBalances = getDebtAccountFirstBalances();
        for (const [id, bal] of debtBalanceMap) {
          const prevBal = Number(prevBalances.get(id));
          if (bal === 0 && Number.isFinite(prevBal) && prevBal > 0) {
            const row = debtDisplayRows.find((r) => r.id === id);
            const start = Number(firstBalances.get(String(id)));
            clearedNow.push({
              id,
              name: (row && row.name) || 'Account',
              startBalance: Number.isFinite(start) && start > 0 ? Math.round(start) : Math.round(prevBal),
              clearedAt: now,
            });
          }
        }
        if (clearedNow.length > 0) {
          setConfig('pending_account_cleared', JSON.stringify(clearedNow));
        }
      }

      // Build display rows for the debt sync debug
      const displayRows = gameActive
        ? perAccountDebtDeltaDisplayRows(prevBalances, debtBalanceMap, debtDisplayRows)
        : [];
      const debugPayload = {
        pulled_at: now,
        debt_remaining: debtRemaining,
        account_lines: displayRows,
        current_account_lines: debtDisplayRows,
      };
      setLastDebtSyncDebug(debugPayload);
      persistLastDebtSyncDebugSnapshot(debugPayload);
      // Persist name map so the THIS TURN view can resolve names even after a game reset
      const nameMapObj = {};
      for (const r of debtDisplayRows) nameMapObj[r.id] = r.name;
      setConfig('debt_account_name_map', JSON.stringify(nameMapObj));
    } else if (gameActive) {
      // No individual accounts — apply aggregate climb metrics
      captureUndoState(snapshotId, getAllDebtAccountBalances());
      const climb = getClimbStatsFromConfig();
      const lastDebt = climb.lastAggregateDebt;
      if (Number.isFinite(lastDebt)) prevTotalDebtForCutscene = lastDebt;
      if (Number.isFinite(lastDebt) && lastDebt > 0) {
        const delta = roundMoney(debtRemaining - lastDebt);
        if (delta < 0) {
          const paid = roundMoney(Number(getConfig('cumulative_paid_down') || 0) + Math.abs(delta));
          setConfig('cumulative_paid_down', String(paid));
        } else if (delta > 0) {
          const added = roundMoney(Number(getConfig('cumulative_new_debt_added') || 0) + delta);
          setConfig('cumulative_new_debt_added', String(added));
        }
      }
      setConfig('last_aggregate_debt_for_climb', String(debtRemaining));
    }

    // Cutscene trigger: this update cleared $500+ of total debt. Arms a flag the
    // dashboard plays once on its next load (cutscene user only).
    if (gameActive && Number.isFinite(prevTotalDebtForCutscene)) {
      const drop = roundMoney(prevTotalDebtForCutscene - debtRemaining);
      if (paydownTriggersCutscene(req.user && req.user.username, drop)) {
        setConfig('pending_cutscene', '1');
      }
    }
    }); // end transaction — snapshot + balances + history + climb metrics commit together

    const response = {
      ok: true,
      message: 'Snapshot saved.',
      debtRemaining,
      tier: tierObj.id,
      setupIncomplete: !gameActive,
    };
    if (preservedFields.length > 0) {
      response.preservedFields = preservedFields;
      const labels = preservedFields.map((p) => p.field).join(', ');
      response.message = `Snapshot saved. Kept your last non-zero value for: ${labels}. To record an actual zero, resend with "allowZero": true.`;
    }
    return res.json(response);
  } catch (err) {
    console.error('[api] manual snapshot error:', err);
    return res.status(500).json({ ok: false, error: 'Could not save snapshot.' });
  }
});

// ── POST /api/start-game ──────────────────────────────────────────────────────

router.post('/start-game', (req, res) => {
  try {
    const existing = getGameStart();
    if (existing.gameStartAt) {
      // Game already started — re-committing after "Clear local session" must not reset progress
      return res.json({ ok: true, gameStartDebt: existing.gameStartDebt, gameStartAt: existing.gameStartAt });
    }
    const snap = latestSnapshot();
    if (!snap) {
      return res.status(503).json({
        ok: false,
        error: 'No data yet — enter your first snapshot, then try again.',
      });
    }
    // Climb math (% paid, tier bands, gap to next) divides by baseline; baseline 0
    // collapses every band and leaves the user permanently at Stage 01. Reject so
    // a debt-free user gets a clear message instead of degenerate state.
    if (!(Number(snap.debt_remaining) > 0)) {
      return res.status(400).json({
        ok: false,
        error: 'No debt to climb yet. Add at least one debt with a balance > $0 first.',
      });
    }
    initGameState(snap.debt_remaining, snap.pulled_at);
    const { gameStartDebt, gameStartAt } = getGameStart();
    return res.json({ ok: true, gameStartDebt, gameStartAt });
  } catch (err) {
    console.error('[api] start-game', err);
    return res.status(500).json({ ok: false, error: 'Could not start the climb.' });
  }
});

// ── POST /api/reset-game ──────────────────────────────────────────────────────

router.post('/reset-game', (req, res) => {
  try {
    if (!(req.body && req.body.confirm === true)) {
      return res.status(400).json({ ok: false, error: 'confirm: true required to reset game' });
    }
    const summary = resetAllGameState();
    clearLastDebtSyncDebug();
    return res.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[api] reset-game', err);
    return res.status(500).json({ ok: false, error: 'Could not reset the game.' });
  }
});

// ── GET /api/snapshots ────────────────────────────────────────────────────────

router.get('/snapshots', (req, res) => {
  const rows = recentSnapshots(60);
  res.json(rows);
});

// ── GET /api/config/interest-rates ───────────────────────────────────────────

const INTEREST_RATES_KEY = 'interest_rates';

router.get('/config/interest-rates', (req, res) => {
  res.json({ rates: parseJsonObject(getConfig(INTEREST_RATES_KEY)) });
});

// ── POST /api/config/interest-rates ──────────────────────────────────────────

router.post('/config/interest-rates', express.json(), (req, res) => {
  const { rates } = req.body || {};
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) {
    return res.status(400).json({ ok: false, error: 'rates (object) required' });
  }
  const clean = {};
  for (const [id, val] of Object.entries(rates)) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 100) continue;
    clean[String(id)] = Math.round(n * 100) / 100;
  }
  setConfig(INTEREST_RATES_KEY, JSON.stringify(clean));
  res.json({ ok: true, rates: clean });
});

// ── GET/POST /api/config/debt-terms ───────────────────────────────────────────
// Per-account payment terms: minimum monthly payment + statement due day.
// Stored like interest_rates (user preference, survives a game reset). Shape:
//   { terms: { <accountId>: { minPayment?: number, dueDay?: number } } }
// dueDay is the day-of-month (1–31); months shorter than the due day clamp to
// their last day when reminders compute the real date.

const DEBT_TERMS_KEY = 'debt_terms';

router.get('/config/debt-terms', (req, res) => {
  res.json({ terms: parseJsonObject(getConfig(DEBT_TERMS_KEY)) });
});

router.post('/config/debt-terms', express.json(), (req, res) => {
  const { terms } = req.body || {};
  if (typeof terms !== 'object' || terms === null || Array.isArray(terms)) {
    return res.status(400).json({ ok: false, error: 'terms (object) required' });
  }
  const entries = Object.entries(terms);
  if (entries.length > 500) {
    return res.status(400).json({ ok: false, error: 'Too many term entries.' });
  }
  const clean = {};
  for (const [id, t] of entries) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const out = {};
    const min = Number(t.minPayment);
    if (Number.isFinite(min) && min > 0 && min <= 1e7) out.minPayment = Math.round(min * 100) / 100;
    const day = Number(t.dueDay);
    if (Number.isInteger(day) && day >= 1 && day <= 31) out.dueDay = day;
    if (Object.keys(out).length > 0) clean[String(id).slice(0, 100)] = out;
  }
  setConfig(DEBT_TERMS_KEY, JSON.stringify(clean));
  res.json({ ok: true, terms: clean });
});

// ── GET /api/debt-history ─────────────────────────────────────────────────────

router.get('/debt-history', (req, res) => {
  const byAccount = getDebtAccountHistory(30);
  res.json({ byAccount });
});

// ── POST /api/climb/reclassify-added-debt ─────────────────────────────────────
// Retroactive correction: move dollars already counted as "new debt added" into
// either the starting baseline ('preexisting' — debt forgotten at the start) or
// the interest bucket. Caps at the amount actually in the new-debt bucket so the
// metric can never go negative. Returns the refreshed climb stats.
router.post('/climb/reclassify-added-debt', express.json(), (req, res) => {
  try {
    if (getGameStart().gameStartDebt == null) {
      return res.status(400).json({ ok: false, error: 'Start the climb before correcting debt.' });
    }
    const { amount, kind = 'preexisting' } = req.body || {};
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: 'A positive amount is required.' });
    }
    if (kind !== 'preexisting' && kind !== 'interest') {
      return res.status(400).json({ ok: false, error: 'kind must be "preexisting" or "interest".' });
    }
    // Nothing in the new-debt bucket → no-op; don't leave a useless undo entry.
    if (getClimbStatsFromConfig().cumulativeNewDebtAdded <= 0) {
      return res.status(200).json({
        ok: false,
        error: 'Nothing to reclassify — there is no "new debt added" to move.',
      });
    }
    // Capture pre-correction state so this reclassify can be undone too.
    captureUndoState(null, getAllDebtAccountBalances(), 'correction');
    const result = reclassifyAddedDebt(amt, kind);
    if (result.moved <= 0) {
      return res.status(200).json({
        ok: false,
        error: 'Nothing to reclassify — there is no "new debt added" to move.',
      });
    }
    // The correction changed the numbers without a new snapshot — drop any cached
    // AI dialog/quote so the Steward re-reads the corrected figures next time.
    deleteConfigByPrefix('steward_ai_dialog_at:');
    deleteConfigByPrefix('steward_ai_quote_at:');
    return res.json({ ok: true, moved: result.moved, kind: result.kind, stats: getClimbStatsFromConfig() });
  } catch (err) {
    console.error('[api] reclassify-added-debt', err);
    return res.status(500).json({ ok: false, error: 'Reclassification failed.' });
  }
});

// ── POST /api/debt-account/verify ─────────────────────────────────────────────
// Reconcile tick: stamp "I checked this balance against the real account and
// it's still right." Deliberately does NOT create a snapshot — confirming an
// unchanged number is not a turn, so tier / streak / forecast are untouched.
// (A CHANGED balance gets stamped automatically on save; see
// replaceDebtAccountBalances.)
router.post('/debt-account/verify', express.json(), (req, res) => {
  try {
    const id = req.body && req.body.id;
    if (typeof id !== 'string' || id === '' || id.length > 200) {
      return res.status(400).json({ ok: false, error: 'Provide the account id to verify.' });
    }
    const verifiedAt = markDebtAccountVerified(id);
    if (!verifiedAt) {
      return res.status(404).json({ ok: false, error: 'No tracked account with that id.' });
    }
    return res.json({ ok: true, id, verifiedAt });
  } catch (err) {
    console.error('[api] debt-account/verify', err);
    return res.status(500).json({ ok: false, error: 'Could not record the check.' });
  }
});

// ── POST /api/climb/undo-last ─────────────────────────────────────────────────
// Reverse the most recent balance update — for a typo or a mistaken entry. Each
// press steps back one update: it restores the exact pre-pull totals + balances
// and removes that pull's snapshot, instead of logging a fake compensating entry
// (which would inflate both "paid down" and "new debt added").
router.post('/climb/undo-last', express.json(), (req, res) => {
  try {
    if (getGameStart().gameStartDebt == null) {
      return res.status(400).json({ ok: false, error: 'No active climb to undo.' });
    }
    const result = undoLastPull();
    if (!result.undone) {
      return res.status(200).json({ ok: false, error: 'Nothing to undo.' });
    }
    // Undo changed the numbers without a new snapshot — drop any cached AI
    // dialog/quote so stale commentary about the reverted pull can't resurface.
    deleteConfigByPrefix('steward_ai_dialog_at:');
    deleteConfigByPrefix('steward_ai_quote_at:');
    return res.json({ ok: true, ...result, stats: getClimbStatsFromConfig() });
  } catch (err) {
    console.error('[api] undo-last', err);
    return res.status(500).json({ ok: false, error: 'Undo failed.' });
  }
});

// ── Commitment promise (cross-device) ─────────────────────────────────────────
//
// The "I'm in" commitment was localStorage-only, so a returning user on a new
// device/browser was re-asked to commit mid-climb. Persist it per-user so the
// gate only ever shows once. Cleared by reset-game via GAME_STATE_KEYS.

const PROMISE_AT_KEY = 'promise_made_at';
const PROMISE_TEXT_KEY = 'promise_text';
const PROMISE_TEXT_MAX = 280;

router.get('/config/promise', (req, res) => {
  const madeAt = getConfig(PROMISE_AT_KEY) || null;
  res.json({ ok: true, made: !!madeAt, madeAt, text: getConfig(PROMISE_TEXT_KEY) || '' });
});

router.post('/config/promise', express.json(), (req, res) => {
  const { text } = req.body || {};
  if (text != null && typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text must be a string' });
  }
  if (!getConfig(PROMISE_AT_KEY)) {
    setConfig(PROMISE_AT_KEY, new Date().toISOString());
  }
  if (text != null) {
    setConfig(PROMISE_TEXT_KEY, text.trim().slice(0, PROMISE_TEXT_MAX));
  }
  res.json({
    ok: true,
    made: true,
    madeAt: getConfig(PROMISE_AT_KEY),
    text: getConfig(PROMISE_TEXT_KEY) || '',
  });
});

// ── GET /api/config/notifications-sent ────────────────────────────────────────

const NOTIFICATIONS_SENT_KEY = 'notifications_sent';

router.get('/config/notifications-sent', (req, res) => {
  res.json({ sent: parseJsonArray(getConfig(NOTIFICATIONS_SENT_KEY)) });
});

// ── POST /api/config/notifications-sent ───────────────────────────────────────

router.post('/config/notifications-sent', express.json(), (req, res) => {
  const { milestone } = req.body || {};
  if (!milestone || typeof milestone !== 'string') {
    return res.status(400).json({ ok: false, error: 'milestone (string) required' });
  }
  const sent = parseJsonArray(getConfig(NOTIFICATIONS_SENT_KEY));
  if (!sent.includes(milestone)) {
    sent.push(milestone);
    if (sent.length > 100) sent.splice(0, sent.length - 100);
    setConfig(NOTIFICATIONS_SENT_KEY, JSON.stringify(sent));
  }
  res.json({ ok: true, sent });
});

// ── POST /api/config/cutscene-seen ────────────────────────────────────────────
// Clears the armed cutscene so it plays exactly once per trigger.

router.post('/config/cutscene-seen', express.json(), (req, res) => {
  setConfig('pending_cutscene', '0');
  res.json({ ok: true });
});

// ── Web push (payment reminders) ──────────────────────────────────────────────
// Zero-config: the VAPID pair is generated on first use and stored app-side.
// The client fetches the public key, subscribes via the service worker, and
// registers the subscription here. One row per device/browser.

router.get('/push/public-key', (req, res) => {
  try {
    const { getPublicKey } = require('../services/push');
    return res.json({ ok: true, publicKey: getPublicKey() });
  } catch (err) {
    console.error('[api] push/public-key', err);
    return res.status(500).json({ ok: false, error: 'Push is unavailable.' });
  }
});

router.post('/push/subscribe', express.json(), (req, res) => {
  try {
    const sub = req.body && req.body.subscription;
    const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint : null;
    const keys = sub && sub.keys && typeof sub.keys === 'object' ? sub.keys : null;
    if (!endpoint || !endpoint.startsWith('https://') || endpoint.length > 1000 ||
        !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
        keys.p256dh.length > 300 || keys.auth.length > 100) {
      return res.status(400).json({ ok: false, error: 'A valid push subscription is required.' });
    }
    savePushSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[api] push/subscribe', err);
    return res.status(500).json({ ok: false, error: 'Could not save the subscription.' });
  }
});

router.post('/push/unsubscribe', express.json(), (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ ok: false, error: 'endpoint required' });
    }
    const removed = deletePushSubscription(endpoint);
    return res.json({ ok: true, removed });
  } catch (err) {
    console.error('[api] push/unsubscribe', err);
    return res.status(500).json({ ok: false, error: 'Could not remove the subscription.' });
  }
});

// ── POST /api/config/account-cleared-seen ─────────────────────────────────────
// Dismisses the armed "account CLEARED" celebration so it shows exactly once.

router.post('/config/account-cleared-seen', express.json(), (req, res) => {
  setConfig('pending_account_cleared', '');
  res.json({ ok: true });
});

// ── GET /api/cutscene/video ───────────────────────────────────────────────────
// Private: only the cutscene user reaches a real video. The /api mount blocks
// logged-out requests; any other authenticated account gets a 404. For the
// cutscene user we PROXY a random remote clip (forwarding Range so seeking
// works). Proxying — rather than a 302 redirect — keeps the <video> same-origin;
// a cross-origin media redirect failed to load in the browser. Bytes stream
// through, never buffered whole.
router.get('/cutscene/video', async (req, res) => {
  if (!req.user || !isCutsceneUser(req.user.username)) return res.status(404).end();
  // Stable per-play selection from the client's seed so every range request in
  // one playback resolves to the SAME clip (a per-request random pick corrupts
  // seeking — the browser would fetch a byte range of one clip and get another).
  const url = selectCutsceneVideo(req.query && req.query.v);
  if (!url) return res.status(404).end();

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(url, { headers, redirect: 'follow' });
  } catch (err) {
    console.error('[cutscene] upstream fetch failed:', err && err.message);
    return res.status(502).end();
  }
  if (upstream.status !== 200 && upstream.status !== 206) return res.status(502).end();

  res.status(upstream.status); // 200 or 206 (range)
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, no-store');

  if (!upstream.body) return res.end();
  const node = Readable.fromWeb(upstream.body);
  node.on('error', () => { try { res.destroy(); } catch (_) { /* ignore */ } });
  res.on('close', () => { try { node.destroy(); } catch (_) { /* ignore */ } });
  node.pipe(res);
});

router.get('/brokerage', (req, res) => {
  res.json({
    connected: false,
    portfolioValue: 0,
    cash: 0,
    holdingsValue: 0,
    positions: [],
    strategies: [],
    lastError: null,
  });
});

// ── POST /api/steward-ai/comment ──────────────────────────────────────────────
//
// Generates the Steward AI dialog for the latest snapshot. Three-layer model:
//
//   Layer 1 — Deterministic events (take precedence):
//     - 'closing_certificate'   an account just hit $0
//     - 'quarterly_letter'      90+ days since the last one
//
//   Layer 2 — Rotating dialog (server gates eligibility, AI picks the mode):
//     'adversary' / 'todays_deal' / 'climb_forecast' / 'if_you_do_nothing' /
//     'anti_flattery' / 'observation'
//
//   Layer 3 — Always-on side effects: ledger append, nickname assignment.
//
// Responses:
//   204  no API key, no data, generation failure → client closes dialog
//        silently as if nothing happened.
//   200  { ok, mode, title?, text, cached? } — client renders per-mode framing.
//
// Cached per-snapshot in config (key prefix below) so reloads cost 0 tokens.

const STEWARD_AI_CACHE_PREFIX = 'steward_ai_dialog_at:';

function readCachedDialog(pulledAt) {
  const raw = getConfig(STEWARD_AI_CACHE_PREFIX + pulledAt);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeCachedDialog(pulledAt, payload) {
  setConfig(STEWARD_AI_CACHE_PREFIX + pulledAt, JSON.stringify(payload));
}

router.post('/steward-ai/comment', (req, res) => {
  (async () => {
    try {
      if (!stewardAi.isConfigured()) return res.status(204).end();

      const ctx = stewardAiContext.buildContext();
      if (ctx.skip) return res.status(204).end();

      const pulledAt = ctx.snapshot.pulledAt;
      const cached = readCachedDialog(pulledAt);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }

      let result;
      let modeForLedger = 'observation';

      if (ctx.event && ctx.event.kind === 'closing_certificate') {
        result = await stewardAi.generateClosingCertificate({
          closing: ctx.event.data,
          payload: ctx.payload,
        });
        modeForLedger = 'closing_certificate';
      } else if (ctx.event && ctx.event.kind === 'quarterly_letter') {
        result = await stewardAi.generateQuarterlyLetter({ payload: ctx.payload });
        modeForLedger = 'quarterly_letter';
      } else {
        result = await stewardAi.generateModeDialog({
          eligibleModes: ctx.eligibleModes,
          payload: ctx.payload,
        });
        modeForLedger = (result && result.mode) || 'observation';
      }

      if (!result || !result.ok || !result.dialog_text) {
        return res.status(204).end();
      }

      // Side effects: ledger append, mode-fired-at markers
      stewardAiLedger.appendLedger({
        pulled_at: pulledAt,
        line: result.ledger_line || result.dialog_text,
        mode: modeForLedger,
      });
      if (modeForLedger === 'if_you_do_nothing') {
        stewardAiContext.markIfDoNothingFired(pulledAt);
      } else if (modeForLedger === 'quarterly_letter') {
        stewardAiContext.markQuarterlyLetterFired(pulledAt);
      }

      const responsePayload = {
        ok: true,
        mode: result.mode || modeForLedger,
        title: result.title || null,
        text: result.dialog_text,
      };
      writeCachedDialog(pulledAt, responsePayload);
      return res.json({ ...responsePayload, cached: false });
    } catch (err) {
      console.error('[api] steward-ai/comment', err);
      return res.status(204).end();
    }
  })();
});

// ── POST /api/steward-ai/ask ──────────────────────────────────────────────────
// Interactive Q&A: the client sends a question (from suggested chips or free
// text); the Steward answers grounded in the same context payload the dialog
// modes use. 204 when no API key (client hides the Ask panel). Not cached —
// answers are quick and the user chose to spend the token.

router.post('/steward-ai/ask', express.json(), (req, res) => {
  (async () => {
    try {
      if (!stewardAi.isConfigured()) return res.status(204).end();
      const { question } = req.body || {};
      if (!question || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ ok: false, error: 'A question is required.' });
      }
      const q = question.trim().slice(0, 300);
      const ctx = stewardAiContext.buildContext();
      if (ctx.skip) {
        return res.json({
          ok: true,
          text: 'Add your debts and start the climb first — then I will have real numbers to answer with.',
        });
      }
      const result = await stewardAi.generateAnswer({ question: q, payload: ctx.payload });
      if (!result || !result.ok || !result.text) {
        return res.status(200).json({ ok: false, error: 'The Steward could not answer just now. Try again in a moment.' });
      }
      return res.json({ ok: true, text: result.text });
    } catch (err) {
      console.error('[api] steward-ai/ask', err);
      return res.status(500).json({ ok: false, error: 'Ask failed.' });
    }
  })();
});

// ── POST /api/steward-ai/tier-quote ───────────────────────────────────────────
// Ambient stage-card maxim, AI-generated in the Steward's voice. Cached per
// (snapshot, tier) so reloads cost zero tokens and the line only refreshes when
// the snapshot or stage changes. 204 when there is no API key or no active climb
// — the client then keeps the static fallback quote, so the card is never empty.

const STEWARD_AI_QUOTE_CACHE_PREFIX = 'steward_ai_quote_at:';

router.post('/steward-ai/tier-quote', (req, res) => {
  (async () => {
    try {
      if (!stewardAi.isConfigured()) return res.status(204).end();

      const ctx = stewardAiContext.buildContext();
      if (ctx.skip || !ctx.payload || !ctx.payload.tier) return res.status(204).end();

      const tierId = ctx.payload.tier.id || '';
      const cacheKey = STEWARD_AI_QUOTE_CACHE_PREFIX + ctx.snapshot.pulledAt + ':' + tierId;
      const cached = getConfig(cacheKey);
      if (cached) return res.json({ ok: true, text: cached, cached: true });

      const result = await stewardAi.generateTierQuote({ payload: ctx.payload });
      if (!result || !result.ok || !result.text) return res.status(204).end();

      setConfig(cacheKey, result.text);
      return res.json({ ok: true, text: result.text, cached: false });
    } catch (err) {
      console.error('[api] steward-ai/tier-quote', err);
      return res.status(204).end();
    }
  })();
});

// ── GET /api/steward-ai/ledger ────────────────────────────────────────────────
// Returns the persisted journal entries so a future "Ledger" page can render
// the chronicle. No model call.

router.get('/steward-ai/ledger', (req, res) => {
  try {
    const entries = stewardAiLedger.readLedger();
    res.json({ ok: true, entries });
  } catch (err) {
    console.error('[api] steward-ai/ledger', err);
    res.status(500).json({ ok: false, error: 'ledger_read_failed' });
  }
});

// ── GET /api/export ───────────────────────────────────────────────────────────
//
// Download everything the authenticated user owns as a dated JSON file —
// their personal backup, independent of the server's own backup story.

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  // Leading BOM so Excel detects UTF-8 (account names can carry accents/emoji).
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function excelDate(iso) {
  // "2026-06-12T17:30:00.000Z" → "2026-06-12 17:30:00" — Excel parses this
  // as a real datetime; raw ISO with T/Z often lands as text.
  return String(iso || '').replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '');
}

router.get('/export', (req, res) => {
  const data = exportUserData();
  const stamp = new Date().toISOString().slice(0, 10);

  // Shared lookups so names + APRs appear everywhere (raw IDs like "manual-acct-0"
  // are meaningless on their own).
  const nameById = parseJsonObject(data.settings.debt_account_name_map);
  const aprById = parseJsonObject(data.settings.interest_rates);
  const nameOf = (id) => nameById[id] || 'Account';
  const aprOf = (id) => {
    const n = Number(aprById[id]);
    return Number.isFinite(n) && n > 0 ? n : '';
  };
  const baseline = Number(data.settings.climb_baseline_debt) || Number(data.settings.game_start_debt) || 0;

  // Column order for per-account views: current accounts first (export order),
  // then any history-only ids that no longer have a live balance.
  const accountIds = [];
  for (const b of data.debtAccountBalances) if (!accountIds.includes(b.accountId)) accountIds.push(b.accountId);
  for (const h of data.debtAccountHistory) if (!accountIds.includes(h.accountId)) accountIds.push(h.accountId);

  if (req.query.format === 'csv') {
    if (req.query.table === 'accounts') {
      // Long-format per-account balance history, now with the APR on each row.
      const csv = toCsv(
        ['account_id', 'account_name', 'apr_pct', 'recorded_at', 'balance'],
        data.debtAccountHistory.map((r) => [r.accountId, nameOf(r.accountId), aprOf(r.accountId), excelDate(r.recordedAt), r.balance]),
      );
      res.setHeader('Content-Disposition', `attachment; filename="steward-accounts-${stamp}.csv"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    if (req.query.table === 'matrix') {
      // Wide pivot: one row per pull, one column per card — every balance side by
      // side over time. This is the view that makes a single card's jump obvious.
      const byTs = new Map();
      for (const h of data.debtAccountHistory) {
        if (!byTs.has(h.recordedAt)) byTs.set(h.recordedAt, {});
        byTs.get(h.recordedAt)[h.accountId] = h.balance;
      }
      const stamps = [...byTs.keys()].sort();
      const headers = ['recorded_at', ...accountIds.map(nameOf), 'total'];
      const rows = stamps.map((ts) => {
        const row = byTs.get(ts);
        const cells = accountIds.map((id) => (row[id] == null ? '' : row[id]));
        const total = accountIds.reduce((s, id) => s + (Number(row[id]) || 0), 0);
        return [excelDate(ts), ...cells, Math.round(total * 100) / 100];
      });
      const csv = toCsv(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="steward-accounts-matrix-${stamp}.csv"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    // Default CSV: the snapshot time series + derived progress columns so the
    // sheet shows movement, not just levels. (snapshots are oldest→newest.)
    let prevDebt = null;
    const rows = data.snapshots.map((s) => {
      const dr = Number(s.debt_remaining);
      const change = prevDebt == null ? '' : Math.round((dr - prevDebt) * 100) / 100;
      prevDebt = dr;
      const paidSinceStart = baseline > 0 ? Math.round((baseline - dr) * 100) / 100 : '';
      return [
        excelDate(s.pulled_at), s.total_debt, s.debt_remaining, change, paidSinceStart,
        s.total_assets, s.investment_value, s.monthly_income, s.monthly_expenses, s.net_worth, s.tier,
      ];
    });
    const csv = toCsv(
      ['pulled_at', 'total_debt', 'debt_remaining', 'debt_change_from_prev', 'paid_since_start',
        'total_assets', 'investment_value', 'monthly_income', 'monthly_expenses', 'net_worth', 'tier'],
      rows,
    );
    res.setHeader('Content-Disposition', `attachment; filename="steward-snapshots-${stamp}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  }

  // ── JSON: keep the raw arrays (restore reads these) and ADD readable layers ──
  const climb = getClimbStatsFromConfig();
  const firstBalances = getDebtAccountFirstBalances();
  const latestDebt = data.snapshots.length ? Number(data.snapshots[data.snapshots.length - 1].debt_remaining) : null;

  const accounts = data.debtAccountBalances.map((b) => {
    const first = Number(firstBalances.get(String(b.accountId)));
    const apr = Number(aprById[b.accountId]);
    const pctPaid = Number.isFinite(first) && first > 0
      ? Math.round(((first - b.balance) / first) * 1000) / 10
      : null;
    return {
      id: b.accountId,
      name: nameOf(b.accountId),
      balance: b.balance,
      apr: Number.isFinite(apr) && apr > 0 ? apr : null,
      startingBalance: Number.isFinite(first) ? first : null,
      pctPaid,
    };
  });

  const exportGameStartAt = getConfig('game_start_at');
  // Correction-aware history (same series the chart and dashboard forecast use),
  // so the exported pace/forecast match the UI and aren't skewed by setup-time
  // account additions. Falls back to raw snapshots for legacy aggregate-only users.
  const exportPaceSnapshots = recentCorrectedSnapshots({
    gameStartAt: exportGameStartAt,
    fallback: recentSnapshots(60),
  });
  const pace = monthlyPaceFromSnapshots(exportPaceSnapshots);
  // DA-06 — the dashboard's "Avg / month" is the lifetime average (Total Cleared ÷
  // months since game start), not the snapshot pace. Export the SAME figure so the
  // API matches the UI instead of returning null when the snapshot pace is unset.
  const lifetimeAvgPaydown = averageMonthlyPaydown(climb.cumulativePaidDown, exportGameStartAt);
  const proj = latestDebt != null ? projectDebtFree(exportPaceSnapshots, latestDebt, { monthlyPace: pace }) : null;
  // Bug #4 — the dashboard's debt-free date comes from the Monte Carlo forecast,
  // not the linear projection, so export THAT (with its confidence band) instead
  // of leaving projectedDebtFree null. Anyone exporting their data then has the
  // same projection the UI shows.
  const exportForecast = latestDebt != null
    ? monteCarloPayoff(latestDebt, monthlyPaydownSamples(exportPaceSnapshots), {
        annualAprPct: effectiveAnnualAprPct(accounts),
      })
    : null;
  const plan = buildPayoffPlan(accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance, apr: a.apr })));
  const payTarget = plan
    ? (plan.recommended === 'avalanche' && plan.avalanche ? plan.avalanche.target : plan.snowball.target)
    : null;

  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'steward-manual',
    user: req.user ? { username: req.user.username, email: req.user.email || null } : null,
    // Human-readable summary layer (derived; the raw arrays below are the source of truth).
    climb: {
      baselineDebt: baseline || null,
      debtRemaining: latestDebt,
      totalPaidDown: climb.cumulativePaidDown,
      totalNewDebtAdded: climb.cumulativeNewDebtAdded,
      interestAccrued: climb.cumulativeInterestAccrued,
      pctPaid: climb.pctPaid,
      netImprovement: climb.netImprovement,
      avgMonthlyPaydown: (lifetimeAvgPaydown != null ? lifetimeAvgPaydown : (pace || null)),
      projectedDebtFree: exportForecast && exportForecast.ready ? exportForecast.medianDate : null,
      projectedDebtFreeRange: exportForecast && exportForecast.ready
        ? { low: exportForecast.optimisticDate || null, high: exportForecast.conservativeDate || null }
        : null,
      projectedDebtFreeConfidence: exportForecast && exportForecast.ready
        ? { within1yr: exportForecast.prob1yr, within2yr: exportForecast.prob2yr, within3yr: exportForecast.prob3yr }
        : null,
      payThisNext: payTarget ? { name: payTarget.name, balance: payTarget.balance, apr: payTarget.apr || null, strategy: plan.recommended } : null,
    },
    accounts,
    // Raw, restore-critical data. debtAccountBalances now also carries the name.
    snapshots: data.snapshots,
    debtAccountBalances: data.debtAccountBalances.map((b) => ({ ...b, name: nameOf(b.accountId) })),
    debtAccountHistory: data.debtAccountHistory,
    settings: data.settings,
  };
  res.setHeader('Content-Disposition', `attachment; filename="steward-export-${stamp}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
});

// ── POST /api/restore ─────────────────────────────────────────────────────────
// Rebuild the logged-in user's own data from an export() payload. Always scoped
// to the current session user — the export's user_id is ignored, so this can
// never write into another account. Destructive (full replace); the client
// confirms first. Body can be large (full history), so the JSON limit is raised.
router.post('/restore', express.json({ limit: '8mb' }), (req, res) => {
  const { isValidImportPayload } = require('../db');
  const check = isValidImportPayload(req.body);
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error });
  const force = req.body.force === true || req.query.force === '1' || req.query.force === 'true';
  try {
    const restored = importUserData(req.body, { force });
    const skipped = restored.skipped || {};
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + (Number(b) || 0), 0);
    return res.json({
      ok: true,
      restored,
      // Surface partial restores so a truncated/old file can't look fully successful.
      warning: skippedTotal > 0 ? `Restored, but skipped ${skippedTotal} unusable row(s).` : undefined,
    });
  } catch (err) {
    if (err && err.code === 'EMPTY_RESTORE_GUARD') {
      // Refused on purpose — committing would have wiped existing data. Not a 500.
      return res.status(409).json({ ok: false, error: err.message, needsForce: true });
    }
    console.error('[api] restore', err);
    return res.status(500).json({ ok: false, error: 'Restore failed.' });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

module.exports = router;
