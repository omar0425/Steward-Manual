'use strict';

const express = require('express');
const router  = express.Router();

const {
  latestSnapshot,
  recentSnapshots,
  exportUserData,
  getConfig,
  withUser,
  setConfig,
  getDebtAccountHistory,
  getGameStart,
  resetAllGameState,
  initGameState,
  insertSnapshot,
  replaceDebtAccountBalances,
  appendDebtAccountHistory,
  lastNonZeroFinancials,
  getAllDebtAccountBalances,
  getDebtAccountFirstBalances,
} = require('../db');
const { monthlyPaceFromSnapshots, projectDebtFree, paidThisMonth } = require('../services/pace');
const { buildPayoffPlan } = require('../services/payoffPlan');
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
  captureUndoState,
  undoLastPull,
  hasUndoState,
  peekUndoLabel,
  getLastDebtSyncDebugForStatus,
  computeStreak,
  applyClimbMetricsOnPull,
  KEY_MAP_SEEDED,
  setLastDebtSyncDebug,
  persistLastDebtSyncDebugSnapshot,
  perAccountDebtDeltaDisplayRows,
  roundMoney,
} = require('../services/climbMetrics');
const {
  computeStability,
  stabilityNarrative,
} = require('../services/stability');
const stewardAi = require('../services/stewardAi');
const stewardAiContext = require('../services/stewardAiContext');
const stewardAiLedger = require('../services/stewardAiLedger');

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
  const setupDebtAccountLines =
    setupDebtSync && Array.isArray(setupDebtSync.current_account_lines)
      ? setupDebtSync.current_account_lines
      : null;

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

  const streak = computeStreak(snapshots);
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
    // Fall back to the persisted name map so "THIS TURN" shows real account names
    const rawNameMap = getConfig('debt_account_name_map');
    if (rawNameMap) {
      try {
        const m = JSON.parse(rawNameMap);
        debtAccountLines = Object.entries(m).map(([id, name]) => ({ id, name }));
      } catch (_) { /* ignore malformed */ }
    }
  }

  // Per-account paid-down percentage: how far each card has come from its
  // original (first-ever recorded) balance. Attached for the panel to render.
  if (Array.isArray(debtAccountLines) && debtAccountLines.length) {
    const firstBalances = getDebtAccountFirstBalances();
    debtAccountLines = debtAccountLines.map((line) => {
      const start = Number(firstBalances.get(String(line.id)));
      const bal = Number(line.balance);
      if (Number.isFinite(start) && start > 0 && Number.isFinite(bal)) {
        const pct = Math.max(0, Math.min(100, Math.round(((start - bal) / start) * 1000) / 10));
        return { ...line, startBalance: roundMoney(start), pctPaid: pct };
      }
      return line;
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
  // If we have aggregate paydown since game start but no per-pull lines yet
  // (e.g. an aggregate-only pull after restart, or the very first pull),
  // surface the aggregate so the user sees their progress instead of zero.
  if (lastPullPaydownSum === 0 && lastPullNewDebtSum === 0 && aggregatePaydownSinceGameStart > 0
      && lastPullAccountLines.length === 0) {
    lastPullPaydownSum = aggregatePaydownSinceGameStart;
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
  const recentMilestones = candidateMilestones.filter((m) => !seenIds.has(m.id));

  // monthsEstimate: average monthly paydown from recent snapshots, applied to
  // the gap to the next climb tier. Requires at least a day of elapsed time
  // across the sample to avoid noisy estimates from rapid-fire snapshots
  // (e.g. correcting a typo) where dividing by near-zero elapsed time gives a
  // bogus "1 month away" answer.
  let monthsEstimateClimb = null;
  // Shared span-gated monthly pace — same helper the Steward forecasts use,
  // so the dashboard estimate and the AI dates can never disagree, and a
  // burst of same-week entries can't produce a bogus "1 month away".
  const monthlyPace = monthlyPaceFromSnapshots(snapshots);
  if (next.nextTier && next.gapDollars > 0 && monthlyPace && monthlyPace > 0) {
    monthsEstimateClimb = Math.ceil(next.gapDollars / monthlyPace);
  }
  // Projected debt-free date + this-month progress, from the same real history.
  const debtFreeProjection = projectDebtFree(snapshots, snap.debt_remaining, { monthlyPace });
  const netPaidThisMonth = paidThisMonth(snapshots);

  // "Pay this next" — avalanche (highest APR) + snowball (smallest balance),
  // from authoritative balances joined with stored APRs and names.
  const planRates = parseJsonObject(getConfig('interest_rates'));
  const planNames = parseJsonObject(getConfig('debt_account_name_map'));
  const planAccounts = [...getAllDebtAccountBalances().entries()].map(([id, balance]) => ({
    id,
    name: planNames[id] || 'Account',
    balance,
    apr: planRates[id],
  }));
  const payoffPlan = buildPayoffPlan(planAccounts);

  const payload = {
    ready: true,
    tier: tierObj,
    stability,
    streak,
    recentMilestones,
    aiEnabled: stewardAi.isConfigured(),
    stats: {
      debtRemaining:    snap.debt_remaining,
      debtDirection,
      climbBaselineDebt:     climb.climbBaselineDebt,
      cumulativePaidDown:    climb.cumulativePaidDown,
      cumulativeNewDebtAdded: climb.cumulativeNewDebtAdded,
      cumulativeInterestAccrued: climb.cumulativeInterestAccrued,
      canUndo:               hasUndoState(),
      undoLabel:             peekUndoLabel(),
      monthlyPace:           monthlyPace || 0,
      debtFree:              debtFreeProjection,
      paidThisMonth:         netPaidThisMonth,
      payoffPlan,
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
      let sumFromAccounts = 0;
      for (const acct of debtAccounts) {
        if (!acct || typeof acct !== 'object') {
          return res.status(400).json({ ok: false, error: 'debtAccounts entries must be objects' });
        }
        const id  = String(acct.id || `acct-${debtDisplayRows.length}`);
        if (debtBalanceMap.has(id)) {
          return res.status(400).json({ ok: false, error: `Duplicate debt account id: ${id}` });
        }
        if (isNegativeFinite(acct.balance)) {
          return res.status(400).json({ ok: false, error: `Debt account ${id} balance cannot be negative` });
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
    if (classifications && typeof classifications === 'object') {
      for (const [id, cat] of Object.entries(classifications)) {
        if (typeof cat === 'string') increaseClassifications[String(id)] = cat;
      }
    }
    for (const rawId of Array.isArray(preexistingAccountIds) ? preexistingAccountIds : []) {
      increaseClassifications[String(rawId)] = 'preexisting';
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

    // Update per-account debt tracking. During setup this is inventory only;
    // climb metrics begin after POST /api/start-game locks the baseline.
    if (debtBalanceMap.size > 0) {
      const prevBalances = getAllDebtAccountBalances();

      // Snapshot the pre-pull state so a wrong entry can be undone exactly.
      // Captured before any mutation, only while the climb is running.
      if (gameActive) captureUndoState(snapshotId, prevBalances);

      replaceDebtAccountBalances(debtBalanceMap);
      appendDebtAccountHistory(debtBalanceMap);

      if (gameActive) {
        // Per-account classifications route this pull's increases to new debt,
        // interest, or the baseline (forgot-a-debt) — see applyClimbMetricsOnPull.
        applyClimbMetricsOnPull(debtRemaining, prevBalances, debtBalanceMap, increaseClassifications);
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
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
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
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
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
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
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
    return res.json({ ok: true, moved: result.moved, kind: result.kind, stats: getClimbStatsFromConfig() });
  } catch (err) {
    console.error('[api] reclassify-added-debt', err);
    return res.status(500).json({ ok: false, error: 'Reclassification failed.' });
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

  if (req.query.format === 'csv') {
    // Account names live in the settings name map, not the history table.
    let nameById = {};
    try { nameById = JSON.parse(data.settings.debt_account_name_map || '{}'); } catch { /* ignore */ }

    if (req.query.table === 'accounts') {
      // Long-format per-account balance history — pivots cleanly in Excel.
      const csv = toCsv(
        ['account_id', 'account_name', 'recorded_at', 'balance'],
        data.debtAccountHistory.map((r) => [r.accountId, nameById[r.accountId] || '', excelDate(r.recordedAt), r.balance]),
      );
      res.setHeader('Content-Disposition', `attachment; filename="steward-accounts-${stamp}.csv"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    }

    // Default CSV: the snapshot time series — the sheet you'd actually chart.
    const csv = toCsv(
      ['pulled_at', 'total_debt', 'debt_remaining', 'total_assets', 'investment_value',
        'monthly_income', 'monthly_expenses', 'net_worth', 'tier'],
      data.snapshots.map((s) => [
        excelDate(s.pulled_at), s.total_debt, s.debt_remaining, s.total_assets,
        s.investment_value, s.monthly_income, s.monthly_expenses, s.net_worth, s.tier,
      ]),
    );
    res.setHeader('Content-Disposition', `attachment; filename="steward-snapshots-${stamp}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'steward-manual',
    user: req.user
      ? { username: req.user.username, email: req.user.email || null }
      : null,
    ...data,
  };
  res.setHeader('Content-Disposition', `attachment; filename="steward-export-${stamp}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

module.exports = router;
