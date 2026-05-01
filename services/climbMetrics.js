'use strict';

/**
 * Persistent cumulative debt climb metrics (separate from tier/stage band math).
 * Updated on each snapshot from **per-account** debt deltas so that
 * removing a liability account is not counted as paydown.
 */

const { getConfig, setConfig, setConfigIfAbsent, currentUserId } = require('../db');

const KEY_BASELINE = 'climb_baseline_debt';
const KEY_PAID = 'cumulative_paid_down';
const KEY_NEW = 'cumulative_new_debt_added';
const KEY_LAST = 'last_aggregate_debt_for_climb';
/** After first successful `replaceDebtAccountBalances`, per-account deltas are trusted (incl. empty maps). */
const KEY_MAP_SEEDED = 'climb_per_account_map_seeded';

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parseConfigNum(val, fallback = 0) {
  if (val == null || val === '') return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

function applyAggregateRecoveryFromBaseline(baseline, debt) {
  const base = roundMoney(baseline);
  const curr = roundMoney(debt);
  if (!Number.isFinite(base) || !Number.isFinite(curr) || base <= 0 || curr < 0) {
    return { recoveredPaidDown: 0, recoveredNewDebt: 0 };
  }

  const paid = parseConfigNum(getConfig(KEY_PAID), 0);
  const newD = parseConfigNum(getConfig(KEY_NEW), 0);
  const aggregateDelta = roundMoney(curr - base);
  const recoveredPaidDown = aggregateDelta < 0 ? Math.abs(aggregateDelta) : 0;
  const recoveredNewDebt = aggregateDelta > 0 ? aggregateDelta : 0;

  if (recoveredPaidDown > paid) setConfig(KEY_PAID, String(recoveredPaidDown));
  if (recoveredNewDebt > newD) setConfig(KEY_NEW, String(recoveredNewDebt));

  return { recoveredPaidDown, recoveredNewDebt };
}

/**
 * Pure delta step for tests: given previous last reading and new aggregate debt,
 * return increments to cumulative paid / new debt (non-negative).
 */
function applyDeltaToTotals(lastAggregate, debtRemaining, cumulativePaidDown, cumulativeNewDebtAdded) {
  const debtRaw = Number(debtRemaining);
  const lastRaw = Number(lastAggregate);
  const debt = roundMoney(debtRaw);
  const last = roundMoney(lastRaw);
  let paid = roundMoney(Math.max(0, Number(cumulativePaidDown)));
  let newD = roundMoney(Math.max(0, Number(cumulativeNewDebtAdded)));
  if (!Number.isFinite(debtRaw) || debt < 0) {
    return { cumulativePaidDown: paid, cumulativeNewDebtAdded: newD, last: last };
  }
  if (!Number.isFinite(lastRaw)) {
    return { cumulativePaidDown: paid, cumulativeNewDebtAdded: newD, last: debt };
  }
  const delta = roundMoney(debt - last);
  if (delta < 0) paid = roundMoney(paid + Math.abs(delta));
  else if (delta > 0) newD = roundMoney(newD + delta);
  return { cumulativePaidDown: paid, cumulativeNewDebtAdded: newD, last: debt };
}

/**
 * Pure: compare last pull’s debt magnitudes to the current pull.
 * - Balance decrease on an existing account → paydown.
 * - Balance increase on an existing account → new debt.
 * - Account disappeared → no effect (not paydown).
 * - New debt account → full balance counts as new debt.
 *
 * @param {Map<string, number>} prev
 * @param {Map<string, number>} curr
 * @returns {{
 *   paydownSum: number,
 *   newDebtSum: number,
 *   accountsDecreasedCount: number,
 *   accountsIncreasedCount: number,
 *   accountsAddedCount: number,
 *   accountsRemovedCount: number,
 * }}
 */
function analyzePerAccountDebtDiff(prev, curr) {
  const p = prev instanceof Map ? prev : new Map();
  const c = curr instanceof Map ? curr : new Map();
  let paydownSum = 0;
  let newDebtSum = 0;
  let accountsDecreasedCount = 0;
  let accountsIncreasedCount = 0;
  let accountsAddedCount = 0;
  let accountsRemovedCount = 0;

  for (const [id, prevBal] of p) {
    if (c.has(id)) {
      const delta = roundMoney(c.get(id) - prevBal);
      if (delta < 0) {
        paydownSum = roundMoney(paydownSum + Math.abs(delta));
        accountsDecreasedCount += 1;
      } else if (delta > 0) {
        newDebtSum = roundMoney(newDebtSum + delta);
        accountsIncreasedCount += 1;
      }
    } else {
      accountsRemovedCount += 1;
    }
  }
  for (const [id, currBal] of c) {
    if (!p.has(id)) {
      newDebtSum = roundMoney(newDebtSum + currBal);
      accountsAddedCount += 1;
    }
  }

  return {
    paydownSum,
    newDebtSum,
    accountsDecreasedCount,
    accountsIncreasedCount,
    accountsAddedCount,
    accountsRemovedCount,
  };
}

/** @returns {{ paydownSum: number, newDebtSum: number }} */
function summarizePerAccountDebtDeltas(prev, curr) {
  const a = analyzePerAccountDebtDiff(prev, curr);
  return { paydownSum: a.paydownSum, newDebtSum: a.newDebtSum };
}

/**
 * Human-readable rows for last pull: change in debt magnitude per account.
 * Positive delta = balance owed increased; negative = paydown. New accounts: full balance as positive.
 * Removed accounts: negative prior magnitude (label generically).
 *
 * @param {Map<string, number>} previousByAccountId
 * @param {Map<string, number>} currentByAccountId
 * @param {Array<{ id?: string, name?: string }>} [accounts] Current debt accounts (for names).
 * @returns {{ name: string, delta: number, kind: 'decreased' | 'increased' | 'new' | 'removed' }[]}
 */
function perAccountDebtDeltaDisplayRows(previousByAccountId, currentByAccountId, accounts) {
  const p = previousByAccountId instanceof Map ? previousByAccountId : new Map();
  const c = currentByAccountId instanceof Map ? currentByAccountId : new Map();
  const nameById = new Map();
  if (Array.isArray(accounts)) {
    for (const acct of accounts) {
      if (acct && acct.id) {
        const nm = typeof acct.name === 'string' && acct.name.trim() ? acct.name.trim() : 'Account';
        nameById.set(acct.id, nm);
      }
    }
  }
  const ids = new Set([...p.keys(), ...c.keys()]);
  const rows = [];
  for (const id of ids) {
    const prevBal = p.has(id) ? roundMoney(Number(p.get(id))) : 0;
    const currBal = c.has(id) ? roundMoney(Number(c.get(id))) : 0;
    if (!p.has(id) && c.has(id)) {
      if (currBal !== 0) {
        rows.push({ name: nameById.get(id) || 'Account', delta: roundMoney(currBal), kind: 'new' });
      }
      continue;
    }
    if (p.has(id) && !c.has(id)) {
      if (prevBal !== 0) {
        rows.push({
          name: nameById.get(id) || 'Account (no longer tracked)',
          delta: roundMoney(-prevBal),
          kind: 'removed',
        });
      }
      continue;
    }
    const delta = roundMoney(currBal - prevBal);
    if (delta !== 0) {
      const kind = delta < 0 ? 'decreased' : 'increased';
      rows.push({ name: nameById.get(id) || 'Account', delta, kind });
    }
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return rows;
}

/** Last debt-sync summary per user (keyed by userId to prevent cross-user bleed). */
const lastDebtSyncDebugByUser = new Map();

function getLastDebtSyncDebug() {
  return lastDebtSyncDebugByUser.get(currentUserId()) ?? null;
}

function setLastDebtSyncDebug(payload) {
  lastDebtSyncDebugByUser.set(currentUserId(), payload);
}

function clearLastDebtSyncDebug() {
  lastDebtSyncDebugByUser.delete(currentUserId());
}

/** JSON snapshot of last successful pull’s debt-sync debug (UI / API only; not used for climb math). */
const KEY_LAST_DEBT_SYNC_SNAPSHOT = 'last_debt_sync_debug_snapshot_v1';

function persistLastDebtSyncDebugSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return;
  try {
    setConfig(KEY_LAST_DEBT_SYNC_SNAPSHOT, JSON.stringify(payload));
  } catch (err) {
    console.warn('[climb-metrics] persistLastDebtSyncDebugSnapshot failed:', err && err.message);
  }
}

function readLastDebtSyncDebugSnapshot() {
  const raw = getConfig(KEY_LAST_DEBT_SYNC_SNAPSHOT);
  if (raw == null || raw === '') return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** In-memory from the latest pull in this process, else the last persisted pull (restart-safe for “This turn”). */
function getLastDebtSyncDebugForStatus() {
  const mem = getLastDebtSyncDebug();
  if (mem) return mem;
  return readLastDebtSyncDebugSnapshot();
}

/**
 * Call after `debt_start` has been seeded for this pull (legacy compat).
 * First initialization: baseline from `debt_start` if present (migration), else current debt;
 * cumulatives 0; last = current — no paydown delta on that run.
 *
 * @param {number} debtRemaining  Aggregate debt (sum of liability balances), same as snapshots.
 * @param {Map<string, number>} previousByAccountId  From `debt_account_balances` (may be empty).
 * @param {Map<string, number>} currentByAccountId  Built from current debt accounts.
 * @returns {object} climbAction, analysis, map_seeded_before, aggregate_debt_remaining
 */
function applyClimbMetricsOnPull(debtRemaining, previousByAccountId, currentByAccountId) {
  const prev = previousByAccountId instanceof Map ? previousByAccountId : new Map();
  const curr = currentByAccountId instanceof Map ? currentByAccountId : new Map();
  const analysis = analyzePerAccountDebtDiff(prev, curr);
  const mapSeededBefore = getConfig(KEY_MAP_SEEDED) === '1';

  const debtRaw = Number(debtRemaining);
  const debt = roundMoney(debtRaw);
  const aggDisplay = Number.isFinite(debtRaw) ? debt : debtRaw;
  const baseReturn = {
    climbAction: 'invalid_debt',
    analysis,
    map_seeded_before: mapSeededBefore,
    aggregate_debt_remaining: aggDisplay,
  };

  if (!Number.isFinite(debtRaw) || debt < 0) {
    return baseReturn;
  }

  const baselineStr = getConfig(KEY_BASELINE);

  if (baselineStr == null || baselineStr === '') {
    const legacy = getConfig('debt_start');
    let baseline = debt;
    if (legacy != null && legacy !== '') {
      const ls = parseConfigNum(legacy, NaN);
      if (Number.isFinite(ls) && ls > 0) baseline = roundMoney(ls);
    }
    setConfig(KEY_BASELINE, String(baseline));
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '0');
    setConfig(KEY_LAST, String(debt));
    setConfig(KEY_MAP_SEEDED, '1');
    return { ...baseReturn, climbAction: 'baseline_init', aggregate_debt_remaining: debt };
  }

  const lastStr = getConfig(KEY_LAST);
  const last = parseConfigNum(lastStr, NaN);
  if (!Number.isFinite(last)) {
    const hadStored = lastStr != null && lastStr !== '';
    if (hadStored) {
      console.warn(
        '[climb-metrics] last_aggregate_debt_for_climb was corrupt (%j). Skipping delta for this pull; re-seeded last to current aggregate debt %s.',
        lastStr,
        String(debt),
      );
    }
    const baseline = parseConfigNum(baselineStr, NaN);
    const recovery = applyAggregateRecoveryFromBaseline(baseline, debt);
    setConfig(KEY_LAST, String(debt));
    setConfigIfAbsent(KEY_PAID, '0');
    setConfigIfAbsent(KEY_NEW, '0');
    return {
      ...baseReturn,
      climbAction:
        recovery.recoveredPaidDown > 0 || recovery.recoveredNewDebt > 0
          ? 'aggregate_recovery'
          : 'corrupt_last_recovery',
      aggregate_debt_remaining: debt,
      aggregate_recovery: recovery,
    };
  }

  if (getConfig(KEY_MAP_SEEDED) !== '1') {
    // First pull after deploy (or upgrade): persist map this run, no delta.
    setConfig(KEY_LAST, String(debt));
    setConfig(KEY_MAP_SEEDED, '1');
    return {
      ...baseReturn,
      climbAction: 'anchor_no_delta',
      aggregate_debt_remaining: debt,
    };
  }

  if (prev.size === 0 && curr.size > 0) {
    const paid = parseConfigNum(getConfig(KEY_PAID), 0);
    const newD = parseConfigNum(getConfig(KEY_NEW), 0);
    const aggregateDelta = roundMoney(debt - last);
    if (aggregateDelta < 0) {
      setConfig(KEY_PAID, String(roundMoney(paid + Math.abs(aggregateDelta))));
    } else if (aggregateDelta > 0) {
      setConfig(KEY_NEW, String(roundMoney(newD + aggregateDelta)));
    }
    setConfig(KEY_LAST, String(debt));
    return {
      ...baseReturn,
      climbAction: 'account_map_handoff',
      aggregate_debt_remaining: debt,
    };
  }

  const { paydownSum, newDebtSum } = analysis;
  const paid = parseConfigNum(getConfig(KEY_PAID), 0);
  const newD = parseConfigNum(getConfig(KEY_NEW), 0);
  setConfig(KEY_PAID, String(roundMoney(paid + paydownSum)));
  setConfig(KEY_NEW, String(roundMoney(newD + newDebtSum)));
  setConfig(KEY_LAST, String(debt));
  return { ...baseReturn, climbAction: 'deltas_applied', aggregate_debt_remaining: debt };
}

/**
 * Values for GET /api/status. If climb keys are absent (pre-migration), baseline falls back to `debt_start`.
 */
function getClimbStatsFromConfig() {
  const baselineStr = getConfig(KEY_BASELINE);
  const debtStartFallback = getConfig('debt_start');

  let climbBaselineDebt = parseConfigNum(baselineStr, NaN);
  if (!Number.isFinite(climbBaselineDebt) || climbBaselineDebt <= 0) {
    climbBaselineDebt = parseConfigNum(debtStartFallback, 0);
  }

  const cumulativePaidDown = Math.max(0, parseConfigNum(getConfig(KEY_PAID), 0));
  const cumulativeNewDebtAdded = Math.max(0, parseConfigNum(getConfig(KEY_NEW), 0));
  const lastAggregateDebt = parseConfigNum(getConfig(KEY_LAST), NaN);
  const netImprovement = roundMoney(cumulativePaidDown - cumulativeNewDebtAdded);

  let pctPaid = 0;
  if (climbBaselineDebt > 0) {
    pctPaid = Math.min(100, (cumulativePaidDown / climbBaselineDebt) * 100);
  }

  return {
    climbBaselineDebt,
    cumulativePaidDown,
    cumulativeNewDebtAdded,
    lastAggregateDebt,
    netImprovement,
    pctPaid: parseFloat(pctPaid.toFixed(1)),
  };
}

/**
 * Compute momentum streak from snapshot history.
 * Each consecutive snapshot where debt_remaining decreased counts as one streak period.
 * Snapshots must be sorted newest-first (as returned by recentSnapshots).
 *
 * @param {Array<{ debt_remaining: number, pulled_at: string }>} snapshots
 * @returns {{ current: number, best: number, lastBroken: number, lastBrokenAt: string|null }}
 */
function computeStreak(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { current: 0, best: 0, lastBroken: 0, lastBrokenAt: null };
  }

  // Walk from newest to oldest, comparing each pair
  let current = 0;
  let best = 0;
  let lastBrokenAt = null;
  let streakBroken = false;
  let lastBroken = 0;
  let breakIndex = -1;

  for (let i = 0; i < snapshots.length - 1; i++) {
    const newer = Number(snapshots[i].debt_remaining);
    const older = Number(snapshots[i + 1].debt_remaining);
    if (Number.isFinite(newer) && Number.isFinite(older) && newer < older) {
      if (!streakBroken) current++;
      best = Math.max(best, streakBroken ? 0 : current);
    } else {
      if (!streakBroken) {
        lastBroken = current;
        lastBrokenAt = snapshots[i].pulled_at || null;
        breakIndex = i;
      }
      streakBroken = true;
    }
  }

  // If the break happened at i=0 (current was 0), scan forward to find
  // the length of the streak that was just broken.
  if (streakBroken && lastBroken === 0 && breakIndex === 0) {
    let prevStreak = 0;
    for (let j = 1; j < snapshots.length - 1; j++) {
      const newer = Number(snapshots[j].debt_remaining);
      const older = Number(snapshots[j + 1].debt_remaining);
      if (Number.isFinite(newer) && Number.isFinite(older) && newer < older) {
        prevStreak++;
      } else {
        break;
      }
    }
    if (prevStreak > 0) {
      lastBroken = prevStreak;
      lastBrokenAt = snapshots[0].pulled_at || null;
    }
  }

  // Walk entire history for best streak
  let runLen = 0;
  for (let i = 0; i < snapshots.length - 1; i++) {
    const newer = Number(snapshots[i].debt_remaining);
    const older = Number(snapshots[i + 1].debt_remaining);
    if (Number.isFinite(newer) && Number.isFinite(older) && newer < older) {
      runLen++;
      best = Math.max(best, runLen);
    } else {
      runLen = 0;
    }
  }

  return { current, best, lastBroken, lastBrokenAt };
}

module.exports = {
  KEY_BASELINE,
  KEY_PAID,
  KEY_NEW,
  KEY_LAST,
  KEY_MAP_SEEDED,
  applyClimbMetricsOnPull,
  getClimbStatsFromConfig,
  applyDeltaToTotals,
  analyzePerAccountDebtDiff,
  summarizePerAccountDebtDeltas,
  perAccountDebtDeltaDisplayRows,
  getLastDebtSyncDebug,
  setLastDebtSyncDebug,
  clearLastDebtSyncDebug,
  persistLastDebtSyncDebugSnapshot,
  getLastDebtSyncDebugForStatus,
  roundMoney,
  computeStreak,
};
