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
  currentUserId,
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
  safetySnapshot,
  getDebtAccountVerifiedAt,
  savePushSubscription,
  deletePushSubscription,
  getAppMeta,
  setAppMeta,
  upsertBugReport,
  setBugReportTriage,
  listBugReports,
  countNewBugReports,
  markAllBugReportsSeen,
  bugReportsInLastDay,
} = require('../db');
const { monthlyPaceFromSnapshots, projectDebtFree, paidThisMonth, averageMonthlyPaydown, suggestedMonthlyTarget } = require('../services/pace');
const { monthlyPaydownSamples, monteCarloPayoff, effectiveAnnualAprPct } = require('../services/forecast');
const { buildPayoffPlan, interestSavedSinceStart } = require('../services/payoffPlan');
const {
  comparePayoffStrategies, simulateStrategy, normalizeAccounts, buildCplexLp,
} = require('../services/payoffOptimizer');
const {
  CUTSCENE_USERNAME,
  isCutsceneUser,
  selectCutsceneVideo,
  cutsceneVideos,
  accumulateCutsceneProgress,
  nextCutsceneIndex,
} = require('../services/cutscene');
const { cachedPathIfReady, ensureCached } = require('../services/cutsceneCache');
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
const { findUserById, findUserByUsername, listAllUsers } = require('../db-auth');

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
  const out = saveSnapshotForUser(req.body, req.user && req.user.username);
  if (out.status === 200) scheduleMetricsAudit(req.user && req.user.userId);
  return res.status(out.status).json(out.body);
});

// 400 helper for saveSnapshotForUser — keeps the validation returns terse.
function bad(error) {
  return { status: 400, body: { ok: false, error } };
}

/**
 * The full snapshot write path — validation, financial-field preservation,
 * origin/classification bookkeeping, the atomic transaction, undo capture,
 * climb metrics, celebrations. Extracted from the route so the Steward AI's
 * tools and the manual-entry form share ONE code path; both callers get
 * identical validation and identical undo behavior. Returns { status, body }.
 * Must run inside withUser().
 */
