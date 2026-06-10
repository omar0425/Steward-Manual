'use strict';

const express = require('express');
const router  = express.Router();

const {
  latestCombined,
  latestSnapshot,
  recentSnapshots,
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
} = require('../db');
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
  getLastDebtSyncDebugForStatus,
  computeStreak,
  applyClimbMetricsOnPull,
  KEY_MAP_SEEDED,
  setLastDebtSyncDebug,
  persistLastDebtSyncDebugSnapshot,
  perAccountDebtDeltaDisplayRows,
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

// ── GET /api/status ───────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const debugDebtTier =
    req.query.debugDebtTier === '1';
  const snap = latestCombined();

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
  const seenIdsRaw = getConfig('notifications_sent');
  let seenIds = new Set();
  if (seenIdsRaw) {
    try {
      const parsed = JSON.parse(seenIdsRaw);
      if (Array.isArray(parsed)) seenIds = new Set(parsed);
    } catch (_) { /* ignore malformed */ }
  }
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
  const MIN_DAYS_FOR_PACE = 1;
  if (next.nextTier && next.gapDollars > 0 && snapshots.length >= 2) {
    const usable = snapshots.slice(0, Math.min(snapshots.length, 4));
    const newest = usable[0];
    const oldest = usable[usable.length - 1];
    const msElapsed = new Date(newest.pulled_at) - new Date(oldest.pulled_at);
    const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
    if (daysElapsed >= MIN_DAYS_FOR_PACE) {
      const monthsElapsed = daysElapsed / 30.44;
      const totalPaydown = oldest.debt_remaining - newest.debt_remaining;
      const avgMonthlyPaydown = totalPaydown / monthsElapsed;
      if (avgMonthlyPaydown > 0) {
        monthsEstimateClimb = Math.ceil(next.gapDollars / avgMonthlyPaydown);
      }
    }
  }

  const payload = {
    ready: true,
    tier: tierObj,
    stability,
    streak,
    recentMilestones,
    stats: {
      debtRemaining:    snap.debt_remaining,
      debtDirection,
      climbBaselineDebt:     climb.climbBaselineDebt,
      cumulativePaidDown:    climb.cumulativePaidDown,
      cumulativeNewDebtAdded: climb.cumulativeNewDebtAdded,
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

function roundMoney(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

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

    // Determine tier (relative to climb baseline, falls back to rock_bottom if not yet set)
    const climb = getClimbStatsFromConfig();
    const tierObj = getClimbTier(debtRemaining, climb.climbBaselineDebt);

    // Insert snapshot — when individual accounts are provided their sum is authoritative
    // for both total_debt and debt_remaining so the two columns stay consistent.
    const effectiveTotalDebt = debtBalanceMap.size > 0 ? debtRemaining : debt;
    const netWorth = roundMoney(assets + invest - effectiveTotalDebt);
    insertSnapshot({
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

      replaceDebtAccountBalances(debtBalanceMap);
      appendDebtAccountHistory(debtBalanceMap);

      if (gameActive) {
        applyClimbMetricsOnPull(debtRemaining, prevBalances, debtBalanceMap);
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
  const raw = getConfig(INTEREST_RATES_KEY);
  let rates = {};
  if (raw) {
    try { rates = JSON.parse(raw); } catch { rates = {}; }
    if (typeof rates !== 'object' || Array.isArray(rates) || rates === null) rates = {};
  }
  res.json({ rates });
});

// ── POST /api/config/interest-rates ──────────────────────────────────────────

router.post('/config/interest-rates', express.json(), (req, res) => {
  const { rates } = req.body || {};
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) {
    return res.status(400).json({ error: 'rates (object) required' });
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

// ── GET /api/config/notifications-sent ────────────────────────────────────────

const NOTIFICATIONS_SENT_KEY = 'notifications_sent';

router.get('/config/notifications-sent', (req, res) => {
  const raw = getConfig(NOTIFICATIONS_SENT_KEY);
  let sent = [];
  if (raw) {
    try { const parsed = JSON.parse(raw); sent = Array.isArray(parsed) ? parsed : []; } catch { sent = []; }
  }
  res.json({ sent });
});

// ── POST /api/config/notifications-sent ───────────────────────────────────────

router.post('/config/notifications-sent', express.json(), (req, res) => {
  const { milestone } = req.body || {};
  if (!milestone || typeof milestone !== 'string') {
    return res.status(400).json({ error: 'milestone (string) required' });
  }
  const raw = getConfig(NOTIFICATIONS_SENT_KEY);
  let sent = [];
  if (raw) {
    try { const parsed = JSON.parse(raw); sent = Array.isArray(parsed) ? parsed : []; } catch { sent = []; }
  }
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

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

module.exports = router;
