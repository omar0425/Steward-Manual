'use strict';

const express = require('express');
const router  = express.Router();

const {
  latestCombined,
  latestSnapshot,
  recentSnapshots,
  getConfig,
  setConfig,
  getDebtAccountHistory,
  getGameStart,
  resetAllGameState,
  initGameState,
  insertSnapshot,
  replaceDebtAccountBalances,
  appendDebtAccountHistory,
} = require('../db');
const {
  getTier,
  nextTierInfo,
  debtTierBandProgress,
  debtTierJourneyProgress,
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
  breathingRoomGoalFields,
} = require('../services/stability');
const { projectedDebugDebtSync } = require('../services/debtSyncDebugApi');

// ── GET /api/status ───────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const debugDebtTier =
    req.query.debugDebtTier === '1';
  const debugDebtSync =
    req.query.debugDebtSync === '1';
  const snap = latestCombined();

  if (!snap) {
    return res.json({
      ready: false,
      noData: true,
      message: 'No data yet. Use the entry form to add your first snapshot.',
      lastError: null,
    });
  }

  const snapshots = recentSnapshots(60);
  const tierObj   = getTier(snap.debt_remaining);
  const next      = nextTierInfo(snap.debt_remaining, snapshots);
  const climb     = getClimbStatsFromConfig();
  const bandProg  = debtTierBandProgress(snap.debt_remaining, tierObj, snapshots, climb.climbBaselineDebt);
  const nextGapRounded = Math.round(next.gapDollars * 100) / 100;
  const debtTierJourney = debtTierJourneyProgress(
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
    ...breathingRoomGoalFields(stabilityRaw.effectiveRunwayMonths),
  };

  // Freshness label
  const pulledAt  = new Date(snap.pulled_at);
  const ageMs     = Date.now() - pulledAt.getTime();
  const ageHours  = ageMs / (1000 * 60 * 60);
  let freshness;
  if (ageHours < 1)        freshness = 'Live';
  else if (ageHours < 48)  freshness = `${Math.floor(ageHours)}h ago`;
  else                     freshness = 'Stale >48h';

  const streak = computeStreak(snapshots);
  const lastDebtSync = getLastDebtSyncDebugForStatus();
  const { gameStartDebt, gameStartAt } = getGameStart();
  const aggregatePaydownSinceGameStart =
    Number.isFinite(Number(gameStartDebt)) && Number.isFinite(Number(snap.debt_remaining))
      ? Math.max(0, Math.round((Number(gameStartDebt) - Number(snap.debt_remaining)) * 100) / 100)
      : 0;

  const rawLastPullNewDebtSum =
    lastDebtSync && Number.isFinite(Number(lastDebtSync.turn_new_debt_sum))
      ? Number(lastDebtSync.turn_new_debt_sum)
      : (lastDebtSync && Number.isFinite(Number(lastDebtSync.new_debt_sum)) ? Number(lastDebtSync.new_debt_sum) : null);
  const rawLastPullPaydownSum =
    lastDebtSync && Number.isFinite(Number(lastDebtSync.turn_paydown_sum))
      ? Number(lastDebtSync.turn_paydown_sum)
      : (lastDebtSync && Number.isFinite(Number(lastDebtSync.paydown_sum)) ? Number(lastDebtSync.paydown_sum) : null);
  const rawLastPullAccountLines =
    lastDebtSync && Array.isArray(lastDebtSync.account_lines) ? lastDebtSync.account_lines : null;
  const debtAccountLines =
    lastDebtSync && Array.isArray(lastDebtSync.current_account_lines)
      ? lastDebtSync.current_account_lines
      : null;
  const historyAccountLines = debtAccountChangeLinesFromHistory(
    getDebtAccountHistory(5),
    debtAccountLines,
  );
  const lastPullAccountLines =
    historyAccountLines.length > 0 ? historyAccountLines : rawLastPullAccountLines;
  let historyPaydownSum = 0;
  let historyNewDebtSum = 0;
  for (const line of historyAccountLines) {
    const d = Number(line && line.delta);
    if (d < 0) historyPaydownSum += Math.abs(d);
    else if (d > 0) historyNewDebtSum += d;
  }
  historyPaydownSum = Math.round(historyPaydownSum * 100) / 100;
  historyNewDebtSum = Math.round(historyNewDebtSum * 100) / 100;
  const recoveredTurnPaydown =
    aggregatePaydownSinceGameStart > 0 &&
    (!lastPullAccountLines || lastPullAccountLines.length === 0) &&
    Number(rawLastPullPaydownSum || 0) === 0 &&
    Number(rawLastPullNewDebtSum || 0) === 0
      ? aggregatePaydownSinceGameStart
      : 0;
  const lastPullNewDebtSum =
    historyAccountLines.length > 0 ? historyNewDebtSum : rawLastPullNewDebtSum;
  const lastPullPaydownSum =
    historyAccountLines.length > 0 ? historyPaydownSum : (recoveredTurnPaydown || rawLastPullPaydownSum);
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

  const payload = {
    ready: true,
    suspectedRestructure: !!(lastDebtSync && lastDebtSync.suspected_restructure === true),
    tier: tierObj,
    stability,
    streak,
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
      monthlyIncome:    snap.monthly_income,
      monthlyExpenses:  snap.monthly_expenses,
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
          monthsEstimate: next.monthsEstimate,
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

  if (debugDebtTier || debugDebtSync) {
    payload.debug = {
      ...(debugDebtTier
        ? {
            debtTierBand: explainDebtTierBandProgress(
              snap.debt_remaining,
              tierObj,
              snapshots,
              climb.climbBaselineDebt,
            ),
          }
        : {}),
      ...(debugDebtSync ? { debtSync: lastDebtSync } : {}),
    };
  }

  if (debugDebtSync) {
    const debtSyncFields = projectedDebugDebtSync(lastDebtSync);
    payload.sync_valid = debtSyncFields.sync_valid;
    payload.sync_errors = debtSyncFields.sync_errors;
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
    const {
      totalAssets = 0,
      totalDebt = 0,
      monthlyIncome = 0,
      monthlyExpenses = 0,
      investmentValue = 0,
      debtAccounts = [],
    } = req.body || {};

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

    const assets   = roundMoney(totalAssets);
    const debt     = roundMoney(totalDebt);
    const income   = roundMoney(monthlyIncome);
    const expenses = roundMoney(monthlyExpenses);
    const invest   = roundMoney(investmentValue);
    const now      = new Date().toISOString();

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
        const bal = roundMoney(acct.balance);
        const name = typeof acct.name === 'string' && acct.name.trim() ? acct.name.trim() : 'Account';
        if (bal > 0) {
          sumFromAccounts += bal;
          debtBalanceMap.set(id, bal);
          debtDisplayRows.push({ id, name, balance: bal });
        }
      }
      if (sumFromAccounts > 0) {
        debtRemaining = roundMoney(sumFromAccounts);
      }
    }

    // Safety liquid: use total assets as proxy (all manually entered assets are presumed liquid)
    const safetyLiquid = assets;

    // Months ahead (simple: assets / expenses)
    const monthsAhead = expenses > 0 ? roundMoney(assets / expenses) : null;

    // Determine tier
    const { getTier } = require('../services/tiers');
    const tierObj = getTier(debtRemaining);

    // Insert snapshot
    const netWorth = roundMoney(assets + invest - (debt > debtRemaining ? debt : debtRemaining));
    insertSnapshot({
      source:           'manual',
      pulled_at:        now,
      net_worth:        netWorth,
      total_assets:     assets,
      total_debt:       debt > debtRemaining ? debt : debtRemaining,
      investment_value: invest,
      debt_remaining:   debtRemaining,
      months_ahead:     monthsAhead,
      monthly_income:   income,
      monthly_expenses: expenses,
      tier:             tierObj.id,
      safety_liquid:    safetyLiquid,
    });

    // Update per-account debt tracking (for climb metrics deltas)
    if (debtBalanceMap.size > 0) {
      const { getAllDebtAccountBalances } = require('../db');
      const prevBalances = getAllDebtAccountBalances();

      replaceDebtAccountBalances(debtBalanceMap);
      appendDebtAccountHistory(debtBalanceMap);

      // Apply climb metrics
      applyClimbMetricsOnPull(debtRemaining, prevBalances, debtBalanceMap);

      // Build display rows for the debt sync debug
      const displayRows = perAccountDebtDeltaDisplayRows(prevBalances, debtBalanceMap, debtDisplayRows);
      const debugPayload = {
        pulled_at: now,
        debt_remaining: debtRemaining,
        account_lines: displayRows,
        current_account_lines: debtDisplayRows,
      };
      setLastDebtSyncDebug(debugPayload);
      persistLastDebtSyncDebugSnapshot(debugPayload);
    } else {
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

    // Set game start if this is the first snapshot
    const { setGameStartIfAbsent } = require('../db');
    setGameStartIfAbsent(debtRemaining, now);

    // Set climb baseline if not already set
    const { setConfigIfAbsent } = require('../db');
    setConfigIfAbsent('climb_baseline_debt', String(debtRemaining));
    setConfigIfAbsent('debt_start', String(debtRemaining));

    return res.json({
      ok: true,
      message: 'Snapshot saved.',
      debtRemaining,
      tier: tierObj.id,
    });
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
    const snap = latestSnapshot();
    if (!snap) {
      return res.status(503).json({
        ok: false,
        error: 'No data yet — enter your first snapshot, then try again.',
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
    resetAllGameState();
    clearLastDebtSyncDebug();
    return res.json({ ok: true });
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

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function debtAccountChangeLinesFromHistory(byAccount, currentAccountLines) {
  if (!byAccount || typeof byAccount !== 'object') return [];

  const nameById = new Map();
  for (const acct of Array.isArray(currentAccountLines) ? currentAccountLines : []) {
    if (acct && acct.id) {
      nameById.set(String(acct.id), acct.name || 'Account');
    }
  }

  const rows = [];
  for (const [id, points] of Object.entries(byAccount)) {
    if (!Array.isArray(points) || points.length < 2) continue;
    const ordered = points
      .map((p) => ({
        date: p && p.date ? String(p.date) : '',
        balance: Number(p && p.balance),
      }))
      .filter((p) => p.date && Number.isFinite(p.balance))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (ordered.length < 2) continue;

    const first = ordered[0].balance;
    const last = ordered[ordered.length - 1].balance;
    const delta = Math.round((last - first) * 100) / 100;
    if (delta === 0) continue;
    rows.push({
      name: nameById.get(String(id)) || 'Account',
      delta,
      kind: delta < 0 ? 'decreased' : 'increased',
    });
  }

  rows.sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)));
  return rows;
}

module.exports = router;