function saveSnapshotForUser(rawBody, username) {
  try {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    if (Object.keys(body).length === 0) {
      return bad('Snapshot body is empty. Include totalAssets, totalDebt, or debtAccounts.');
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
      return bad(`${negativeField[0]} cannot be negative`);
    }
    const oversizedField = Object.entries(moneyFields).find(([, value]) => exceedsMoneyCap(value));
    if (oversizedField) {
      return bad(`${oversizedField[0]} is unrealistically large (max ${MAX_MONEY}).`);
    }
    // Reject non-finite money fields. Silent coercion (Number("$3,000") → NaN → 0)
    // previously zeroed totals and credited phantom paydown.
    for (const [name, value] of Object.entries(moneyFields)) {
      if (value !== undefined && value !== null && value !== '' && !Number.isFinite(Number(value))) {
        return bad(`${name} must be a number (got ${JSON.stringify(value)})`);
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
        return bad(`Too many debt accounts (max ${MAX_DEBT_ACCOUNTS}).`);
      }
      let sumFromAccounts = 0;
      for (const acct of debtAccounts) {
        if (!acct || typeof acct !== 'object') {
          return bad('debtAccounts entries must be objects');
        }
        // Cap the id length too — it's a map key and a stored column; only `name`
        // was previously bounded.
        const id  = String(acct.id || `acct-${debtDisplayRows.length}`).slice(0, 100);
        if (debtBalanceMap.has(id)) {
          return bad(`Duplicate debt account id: ${id}`);
        }
        if (isNegativeFinite(acct.balance)) {
          return bad(`Debt account ${id} balance cannot be negative`);
        }
        if (exceedsMoneyCap(acct.balance)) {
          return bad(`Debt account ${id} balance is unrealistically large (max ${MAX_MONEY}).`);
        }
        // Reject missing or non-finite balances. Silent coercion to 0 was the
        // root of two bugs: a typo like "$3,000.00" rolled the user to
        // "wealthy", and an omitted field silently recorded the account as
        // paid off. Both are now explicit 400s.
        if (acct.balance === undefined || acct.balance === null || acct.balance === '') {
          return bad(`Debt account ${id} is missing a balance. Send 0 explicitly to mark it paid off.`);
        }
        if (!Number.isFinite(Number(acct.balance))) {
          return bad(`Debt account ${id} balance must be a number (got ${JSON.stringify(acct.balance)})`);
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
      // Seed a missing pin from the account's EARLIEST recorded history, not
      // this pull's balance — an account tracked before pinning existed has
      // already been paid down, and pinning today's balance would erase that
      // progress from the "% paid" badge (it read 0% for accounts that had
      // only pre-pin paydown). Genuinely new accounts have no history yet at
      // this point (appendDebtAccountHistory runs later in this handler), so
      // they still seed from the incoming balance.
      const earliestKnown = getDebtAccountFirstBalances();
      for (const [id, bal] of debtBalanceMap.entries()) {
        if (firstBalMap[id] == null) {
          const hist = Number(earliestKnown.get(String(id)));
          const seed = Number.isFinite(hist) ? hist : Number(bal);
          if (Number.isFinite(seed)) {
            firstBalMap[id] = seed;
            firstBalChanged = true;
          }
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

    // Cutscene trigger (cutscene user only): cumulative paydown accumulates
    // across saves and fires when it crosses a threshold scaled to the debt
    // still owed ($500 early, tapering to $100 near the end) — so splitting a
    // payment over several Quick Updates earns exactly the same reward, and
    // the videos never go silent at the finish line. The remainder past the
    // threshold carries toward the next fire. Clips rotate (never the same
    // one twice in a row); the chosen index is pinned at arm time so every
    // range request of one playback resolves to the same file.
    if (gameActive && Number.isFinite(prevTotalDebtForCutscene) && isCutsceneUser(username)) {
      const drop = roundMoney(prevTotalDebtForCutscene - debtRemaining);
      const bucketBefore = Number(getConfig('cutscene_paydown_bucket'));
      const result = accumulateCutsceneProgress(bucketBefore, drop, debtRemaining);
      if (result.fire) {
        setConfig('pending_cutscene', '1');
        const last = parseInt(getConfig('cutscene_last_index') ?? '', 10);
        const next = nextCutsceneIndex(last, cutsceneVideos().length);
        if (next != null) setConfig('cutscene_next_index', String(next));
      }
      setConfig('cutscene_paydown_bucket', String(result.bucket));
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
    // Deterministic ledger sanity rules (zero AI cost) — any violation files an
    // admin bug report. Runs for EVERY write path (manual form + AI tools flow
    // through here). Must never affect the save's outcome.
    try {
      reportInvariantViolations(currentUserId());
    } catch (err) {
      console.error('[bug-report] invariant check failed:', err && err.message);
    }
    return { status: 200, body: response };
  } catch (err) {
    console.error('[api] manual snapshot error:', err);
    return { status: 500, body: { ok: false, error: 'Could not save snapshot.' } };
  }
}

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
    // Pre-destruction snapshot: a wrong-account or panic reset stays
    // recoverable from <db-dir>/backups/ (see RECOVERY.md). Never blocks.
    safetySnapshot('reset');
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
    // Promo terms — powers the Strategy Lab's promo-cliff planning. promoEndsOn
    // is the date the teaser rate dies; postPromoApr is the rate that takes
    // over; deferredInterest marks "no interest IF paid in full by the date"
    // financing, where missing the date retroactively bills the waived pool.
    if (typeof t.promoEndsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.promoEndsOn)) {
      const d = new Date(`${t.promoEndsOn}T00:00:00Z`);
      if (Number.isFinite(d.getTime())) out.promoEndsOn = t.promoEndsOn;
    }
    const postApr = Number(t.postPromoApr);
    if (Number.isFinite(postApr) && postApr >= 0 && postApr <= 100) {
      out.postPromoApr = Math.round(postApr * 100) / 100;
    }
    if (t.deferredInterest === true) out.deferredInterest = true;
    if (Object.keys(out).length > 0) clean[String(id).slice(0, 100)] = out;
  }
  setConfig(DEBT_TERMS_KEY, JSON.stringify(clean));
  res.json({ ok: true, terms: clean });
});

// ── GET /api/payoff-plan/compare ──────────────────────────────────────────────
// Strategy Lab: play avalanche / snowball / promo-aware / LP-optimal forward at
// a monthly budget and compare months-to-free + total interest. All computed
// locally — no balance ever leaves the server. `format=lp` returns the live
// optimization model in IBM CPLEX LP file format instead (the exact model the
// in-app solver runs, portable to a real CPLEX installation).
router.get('/payoff-plan/compare', (req, res) => {
  const budget = Number(req.query.budget);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1e7) {
    return res.status(400).json({ ok: false, error: 'budget (positive number) required' });
  }
  const rates = parseJsonObject(getConfig('interest_rates'));
  const names = parseJsonObject(getConfig('debt_account_name_map'));
  const terms = parseJsonObject(getConfig(DEBT_TERMS_KEY));
  const accounts = [...getAllDebtAccountBalances().entries()].map(([id, balance]) => ({
    id, name: names[id] || 'Account', balance, apr: rates[id],
  }));
  if (String(req.query.format || '').toLowerCase() === 'lp') {
    const normalized = normalizeAccounts(accounts, terms, new Date());
    if (!normalized.length) return res.status(400).json({ ok: false, error: 'No open balances to model.' });
    const probe = simulateStrategy('promo-aware', normalized, budget);
    const horizon = Math.min(120, (probe.debtFree ? probe.months : 36) + 2);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="steward-payoff-model.lp"');
    return res.send(buildCplexLp(normalized, budget, horizon));
  }
  const comparison = comparePayoffStrategies(accounts, terms, budget, new Date());
  if (!comparison) return res.status(400).json({ ok: false, error: 'No open balances to plan.' });
  res.json({ ok: true, ...comparison });
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
  // Rotate: the clip just watched becomes "last", so the next fire picks the
  // other one. Deliberately do NOT clear cutscene_next_index — the client
  // posts cutscene-seen the moment the player OPENS (consuming the trigger
  // whatever happens), while the <video> keeps issuing range requests for the
  // rest of playback. Un-pinning here made pause→resume fall back to seed
  // selection, which can resolve to the OTHER clip — the browser then asks
  // for byte ranges of a different file and playback never recovers. The
  // stale pin is harmless: the next fire overwrites it from last_index.
  const shown = getConfig('cutscene_next_index');
  if (shown != null && shown !== '') {
    setConfig('cutscene_last_index', String(shown));
  }
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
// logged-out requests; any other authenticated account gets a 404. Serving is
// CACHE-FIRST: the clip is downloaded to local disk once, then res.sendFile
// streams it with native byte-range support — one fast hop, reliable seeking.
// Until the cache is warm we PROXY the remote clip (forwarding Range), same as
// before, and kick the download in the background. Proxying — rather than a
// 302 redirect — keeps the <video> same-origin; a cross-origin media redirect
// failed to load in the browser. Proxied bytes stream through, never buffered
// whole.
router.get('/cutscene/video', async (req, res) => {
  if (!req.user || !isCutsceneUser(req.user.username)) return res.status(404).end();
  // Prefer the rotation index pinned when the cutscene was ARMED — it's stable
  // across every range request of a playback and guarantees no clip repeats
  // back-to-back. Legacy fallback: the client's per-play seed (also stable).
  const pool = cutsceneVideos();
  const pinned = parseInt(getConfig('cutscene_next_index') ?? '', 10);
  const url = Number.isInteger(pinned) && pinned >= 0 && pinned < pool.length
    ? pool[pinned]
    : selectCutsceneVideo(req.query && req.query.v);
  if (!url) return res.status(404).end();

  const cached = cachedPathIfReady(url);
  if (cached) {
    return res.sendFile(cached, {
      cacheControl: false,
      headers: { 'Cache-Control': 'private, no-store' },
    }, (err) => {
      // Aborted downloads/seeks surface here as benign stream errors; only log
      // real failures (headers not sent = nothing reached the client yet).
      if (err && !res.headersSent) {
        console.error('[cutscene] sendFile failed:', err.message);
        res.status(500).end();
      }
    });
  }
  // Cache is cold (first play since deploy) — warm it for the NEXT request
  // (later range requests of this same playback already benefit) and proxy
  // this one meanwhile.
  void ensureCached(url);

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

// ── Steward AI tools ──────────────────────────────────────────────────────────
// The bounded action set the chat model can call. Every write funnels through
// the app's existing validated paths (saveSnapshotForUser for balances — same
// undo capture as the manual form; merge-writes for terms/APRs), so the model
// can never bypass validation or create an un-undoable state. Deliberately
// EXCLUDED: reset game, start game, delete accounts, import/export — those are
// player-only controls in the UI.

const stewardAiMemory = require('../services/stewardAiMemory');

/** Current accounts as [{id, name, balance}] using the persisted name map. */
function listCurrentAccounts() {
  const balances = getAllDebtAccountBalances();
  const nameMap = parseJsonObject(getConfig('debt_account_name_map'));
  const rows = [];
  for (const [id, balance] of balances.entries()) {
    rows.push({ id, name: String(nameMap[id] || id), balance: Number(balance) || 0 });
  }
  return rows;
}

/**
 * Resolve a model-supplied account reference (id, name, or nickname — any
 * case) to exactly one account. Returns { ok, account } or { ok:false, error }
 * with the available names so the model can self-correct in the next round.
 */
function resolveAccountRef(ref) {
  const wanted = String(ref || '').trim().toLowerCase();
  const accounts = listCurrentAccounts();
  if (!wanted) return { ok: false, error: 'No account given.', accounts };
  if (accounts.length === 0) {
    return { ok: false, error: 'There are no debt accounts yet. Add one first with add_debt_account.' };
  }
  const nicknames = parseJsonObject(getConfig('steward_ai_nicknames'));
  const matches = accounts.filter((a) => {
    if (a.id.toLowerCase() === wanted) return true;
    if (a.name.toLowerCase() === wanted) return true;
    const nick = nicknames[a.id];
    return typeof nick === 'string' && nick.toLowerCase() === wanted;
  });
  // Fall back to substring matching only when exact matching found nothing.
  const found = matches.length > 0 ? matches : accounts.filter(
    (a) => a.name.toLowerCase().includes(wanted) || a.id.toLowerCase().includes(wanted),
  );
  const names = accounts.map((a) => a.name).join(', ');
  if (found.length === 1) return { ok: true, account: found[0] };
  if (found.length === 0) {
    return { ok: false, error: `No account matches "${ref}". The accounts are: ${names}.` };
  }
  return {
    ok: false,
    error: `"${ref}" matches more than one account (${found.map((a) => a.name).join(', ')}). Ask the player which one they mean.`,
  };
}

function fmtUsd(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

/** Slug id for a new account, unique against the existing ids. */
function newAccountId(name, existing) {
  const base = String(name || 'account').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'account';
  const taken = new Set(existing.map((a) => a.id));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/** Merge one account's terms into debt_terms (same ranges the route enforces). */
function mergeDebtTerms(accountId, { minPayment, dueDay }) {
  const terms = parseJsonObject(getConfig(DEBT_TERMS_KEY));
  const entry = terms[accountId] && typeof terms[accountId] === 'object' ? terms[accountId] : {};
  const applied = [];
  if (minPayment !== undefined) {
    const min = Number(minPayment);
    if (!Number.isFinite(min) || min <= 0 || min > 1e7) {
      return { ok: false, error: 'minPayment must be a positive dollar amount.' };
    }
    entry.minPayment = Math.round(min * 100) / 100;
    applied.push(`minimum payment ${fmtUsd(entry.minPayment)}/mo`);
  }
  if (dueDay !== undefined) {
    const day = Number(dueDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return { ok: false, error: 'dueDay must be a day of the month, 1-31.' };
    }
    entry.dueDay = day;
    applied.push(`due on the ${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : day >= 21 && day % 10 === 1 ? 'st' : day >= 21 && day % 10 === 2 ? 'nd' : day >= 21 && day % 10 === 3 ? 'rd' : 'th'}`);
  }
  if (applied.length === 0) return { ok: false, error: 'Provide minPayment and/or dueDay.' };
  terms[accountId] = entry;
  setConfig(DEBT_TERMS_KEY, JSON.stringify(terms));
  return { ok: true, applied };
}

/** Merge one account's APR into interest_rates (0-100, like the route). */
function mergeInterestRate(accountId, aprPercent) {
  const n = Number(aprPercent);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, error: 'aprPercent must be between 0 and 100.' };
  }
  const rates = parseJsonObject(getConfig(INTEREST_RATES_KEY));
  rates[accountId] = Math.round(n * 100) / 100;
  setConfig(INTEREST_RATES_KEY, JSON.stringify(rates));
  return { ok: true, apr: rates[accountId] };
}

// A data write happened → cached AI dialog/quotes describe stale figures.
function dropAiCachesAfterWrite() {
  deleteConfigByPrefix('steward_ai_dialog_at:');
  deleteConfigByPrefix('steward_ai_quote_at:');
}

const CLASSIFICATION_REASONS = ['purchase', 'new_loan', 'interest', 'preexisting'];

const STEWARD_AI_TOOLS = [
  {
    name: 'update_debt_balances',
    description:
      'Record new balances for one or more EXISTING debt accounts (a payment, an interest hit, ' +
      'a purchase, or a corrected figure). Balances are the amount still owed. This creates a ' +
      'check-in entry exactly like the player updating balances themselves, and it is undoable. ' +
      'For a balance that INCREASED, set reason so the rise is classified honestly.',
    input_schema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          description: 'One entry per account whose balance changed.',
          items: {
            type: 'object',
            properties: {
              account: { type: 'string', description: 'Account name, nickname, or id as the player refers to it.' },
              newBalance: { type: 'number', description: 'The new amount still owed, in dollars. 0 means paid off.' },
              reason: {
                type: 'string',
                enum: CLASSIFICATION_REASONS,
                description: 'Only for increases: purchase (new spending), new_loan, interest (interest charged), or preexisting (debt that existed all along, just now reported).',
              },
            },
            required: ['account', 'newBalance'],
          },
        },
      },
      required: ['changes'],
    },
  },
  {
    name: 'add_debt_account',
    description:
      'Add a NEW debt account the player is not tracking yet, with its current balance. ' +
      'Optionally set its APR, minimum payment, and due day in the same call. Set preexisting=true ' +
      'when the player already had this debt and is only now telling you about it (so it does not ' +
      'count as new borrowing).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name, e.g. "Chase Sapphire" or "Car loan".' },
        balance: { type: 'number', description: 'Current amount owed, in dollars.' },
        aprPercent: { type: 'number', description: 'Annual interest rate as a percentage, e.g. 24.99.' },
        minPayment: { type: 'number', description: 'Minimum monthly payment in dollars.' },
        dueDay: { type: 'integer', description: 'Day of month the payment is due (1-31).' },
        preexisting: { type: 'boolean', description: 'True when this debt existed before — folds into the baseline instead of counting as new debt.' },
      },
      required: ['name', 'balance'],
    },
  },
  {
    name: 'set_debt_terms',
    description: "Set or update an existing account's minimum monthly payment and/or statement due day.",
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account name, nickname, or id.' },
        minPayment: { type: 'number', description: 'Minimum monthly payment in dollars.' },
        dueDay: { type: 'integer', description: 'Day of month the payment is due (1-31).' },
      },
      required: ['account'],
    },
  },
  {
    name: 'set_interest_rate',
    description: "Set or update an existing account's APR (annual interest rate).",
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account name, nickname, or id.' },
        aprPercent: { type: 'number', description: 'Annual rate as a percentage, 0-100.' },
      },
      required: ['account', 'aprPercent'],
    },
  },
  {
    name: 'undo_last_entry',
    description:
      'Reverse the most recent balance entry (yours or the player\'s) — use when the player says ' +
      'the last recorded update was wrong. Only the latest entry can be undone.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'manage_memory',
    description:
      'Keep, revise, or drop a durable fact about the player that should survive across ' +
      'conversations (pay schedule, goals, upcoming expenses, preferences, hardships). ' +
      'Existing memories arrive in the FIGURES as memories[{id, fact}]. Never store balances or ' +
      'figures the ledger already tracks.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'update', 'delete'] },
        id: { type: 'integer', description: 'Memory id (required for update/delete).' },
        fact: { type: 'string', description: 'One short sentence (required for save/update).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'report_bug_to_developer',
    description:
      'File a private note to the app developer when the player describes the APP itself ' +
      'misbehaving: a number that looks wrong on the dashboard, something that will not save, ' +
      'a stuck or broken screen, a feature not doing what it should. NOT for ledger corrections ' +
      '(use the balance/undo tools) and NOT for financial questions. The player never sees the ' +
      'note. Never include dollar amounts, balances, or account names in it.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One sentence: what the player says is broken or wrong. No figures.',
        },
        details: {
          type: 'string',
          description: 'Optional: where in the app, what they expected vs saw. No figures.',
        },
      },
      required: ['summary'],
    },
  },
];

/**
 * Execute one tool call from the chat model. Synchronous (SQLite), runs inside
 * the request's withUser scope. Returns a JSON-able object; { ok:false } is
 * fed back to the model as an error result it can react to. `summary` on
 * success is shown to the player as the receipt line.
 */
function executeStewardTool(name, input, username) {
  const arg = input && typeof input === 'object' ? input : {};

  if (name === 'update_debt_balances') {
    const changes = Array.isArray(arg.changes) ? arg.changes : [];
    if (changes.length === 0) return { ok: false, error: 'changes[] is empty.' };
    if (changes.length > 20) return { ok: false, error: 'Too many changes in one entry (max 20).' };
    const accounts = listCurrentAccounts();
    if (accounts.length === 0) {
      return { ok: false, error: 'No debt accounts exist yet — use add_debt_account first.' };
    }
    const byId = new Map(accounts.map((a) => [a.id, { ...a }]));
    const classifications = {};
    const lines = [];
    for (const ch of changes) {
      const resolved = resolveAccountRef(ch && ch.account);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const acct = byId.get(resolved.account.id);
      const newBal = Number(ch.newBalance);
      if (!Number.isFinite(newBal) || newBal < 0) {
        return { ok: false, error: `New balance for ${acct.name} must be a non-negative number.` };
      }
      const prev = acct.balance;
      acct.balance = Math.round(newBal);
      if (acct.balance > prev && ch.reason && CLASSIFICATION_REASONS.includes(ch.reason)) {
        classifications[acct.id] = ch.reason;
      }
      const delta = Math.round(prev - acct.balance);
      const move = delta > 0 ? `paid down ${fmtUsd(delta)}` : delta < 0 ? `up ${fmtUsd(-delta)}` : 'unchanged';
      lines.push(`${acct.name}: ${fmtUsd(prev)} → ${fmtUsd(acct.balance)} (${move}).`);
    }
    const debtAccounts = [...byId.values()].map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
    const totalDebt = debtAccounts.reduce((s, a) => s + a.balance, 0);
    const out = saveSnapshotForUser({ totalDebt, debtAccounts, classifications }, username);
    if (out.status !== 200) {
      return { ok: false, error: (out.body && out.body.error) || 'The entry was rejected.' };
    }
    dropAiCachesAfterWrite();
    return { ok: true, dataChanged: true, summary: lines.join(' '), tier: out.body.tier };
  }

  if (name === 'add_debt_account') {
    const nameClean = String(arg.name || '').trim().slice(0, 100);
    if (!nameClean) return { ok: false, error: 'The account needs a name.' };
    const balance = Number(arg.balance);
    if (!Number.isFinite(balance) || balance < 0) {
      return { ok: false, error: 'balance must be a non-negative dollar amount.' };
    }
    const accounts = listCurrentAccounts();
    const clash = accounts.find((a) => a.name.toLowerCase() === nameClean.toLowerCase());
    if (clash) {
      return { ok: false, error: `An account named "${clash.name}" already exists — use update_debt_balances for it.` };
    }
    const id = newAccountId(nameClean, accounts);
    const debtAccounts = accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
    debtAccounts.push({ id, name: nameClean, balance: Math.round(balance) });
    const classifications = arg.preexisting === true ? { [id]: 'preexisting' } : {};
    const totalDebt = debtAccounts.reduce((s, a) => s + a.balance, 0);
    const out = saveSnapshotForUser({ totalDebt, debtAccounts, classifications }, username);
    if (out.status !== 200) {
      return { ok: false, error: (out.body && out.body.error) || 'The entry was rejected.' };
    }
    const extras = [];
    if (arg.aprPercent !== undefined) {
      const r = mergeInterestRate(id, arg.aprPercent);
      if (r.ok) extras.push(`APR ${r.apr}%`);
    }
    if (arg.minPayment !== undefined || arg.dueDay !== undefined) {
      const t = mergeDebtTerms(id, { minPayment: arg.minPayment, dueDay: arg.dueDay });
      if (t.ok) extras.push(...t.applied);
    }
    dropAiCachesAfterWrite();
    return {
      ok: true,
      dataChanged: true,
      summary: `Added ${nameClean} at ${fmtUsd(balance)}${extras.length ? ` (${extras.join(', ')})` : ''}.`,
    };
  }

  if (name === 'set_debt_terms') {
    const resolved = resolveAccountRef(arg.account);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const t = mergeDebtTerms(resolved.account.id, { minPayment: arg.minPayment, dueDay: arg.dueDay });
    if (!t.ok) return t;
    return { ok: true, dataChanged: true, summary: `${resolved.account.name}: ${t.applied.join(', ')}.` };
  }

  if (name === 'set_interest_rate') {
    const resolved = resolveAccountRef(arg.account);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const r = mergeInterestRate(resolved.account.id, arg.aprPercent);
    if (!r.ok) return r;
    return { ok: true, dataChanged: true, summary: `${resolved.account.name}: APR set to ${r.apr}%.` };
  }

  if (name === 'undo_last_entry') {
    if (getGameStart().gameStartDebt == null) {
      return { ok: false, error: 'No active climb to undo.' };
    }
    if (!hasUndoState()) {
      return { ok: false, error: 'There is nothing to undo — no recent entry is on the undo stack.' };
    }
    const label = peekUndoLabel();
    const result = undoLastPull();
    if (!result || !result.undone) {
      return { ok: false, error: 'The undo could not be applied.' };
    }
    dropAiCachesAfterWrite();
    return { ok: true, dataChanged: true, summary: `Reversed the last ${label === 'correction' ? 'correction' : 'entry'}.` };
  }

  if (name === 'manage_memory') {
    const action = String(arg.action || '');
    if (action === 'save') {
      const r = stewardAiMemory.saveMemory(arg.fact, 'ai');
      if (!r.ok) return r;
      return { ok: true, summary: r.duplicate ? 'Already noted.' : `Noted: ${String(arg.fact).trim().slice(0, 120)}` };
    }
    if (action === 'update') {
      const r = stewardAiMemory.updateMemory(arg.id, arg.fact);
      if (!r.ok) return r;
      return { ok: true, summary: `Updated a note: ${String(arg.fact).trim().slice(0, 120)}` };
    }
    if (action === 'delete') {
      const r = stewardAiMemory.deleteMemory(arg.id);
      if (!r.ok) return r;
      return { ok: true, summary: 'Dropped a note.' };
    }
    return { ok: false, error: 'action must be save, update, or delete.' };
  }

  if (name === 'report_bug_to_developer') {
    const summary = String(arg.summary || '').trim().slice(0, 300);
    if (summary.length < 5) {
      return { ok: false, error: 'summary must be a sentence describing what looks broken.' };
    }
    const details = String(arg.details || '').trim().slice(0, 1000);
    // Same dedupe as captured errors: five players hitting the same broken
    // thing is one report seen five times, not five rows.
    const { id, isNew } = upsertBugReport({
      signature: bugSignature('user', summary, ''),
      kind: 'user',
      userId: currentUserId(),
      raw: JSON.stringify({ summary, details, via: 'steward-chat' }),
    });
    if (isNew) {
      // The chat model already wrote the plain-English note — no extra AI call.
      setBugReportTriage(id, {
        severity: 'medium',
        title: summary.slice(0, 120),
        report: details ? `Player-reported via chat. ${details}` : 'Player-reported via chat.',
      });
    }
    return { ok: true, summary: 'Passed a note about this to the developer.' };
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

// ── Steward Chat ──────────────────────────────────────────────────────────────
// A real conversation with the Steward: persistent thread + a standing
// "situation note" the AI always knows, grounded in the same context payload
// as the dialog modes (including payment terms + memories). Formerly gated to
// a single beta account; now available to every authenticated user — each
// user's Steward sees and touches only their own data (withUser scoping).

const CHAT_HISTORY_KEY = 'steward_chat_history';
const SITUATION_NOTE_KEY = 'steward_situation_note';
const CHAT_MAX_TURNS = 40;      // kept messages (user + assistant combined)
const CHAT_MAX_MSG_CHARS = 1500;

// Cost guard: each chat turn can spend up to ~7 model calls (tool rounds), and
// there is no other rate limiting in the app. A generous daily per-user cap
// keeps a runaway client or a very chatty day from becoming a surprise bill.
const CHAT_DAILY_LIMIT = 200;
const CHAT_USAGE_KEY = 'steward_ai_chat_usage';

/** Increment today's chat-turn counter; false when the daily cap is spent. */
function consumeChatBudget() {
  const today = new Date().toISOString().slice(0, 10);
  const usage = parseJsonObject(getConfig(CHAT_USAGE_KEY));
  const count = usage.date === today ? (Number(usage.count) || 0) : 0;
  if (count >= CHAT_DAILY_LIMIT) return false;
  setConfig(CHAT_USAGE_KEY, JSON.stringify({ date: today, count: count + 1 }));
  return true;
}

function readChatHistory() {
  const arr = parseJsonArray(getConfig(CHAT_HISTORY_KEY));
  return arr
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000), at: typeof m.at === 'string' ? m.at : null }));
}

function writeChatHistory(history) {
  setConfig(CHAT_HISTORY_KEY, JSON.stringify(history.slice(-CHAT_MAX_TURNS)));
}

router.get('/steward-ai/chat', (req, res) => {
  res.json({
    ok: true,
    beta: true,
    enabled: stewardAi.isConfigured(),
    messages: readChatHistory(),
    situationNote: String(getConfig(SITUATION_NOTE_KEY) || ''),
    memories: stewardAiMemory.readMemories(),
    archives: archiveSummaries(readChatArchives()),
  });
});

router.post('/steward-ai/chat', express.json(), (req, res) => {
  (async () => {
    try {
      const { message } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ ok: false, error: 'A message is required.' });
      }
      if (message.length > CHAT_MAX_MSG_CHARS) {
        return res.status(400).json({ ok: false, error: `Keep it under ${CHAT_MAX_MSG_CHARS} characters.` });
      }
      if (!stewardAi.isConfigured()) {
        return res.status(503).json({ ok: false, error: 'The Steward is asleep — no AI key is configured on the server.' });
      }
      if (!consumeChatBudget()) {
        return res.status(429).json({ ok: false, error: 'The Steward has talked enough for one day — try again tomorrow.' });
      }
      const ctx = stewardAiContext.buildContext();
      if (ctx.skip || !ctx.payload) {
        return res.json({
          ok: true,
          reply: 'Add your debts and start the climb first — then I will have real numbers to talk through with you.',
          ephemeral: true,
        });
      }
      const history = readChatHistory();
      history.push({ role: 'user', text: message.trim(), at: new Date().toISOString() });
      const username = req.user && req.user.username;
      const result = await stewardAi.generateChatReplyWithTools({
        history: history.slice(-CHAT_MAX_TURNS),
        payload: ctx.payload,
        tools: STEWARD_AI_TOOLS,
        executeTool: (name, input) => executeStewardTool(name, input, username),
      });
      if (!result || !result.ok || !result.text) {
        return res.status(200).json({ ok: false, error: 'The Steward could not answer just now. Try again in a moment.' });
      }
      history.push({ role: 'assistant', text: result.text, at: new Date().toISOString() });
      writeChatHistory(history);
      const actions = Array.isArray(result.actions) ? result.actions : [];
      return res.json({
        ok: true,
        reply: result.text,
        actions,
        // True when a ledger write happened this turn → the client refreshes
        // the dashboard so the numbers on screen match what was recorded.
        // Memory and bug notes don't touch the ledger.
        dataChanged: actions.some((a) => a.tool !== 'manage_memory' && a.tool !== 'report_bug_to_developer'),
      });
    } catch (err) {
      console.error('[api] steward-ai/chat', err);
      return res.status(500).json({ ok: false, error: 'Chat failed.' });
    }
  })();
});

router.post('/steward-ai/chat/clear', express.json(), (req, res) => {
  setConfig(CHAT_HISTORY_KEY, '[]');
  res.json({ ok: true });
});

// ── Saved conversations ───────────────────────────────────────────────────────
// The live thread is one bounded list (last 40 messages); without these, a
// long-running chat is a slow-motion data loss. "Save" snapshots the current
// thread into an archive and starts fresh; archives can be reopened (resume)
// or deleted. Bounded: newest CHAT_MAX_ARCHIVES kept, oldest dropped.

const CHAT_ARCHIVE_KEY = 'steward_chat_archives';
const CHAT_MAX_ARCHIVES = 20;

function readChatArchives() {
  return parseJsonArray(getConfig(CHAT_ARCHIVE_KEY))
    .filter((a) => a && typeof a.id === 'string' && Array.isArray(a.messages));
}

function writeChatArchives(archives) {
  setConfig(CHAT_ARCHIVE_KEY, JSON.stringify(archives.slice(-CHAT_MAX_ARCHIVES)));
}

/** List-view projection — titles and counts, not full transcripts. */
function archiveSummaries(archives) {
  return archives
    .map((a) => ({
      id: a.id,
      title: String(a.title || 'Conversation'),
      savedAt: typeof a.savedAt === 'string' ? a.savedAt : null,
      messageCount: a.messages.length,
    }))
    .reverse(); // newest first for the UI
}

function chatTitleFrom(messages) {
  const first = messages.find((m) => m.role === 'user');
  const text = first ? first.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return 'Conversation';
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

router.get('/steward-ai/chat/archives', (req, res) => {
  res.json({ ok: true, archives: archiveSummaries(readChatArchives()) });
});

// Save the live thread as an archive and start a fresh one.
router.post('/steward-ai/chat/archive', express.json(), (req, res) => {
  const history = readChatHistory();
  if (!history.length) {
    return res.status(200).json({ ok: false, error: 'Nothing to save yet — the conversation is empty.' });
  }
  const archives = readChatArchives();
  archives.push({
    id: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: chatTitleFrom(history),
    savedAt: new Date().toISOString(),
    messages: history,
  });
  transaction(() => {
    writeChatArchives(archives);
    setConfig(CHAT_HISTORY_KEY, '[]');
  });
  res.json({ ok: true, archives: archiveSummaries(readChatArchives()) });
});

// Reopen a saved conversation as the live thread. The current thread (if any)
// is auto-saved first, so resuming can never destroy messages.
router.post('/steward-ai/chat/archives/resume', express.json(), (req, res) => {
  const id = String((req.body || {}).id || '');
  const archives = readChatArchives();
  const idx = archives.findIndex((a) => a.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'That saved conversation no longer exists.' });
  const [target] = archives.splice(idx, 1);
  const current = readChatHistory();
  if (current.length) {
    archives.push({
      id: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: chatTitleFrom(current),
      savedAt: new Date().toISOString(),
      messages: current,
    });
  }
  transaction(() => {
    writeChatArchives(archives);
    writeChatHistory(target.messages);
  });
  res.json({ ok: true, messages: readChatHistory(), archives: archiveSummaries(readChatArchives()) });
});

router.post('/steward-ai/chat/archives/delete', express.json(), (req, res) => {
  const id = String((req.body || {}).id || '');
  const archives = readChatArchives();
  const next = archives.filter((a) => a.id !== id);
  if (next.length === archives.length) {
    return res.status(404).json({ ok: false, error: 'That saved conversation no longer exists.' });
  }
  writeChatArchives(next);
  res.json({ ok: true, archives: archiveSummaries(next) });
});

// The standing "my situation" note — injected into EVERY AI surface (chat,
// ask, dialog modes) via stewardAiContext, so the Steward always knows the
// backstory without the player re-explaining it.
router.post('/steward-ai/situation-note', express.json(), (req, res) => {
  const { note } = req.body || {};
  if (note != null && typeof note !== 'string') {
    return res.status(400).json({ ok: false, error: 'note must be a string' });
  }
  const clean = String(note || '').trim().slice(0, 2000);
  setConfig(SITUATION_NOTE_KEY, clean);
  res.json({ ok: true, situationNote: clean });
});

// ── Steward memory (player-visible) ──────────────────────────────────────────
// The chat panel lists what the Steward remembers; the player can delete any
// fact directly (the AI manages its own via the manage_memory tool).

router.get('/steward-ai/memory', (req, res) => {
  res.json({ ok: true, memories: stewardAiMemory.readMemories() });
});

router.post('/steward-ai/memory/delete', express.json(), (req, res) => {
  const id = Number(req.body && req.body.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, error: 'A memory id is required.' });
  }
  const result = stewardAiMemory.deleteMemory(id);
  if (!result.ok) return res.status(404).json(result);
  res.json({ ok: true, memories: stewardAiMemory.readMemories() });
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
    // Pre-destruction snapshot: restoring the wrong file over live data stays
    // recoverable from <db-dir>/backups/ (see RECOVERY.md). Never blocks.
    safetySnapshot('restore');
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

// ── Bug reports (capture from everyone, visible ONLY to the admin) ───────────
// Every signed-in client quietly posts runtime errors here (public/js/bug-watch.js).
// Reports land in the cross-user bug_reports table; the ONLY read surface is the
// admin routes below, gated on one username. Regular users get no UI, no
// notifications, no hint that capture exists — that's the point ("I don't want
// to freak them out").
//
// Cost design: the AI is trigger-based, not always-on. Watching costs zero
// tokens (plain JS). One AI triage per NEW error signature (repeats only bump a
// counter), at most one metrics audit per user per day, and a global hard cap
// of BUG_AI_DAILY_LIMIT AI calls/day across the whole app.

const crypto = require('node:crypto');
const { sendToUser } = require('../services/push');

const ADMIN_USERNAME = process.env.STEWARD_ADMIN_USERNAME || CUTSCENE_USERNAME;
const BUG_AI_DAILY_LIMIT = Math.max(0, parseInt(process.env.STEWARD_BUG_AI_DAILY_LIMIT ?? '20', 10) || 0);
const BUG_AI_USAGE_KEY = 'bug_ai_usage'; // app_meta (global, cross-user by design)
const BUG_STORM_DAILY_LIMIT = 500;       // stop recording entirely past this many occurrences/day
const METRICS_AUDIT_STAMP_KEY = 'steward_ai_metrics_audit'; // per-user config, {date}

function isAdminUser(req) {
  const username = req.user && req.user.username;
  return typeof username === 'string'
    && username.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

/** Global daily budget for ALL bug-related AI calls (triage + metrics audits). */
function consumeBugAiBudget() {
  const today = new Date().toISOString().slice(0, 10);
  const usage = parseJsonObject(getAppMeta(BUG_AI_USAGE_KEY));
  const count = usage.date === today ? (Number(usage.count) || 0) : 0;
  if (count >= BUG_AI_DAILY_LIMIT) return false;
  setAppMeta(BUG_AI_USAGE_KEY, JSON.stringify({ date: today, count: count + 1 }));
  return true;
}

/**
 * Stable fingerprint for "the same bug". Digits are collapsed so messages that
 * differ only in ids/amounts/line numbers ("balance 4200 invalid" vs "balance
 * 87 invalid") dedupe to one report; only the top stack frame participates for
 * the same reason.
 */
function bugSignature(source, message, stack) {
  const normalize = (s) => String(s || '').replace(/\d+/g, '#').toLowerCase().trim();
  const topFrame = String(stack || '').split('\n').find((l) => l.trim().startsWith('at ')) || '';
  return crypto.createHash('sha256')
    .update(`${source}|${normalize(message).slice(0, 300)}|${normalize(topFrame).slice(0, 200)}`)
    .digest('hex')
    .slice(0, 40);
}

/** Push the (already-triaged) report to the admin's devices. Best-effort. */
async function notifyAdminOfBug({ title, severity }) {
  try {
    const admin = findUserByUsername(ADMIN_USERNAME);
    if (!admin) return;
    await sendToUser(admin.id, {
      title: `Steward bug report (${severity})`,
      body: title,
      url: '/',
      tag: 'bug-report',
    });
  } catch (err) {
    console.error('[bug-report] admin push failed:', err && err.message);
  }
}

/** AI triage for a brand-new error signature — runs off the request path. */
async function triageNewBugReport(id, payload) {
  try {
    const res = await stewardAi.generateBugTriage({ payload });
    if (!res || !res.ok) return;
    setBugReportTriage(id, { severity: res.severity, title: res.title, report: res.report });
    if (res.severity === 'high') await notifyAdminOfBug({ title: res.title, severity: res.severity });
  } catch (err) {
    console.error('[bug-report] triage failed:', err && err.message);
  }
}

// Capture endpoint. ALWAYS answers 200 {ok:true}: it is called from the
// client's own error handler, and an error response here (or anything the
// caller could distinguish) risks recursion and probing. Bad payloads are
// silently dropped.
router.post('/bug-report', express.json({ limit: '32kb' }), (req, res) => {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const message = typeof b.message === 'string' ? b.message.trim().slice(0, 500) : '';
    if (!message) return res.json({ ok: true });
    if (bugReportsInLastDay() >= BUG_STORM_DAILY_LIMIT) return res.json({ ok: true });
    const stack = typeof b.stack === 'string' ? b.stack.slice(0, 4000) : '';
    const url = typeof b.url === 'string' ? b.url.slice(0, 300) : '';
    const source = ['error', 'unhandledrejection', 'http'].includes(b.source) ? b.source : 'error';
    const raw = JSON.stringify({
      source,
      message,
      stack,
      url,
      userAgent: String(req.get('user-agent') || '').slice(0, 200),
    });
    const { id, isNew } = upsertBugReport({
      signature: bugSignature(source, message, stack),
      kind: 'error',
      userId: req.user && req.user.userId,
      raw,
    });
    if (isNew) {
      // Readable in the panel even when the AI never runs (no key / cap spent).
      setBugReportTriage(id, { severity: null, title: message.slice(0, 120), report: null });
      if (stewardAi.isConfigured() && consumeBugAiBudget()) {
        setImmediate(() => { void triageNewBugReport(id, { source, message, stack, url }); });
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[api] bug-report', err);
    return res.json({ ok: true });
  }
});

/**
 * File the deterministic ledger-invariant violations (services/ledgerInvariants)
 * as admin bug reports. Same signature → same row: a persistent violation bumps
 * one counter on every save instead of flooding the panel. Severity/title/report
 * are set directly — no AI call, ever.
 */
function reportInvariantViolations(userId) {
  const { checkLedgerInvariants } = require('../services/ledgerInvariants');
  for (const v of checkLedgerInvariants()) {
    const { id, isNew } = upsertBugReport({
      signature: bugSignature('invariant', v.rule, ''),
      kind: 'invariant',
      userId,
      raw: JSON.stringify({ rule: v.rule }),
    });
    if (isNew) {
      setBugReportTriage(id, { severity: v.severity, title: v.title, report: v.report });
      if (v.severity === 'high') void notifyAdminOfBug({ title: v.title, severity: v.severity });
    }
  }
}

/**
 * Daily metrics sanity-check, fired after a successful snapshot save. At most
 * once per user per day (config stamp, set BEFORE the AI call so a failed run
 * cannot retry-spam), and only within the global AI budget. Findings of
 * medium/high severity become admin bug reports of kind 'metrics'.
 */
function scheduleMetricsAudit(userId) {
  if (!userId || !stewardAi.isConfigured() || BUG_AI_DAILY_LIMIT === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const stamp = parseJsonObject(getConfig(METRICS_AUDIT_STAMP_KEY));
  if (stamp.date === today) return;
  setConfig(METRICS_AUDIT_STAMP_KEY, JSON.stringify({ date: today }));
  if (!consumeBugAiBudget()) return;
  setImmediate(() => {
    // setImmediate loses the request's AsyncLocalStorage scope — re-enter it.
    withUser(userId, () => {
      (async () => {
        try {
          const ctx = stewardAiContext.buildContext();
          if (ctx.skip || !ctx.payload) return;
          const res = await stewardAi.generateMetricsAudit({ payload: ctx.payload });
          if (!res || !res.ok || !Array.isArray(res.findings)) return;
          const findings = res.findings.filter((f) => f.severity === 'high' || f.severity === 'medium');
          if (findings.length === 0) return;
          const notes = findings.map((f) => `[${f.severity}] ${f.note}`).join('\n');
          const severity = findings.some((f) => f.severity === 'high') ? 'high' : 'medium';
          const { id, isNew } = upsertBugReport({
            signature: bugSignature('metrics', notes, ''),
            kind: 'metrics',
            userId,
            raw: JSON.stringify({ findings }),
          });
          if (isNew) {
            setBugReportTriage(id, {
              severity,
              title: `Metrics audit: ${findings[0].note.slice(0, 100)}`,
              report: notes.slice(0, 2000),
            });
            if (severity === 'high') await notifyAdminOfBug({ title: findings[0].note.slice(0, 100), severity });
          }
        } catch (err) {
          console.error('[bug-report] metrics audit failed:', err && err.message);
        }
      })();
    });
  });
}

// Admin read surface. Deliberately 200 {admin:false} for everyone else — the
// client probes this once on load, and a 404/403 would show up as noise in the
// network tab and in bug-watch's own capture. Same probe pattern the chat beta
// gate used.
router.get('/admin/bug-reports', (req, res) => {
  if (!isAdminUser(req)) return res.json({ ok: true, admin: false });
  const reports = listBugReports(50).map((r) => {
    let parsedRaw = null;
    try { parsedRaw = JSON.parse(r.raw); } catch { /* legacy/trimmed raw */ }
    return {
      id: r.id,
      kind: r.kind,
      userId: r.user_id,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      count: r.count,
      severity: r.severity,
      title: r.title,
      report: r.report,
      status: r.status,
      url: parsedRaw && typeof parsedRaw.url === 'string' ? parsedRaw.url : null,
    };
  });
  res.json({ ok: true, admin: true, newCount: countNewBugReports(), reports });
});

router.post('/admin/bug-reports/seen', express.json(), (req, res) => {
  if (!isAdminUser(req)) return res.status(404).end();
  const cleared = markAllBugReportsSeen();
  res.json({ ok: true, cleared });
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

module.exports = router;
// Exported for tests: the Steward AI tool surface (must run inside withUser()).
module.exports.executeStewardTool = executeStewardTool;
module.exports.STEWARD_AI_TOOLS = STEWARD_AI_TOOLS;
module.exports.saveSnapshotForUser = saveSnapshotForUser;
module.exports.bugSignature = bugSignature;
