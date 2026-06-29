'use strict';

/**
 * Persistent cumulative debt climb metrics (separate from tier/stage band math).
 * Updated on each snapshot from **per-account** debt deltas so that
 * removing a liability account is not counted as paydown.
 */

const {
  getConfig,
  setConfig,
  setConfigIfAbsent,
  currentUserId,
  replaceDebtAccountBalances,
  deleteSnapshotById,
  deleteDebtAccountHistoryAt,
  debtAccountHistoryRows,
  exportUserData,
} = require('../db');

const KEY_BASELINE = 'climb_baseline_debt';
const KEY_PAID = 'cumulative_paid_down';
const KEY_NEW = 'cumulative_new_debt_added';
const KEY_INTEREST = 'cumulative_interest_accrued';
const KEY_LAST = 'last_aggregate_debt_for_climb';
const KEY_UNDO = 'climb_undo_stack';
/** How many entries deep "undo last update" can step back. */
const UNDO_MAX = 20;
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

/**
 * Pure: a "corrected" debt-over-time series for the chart, consistent with how
 * the metrics treat corrections. Each account contributes at every pull:
 *   - its balance at that pull (exact), or the most recent earlier balance
 *     (carried forward — e.g. an account you stopped logging still counts), or
 *   - for pulls BEFORE the account first appeared:
 *       · origin 'new'  → 0  (a genuinely-new loan wasn't owed yet → shows as a rise)
 *       · otherwise     → its first-known balance (a debt you always had, just
 *         logged late → carried back so it never reads as back-sliding).
 * Unknown/legacy accounts default to carry-back, matching "it was always yours".
 *
 * @param {Array<{accountId:string,recordedAt:string,balance:number}>} historyRows
 * @param {{originById?:Object<string,string>, gameStartAt?:string}} opts
 * @returns {Array<{date:string, debt:number}>} ascending by date
 */
function buildCorrectedDebtSeries(historyRows, { originById = {}, gameStartAt = null } = {}) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  const byAcct = new Map();   // id → [{ ms, bal }] ascending
  const tsSet = new Set();
  for (const r of rows) {
    if (!r || r.accountId == null || !r.recordedAt) continue;
    const bal = Number(r.balance);
    const ms = Date.parse(r.recordedAt);
    if (!Number.isFinite(bal) || !Number.isFinite(ms)) continue;
    const id = String(r.accountId);
    if (!byAcct.has(id)) byAcct.set(id, []);
    byAcct.get(id).push({ ms, bal });
    tsSet.add(r.recordedAt);
  }
  for (const arr of byAcct.values()) arr.sort((a, b) => a.ms - b.ms);

  const startMs = gameStartAt ? Date.parse(gameStartAt) : NaN;
  // "Current" accounts are those present in the most recent pull. An account
  // whose last record predates that was removed/stopped — it must NOT be carried
  // forward, or the latest total would exceed real current debt (double-count).
  const allMs = [...tsSet].map((ts) => Date.parse(ts)).filter(Number.isFinite);
  const globalLatest = allMs.length ? Math.max(...allMs) : NaN;
  const stamps = [...tsSet]
    .filter((ts) => !Number.isFinite(startMs) || Date.parse(ts) >= startMs)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  return stamps.map((ts) => {
    const T = Date.parse(ts);
    let total = 0;
    for (const [id, arr] of byAcct) {
      const firstMs = arr[0].ms;
      const lastMs = arr[arr.length - 1].ms;
      let val;
      if (T > lastMs) {
        // After the account's final record → it's gone (removed / paid-off and
        // dropped). Not part of debt anymore; contributes nothing.
        val = 0;
      } else if (T >= firstMs) {
        // Within its tracked range → most recent balance at-or-before T.
        val = arr[0].bal;
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].ms <= T) { val = arr[i].bal; break; }
        }
      } else {
        // Before it first appeared. Carry back only if it's a CURRENT account
        // you always had (forgotten-debt fix); a genuinely-new loan stays 0.
        const isCurrent = lastMs === globalLatest;
        val = (isCurrent && originById[id] !== 'new') ? arr[0].bal : 0;
      }
      total += val;
    }
    return { date: ts, debt: Math.round(total * 100) / 100 };
  });
}

/**
 * The corrected debt series reshaped as newest-first snapshot rows
 * ({ pulled_at, debt_remaining }) so the pace/forecast helpers (services/pace.js,
 * services/forecast.js) can consume the SAME correction-aware history the chart
 * uses. Setup-time account additions — forgotten debts the user enters during
 * onboarding — are carried back in the corrected series, so they no longer read
 * as debt *growth* that poisons the payoff projection (the old behavior fit the
 * trend to raw aggregate debt and could push the forecast decades out).
 * Genuinely-new loans (origin 'new') still register as a real rise.
 *
 * @param {Array<{accountId:string,recordedAt:string,balance:number}>} historyRows
 * @param {{originById?:Object<string,string>, gameStartAt?:string}} [opts]
 * @returns {Array<{pulled_at:string, debt_remaining:number}>} newest-first
 */
function correctedDebtSnapshots(historyRows, opts = {}) {
  const series = buildCorrectedDebtSeries(historyRows, opts);
  const out = series.map((p) => ({ pulled_at: p.date, debt_remaining: p.debt }));
  out.reverse(); // buildCorrectedDebtSeries is ascending; snapshots are newest-first
  return out;
}

function safeParseObject(raw) {
  if (raw == null || raw === '') return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * Correction-aware, newest-first snapshots for the CURRENT user — the input the
 * pace and Monte-Carlo forecast should read so they agree with the chart and the
 * climb line. Reads per-account history + the stored origin map and scopes to the
 * climb window (gameStartAt). Falls back to `fallback` (the raw aggregate
 * snapshots) for legacy users who have no per-account history yet, so nothing
 * regresses for them.
 *
 * @param {{ gameStartAt?:string|null, fallback?:Array }} [opts]
 * @returns {Array<{pulled_at:string, debt_remaining:number}>} newest-first
 */
function recentCorrectedSnapshots({ gameStartAt = null, fallback = [] } = {}) {
  const rows = debtAccountHistoryRows();
  const originById = safeParseObject(getConfig('debt_account_origin'));
  const snaps = correctedDebtSnapshots(rows, { originById, gameStartAt });
  return snaps.length >= 2 ? snaps : (Array.isArray(fallback) ? fallback : []);
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
      const kind =
        delta < 0 && currBal === 0
          ? 'paid_off'
          : delta < 0
            ? 'decreased'
            : 'increased';
      rows.push({ name: nameById.get(id) || 'Account', delta, kind });
    }
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return rows;
}

/**
 * Categories a balance INCREASE (or a brand-new account) can be classified as.
 * Each routes the dollars to a different bucket:
 *   - purchase / new_loan / (default) → counts as new debt added (works against)
 *   - interest                         → tracked separately, never penalizes net
 *   - preexisting                      → folded into the starting baseline
 */
function classifyBucket(category) {
  if (category === 'interest') return 'interest';
  if (category === 'preexisting') return 'preexisting';
  return 'new'; // purchase, new_loan, anything unrecognized
}

/**
 * Split this pull's positive deltas (existing-account increases + new accounts)
 * into buckets by the per-account classifications the client supplied. Decreases
 * are always paydown; removals never count. Returns dollar sums.
 *
 * @param {Map<string, number>} prev
 * @param {Map<string, number>} curr
 * @param {Object<string,string>} classifications  accountId → category
 */
function routeDeltasByClassification(prev, curr, classifications) {
  const p = prev instanceof Map ? prev : new Map();
  const c = curr instanceof Map ? curr : new Map();
  const cls = classifications && typeof classifications === 'object' ? classifications : {};
  let paydownSum = 0;
  let newDebtSum = 0;
  let interestSum = 0;
  let baselineBump = 0;

  const routeIncrease = (id, amt) => {
    const bucket = classifyBucket(cls[String(id)]);
    if (bucket === 'interest') interestSum = roundMoney(interestSum + amt);
    else if (bucket === 'preexisting') baselineBump = roundMoney(baselineBump + amt);
    else newDebtSum = roundMoney(newDebtSum + amt);
  };

  for (const [id, prevBal] of p) {
    if (!c.has(id)) continue; // removed → no effect
    const delta = roundMoney(c.get(id) - prevBal);
    if (delta < 0) paydownSum = roundMoney(paydownSum + Math.abs(delta));
    else if (delta > 0) routeIncrease(id, delta);
  }
  for (const [id, currBal] of c) {
    if (!p.has(id) && currBal > 0) routeIncrease(id, currBal);
  }
  return { paydownSum, newDebtSum, interestSum, baselineBump };
}

/** Add `amount` to the climb baseline and the game-start debt (forgot-a-debt). */
function bumpBaselineAndStart(amount) {
  const bump = roundMoney(amount);
  if (!Number.isFinite(bump) || bump <= 0) return;
  const baseline = parseConfigNum(getConfig(KEY_BASELINE), 0);
  setConfig(KEY_BASELINE, String(roundMoney(baseline + bump)));
  const start = getConfig('game_start_debt');
  if (start != null && start !== '') {
    setConfig('game_start_debt', String(roundMoney(parseConfigNum(start, 0) + bump)));
  }
}

/**
 * Retroactively reclassify dollars already counted as "new debt added" — the fix
 * for debt the user forgot to enter at the start (or interest that was wrongly
 * counted as new spending). Moves up to the available amount out of the new-debt
 * bucket into either the baseline ('preexisting') or the interest bucket.
 *
 * @returns {{ moved: number, kind: string }}
 */
function reclassifyAddedDebt(amount, kind) {
  const requested = roundMoney(amount);
  const newD = Math.max(0, parseConfigNum(getConfig(KEY_NEW), 0));
  const moved = roundMoney(Math.min(Math.max(0, requested), newD));
  if (moved <= 0) return { moved: 0, kind };
  setConfig(KEY_NEW, String(roundMoney(newD - moved)));
  if (kind === 'interest') {
    const interest = Math.max(0, parseConfigNum(getConfig(KEY_INTEREST), 0));
    setConfig(KEY_INTEREST, String(roundMoney(interest + moved)));
  } else {
    // 'preexisting' (default): it was always part of the debt → fold into baseline.
    bumpBaselineAndStart(moved);
  }
  return { moved, kind: kind === 'interest' ? 'interest' : 'preexisting' };
}

/**
 * Pure: rebuild cumulative paid-down / new-debt by replaying the per-account
 * balance history from the game-start anchor forward. Every consecutive pull is
 * diffed: decreases on an existing account are paydown, increases (and a new
 * account's first balance) are new debt, removed accounts count for nothing —
 * the same rules as a live pull. Repair-of-last-resort: it CANNOT reconstruct
 * interest/forgot classifications, so every increase reads as new debt.
 *
 * @param {Array<{accountId:string,recordedAt:string,balance:number}>} historyRows
 * @param {string} gameStartAt  ISO timestamp the baseline was locked at
 */
function recomputeTotalsFromHistory(historyRows, gameStartAt) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  // Group into one balance map per pull (rows of a pull share recordedAt).
  const byTs = new Map();
  for (const r of rows) {
    if (!r || r.accountId == null || !r.recordedAt) continue;
    const bal = Number(r.balance);
    if (!Number.isFinite(bal)) continue;
    if (!byTs.has(r.recordedAt)) byTs.set(r.recordedAt, new Map());
    byTs.get(r.recordedAt).set(String(r.accountId), roundMoney(bal));
  }
  const stamps = [...byTs.keys()].sort((a, b) => {
    const ta = Date.parse(a); const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (stamps.length === 0) return { cumulativePaidDown: 0, cumulativeNewDebtAdded: 0, pullsReplayed: 0, anchorAt: null };

  // Anchor = the pull as of game start (latest stamp <= gameStartAt), else the
  // earliest pull. Deltas are counted from the anchor onward.
  const startMs = Date.parse(gameStartAt);
  let anchorIdx = 0;
  if (Number.isFinite(startMs)) {
    for (let i = 0; i < stamps.length; i++) {
      if (Date.parse(stamps[i]) <= startMs) anchorIdx = i; else break;
    }
  }

  let paid = 0;
  let added = 0;
  let pulls = 0;
  for (let i = anchorIdx + 1; i < stamps.length; i++) {
    const diff = analyzePerAccountDebtDiff(byTs.get(stamps[i - 1]), byTs.get(stamps[i]));
    paid = roundMoney(paid + diff.paydownSum);
    added = roundMoney(added + diff.newDebtSum);
    pulls += 1;
  }
  return { cumulativePaidDown: paid, cumulativeNewDebtAdded: added, pullsReplayed: pulls, anchorAt: stamps[anchorIdx] };
}

/**
 * Recompute the stored paid/new totals from balance history. Dry-run by default
 * (returns { before, after } without writing). With { apply: true } it writes
 * the rebuilt paid + new and zeroes the interest bucket (classifications can't
 * be reconstructed). Baseline is left untouched.
 */
function recomputeClimbTotalsFromHistory({ apply = false } = {}) {
  const history = exportUserData().debtAccountHistory || [];
  const gameStartAt = getConfig('game_start_at');
  const result = recomputeTotalsFromHistory(history, gameStartAt);
  const before = {
    cumulativePaidDown: Math.max(0, parseConfigNum(getConfig(KEY_PAID), 0)),
    cumulativeNewDebtAdded: Math.max(0, parseConfigNum(getConfig(KEY_NEW), 0)),
    cumulativeInterestAccrued: Math.max(0, parseConfigNum(getConfig(KEY_INTEREST), 0)),
  };
  const after = {
    cumulativePaidDown: result.cumulativePaidDown,
    cumulativeNewDebtAdded: result.cumulativeNewDebtAdded,
    cumulativeInterestAccrued: 0,
  };
  // Data-loss guard: when there is NO usable balance history (anchorAt == null),
  // the recompute is all-zeros. Applying that would irreversibly wipe real
  // cumulative totals that came from pulls whose history is gone (reset/pruned).
  // Refuse to apply in that case if there is anything to lose; a fresh user with
  // zero totals is unaffected. (A single-pull history HAS an anchor, so the
  // legitimate "no deltas → 0" recompute still applies.)
  const hasTotalsToLose =
    before.cumulativePaidDown > 0 ||
    before.cumulativeNewDebtAdded > 0 ||
    before.cumulativeInterestAccrued > 0;
  if (apply && result.anchorAt == null && hasTotalsToLose) {
    return {
      applied: false,
      refused: 'no_history',
      reason: 'No usable balance history to recompute from; refusing to zero existing totals.',
      anchorAt: result.anchorAt,
      pullsReplayed: result.pullsReplayed,
      before,
      after,
    };
  }
  if (apply) {
    setConfig(KEY_PAID, String(after.cumulativePaidDown));
    setConfig(KEY_NEW, String(after.cumulativeNewDebtAdded));
    setConfig(KEY_INTEREST, '0');
  }
  return { applied: !!apply, anchorAt: result.anchorAt, pullsReplayed: result.pullsReplayed, before, after };
}

// ── Undo stack ───────────────────────────────────────────────────────────────
// Before a pull mutates the cumulative metrics we snapshot the pre-pull state so
// a mis-typed balance can be reversed exactly — not papered over with a fake
// compensating payment (which would inflate both "paid down" and "new debt").

function readUndoStack() {
  const raw = getConfig(KEY_UNDO);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function mapToObj(map) {
  const o = {};
  if (map instanceof Map) for (const [k, v] of map) o[String(k)] = roundMoney(v);
  return o;
}

/**
 * Snapshot the current (pre-pull) cumulative state and balances onto the undo
 * stack. Call this *before* applyClimbMetricsOnPull / replaceDebtAccountBalances.
 *
 * @param {number|null} snapshotId  id of the snapshots row this pull inserted
 * @param {Map<string,number>} prevBalances  per-account balances before the pull
 * @param {string} [label]  what kind of action this entry reverses ('update' |
 *        'correction'), surfaced so the UI can describe the undo accurately
 */
function captureUndoState(snapshotId, prevBalances, label = 'update', appendedAt = null) {
  const entry = {
    ts: new Date().toISOString(),
    snapshotId: snapshotId == null ? null : Number(snapshotId),
    label: typeof label === 'string' ? label : 'update',
    // Exact recorded_at of the history rows this pull appended, so undo can delete
    // precisely those rows (null for aggregate pulls / corrections that append none).
    appendedAt: appendedAt == null ? null : String(appendedAt),
    prev: {
      paid: getConfig(KEY_PAID),
      newD: getConfig(KEY_NEW),
      interest: getConfig(KEY_INTEREST),
      last: getConfig(KEY_LAST),
      baseline: getConfig(KEY_BASELINE),
      gameStart: getConfig('game_start_debt'),
    },
    balances: mapToObj(prevBalances),
  };
  const stack = readUndoStack();
  stack.push(entry);
  while (stack.length > UNDO_MAX) stack.shift();
  setConfig(KEY_UNDO, JSON.stringify(stack));
}

/** Whether there is anything to undo (drives the UI control's visibility). */
function hasUndoState() {
  return readUndoStack().length > 0;
}

/** Label of the action the next undo would reverse ('update'|'correction'), or null. */
function peekUndoLabel() {
  const stack = readUndoStack();
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  return top && typeof top.label === 'string' ? top.label : 'update';
}

function restoreConfigValue(key, value) {
  // null/undefined means the key was absent before the pull → leave it cleared
  // by writing an empty string (parseConfigNum treats '' as the fallback).
  setConfig(key, value == null ? '' : String(value));
}

/**
 * Reverse the most recent pull: restore the saved cumulative totals + per-account
 * balances and delete that pull's snapshot row. Returns what happened so the API
 * can report it. Idempotent-safe: returns { undone: false } when nothing remains.
 */
function undoLastPull() {
  const stack = readUndoStack();
  if (stack.length === 0) return { undone: false };
  const entry = stack.pop();
  const prev = entry && entry.prev ? entry.prev : {};

  restoreConfigValue(KEY_PAID, prev.paid);
  restoreConfigValue(KEY_NEW, prev.newD);
  restoreConfigValue(KEY_INTEREST, prev.interest);
  restoreConfigValue(KEY_LAST, prev.last);
  restoreConfigValue(KEY_BASELINE, prev.baseline);
  restoreConfigValue('game_start_debt', prev.gameStart);

  const restored = new Map();
  if (entry && entry.balances && typeof entry.balances === 'object') {
    for (const [id, bal] of Object.entries(entry.balances)) {
      const n = Number(bal);
      if (Number.isFinite(n) && n >= 0) restored.set(String(id), roundMoney(n));
    }
  }
  replaceDebtAccountBalances(restored);

  let snapshotDeleted = 0;
  if (entry && entry.snapshotId != null) {
    snapshotDeleted = deleteSnapshotById(entry.snapshotId);
  }

  // Remove the per-account history rows this pull appended, or a later recompute /
  // the corrected-debt chart would replay the reversed (often mistyped) balance.
  let historyDeleted = 0;
  if (entry && entry.appendedAt) {
    historyDeleted = deleteDebtAccountHistoryAt(entry.appendedAt);
  }

  // The "This Turn" panel (and its per-account +/- lines and net direction) is
  // driven by a SEPARATELY persisted debt-sync debug snapshot, not the climb
  // totals. Clear it too, or the reverted pull's deltas keep showing and undo
  // looks like it did nothing.
  clearLastDebtSyncDebug();
  setConfig(KEY_LAST_DEBT_SYNC_SNAPSHOT, '');

  setConfig(KEY_UNDO, JSON.stringify(stack));
  return {
    undone: true,
    snapshotDeleted,
    historyDeleted,
    remaining: stack.length,
    restoredAt: entry ? entry.ts : null,
  };
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
 * @param {Object<string,string>} [classifications]  accountId → category for this
 *        pull's increases/new accounts: 'purchase' | 'new_loan' | 'interest' |
 *        'preexisting'. Omitted/unknown → treated as new debt (legacy behavior).
 * @returns {object} climbAction, analysis, map_seeded_before, aggregate_debt_remaining
 */
function applyClimbMetricsOnPull(debtRemaining, previousByAccountId, currentByAccountId, classifications = {}) {
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
      // Honor this pull's per-account classifications during the aggregate→
      // per-account handoff instead of dumping the whole increase into new debt.
      // prev is empty, so route the current balances by classification, then split
      // the ACTUAL aggregate increase across the buckets in proportion — so the
      // interest/preexisting tags are respected and the totals still reconcile.
      // With no classifications everything routes to new debt (identical to before).
      const routed = routeDeltasByClassification(new Map(), curr, classifications);
      const routedTotal = roundMoney(routed.newDebtSum + routed.interestSum + routed.baselineBump);
      if (routedTotal > 0) {
        const f = aggregateDelta / routedTotal;
        const newPart = roundMoney(routed.newDebtSum * f);
        const interestPart = roundMoney(routed.interestSum * f);
        const baselinePart = roundMoney(routed.baselineBump * f);
        if (newPart > 0) setConfig(KEY_NEW, String(roundMoney(newD + newPart)));
        if (interestPart > 0) {
          const interest = parseConfigNum(getConfig(KEY_INTEREST), 0);
          setConfig(KEY_INTEREST, String(roundMoney(interest + interestPart)));
        }
        if (baselinePart > 0) bumpBaselineAndStart(baselinePart);
      } else {
        setConfig(KEY_NEW, String(roundMoney(newD + aggregateDelta)));
      }
    }
    setConfig(KEY_LAST, String(debt));
    return {
      ...baseReturn,
      climbAction: 'account_map_handoff',
      aggregate_debt_remaining: debt,
    };
  }

  // Route this pull's increases by their per-account classification: purchases
  // and new loans count as new debt, interest goes to its own bucket, and debt
  // the user only now remembered ('preexisting') folds into the baseline so it
  // never reads as back-sliding. With no classifications every increase is new
  // debt — identical to the original behavior.
  const routed = routeDeltasByClassification(prev, curr, classifications);
  const paid = parseConfigNum(getConfig(KEY_PAID), 0);
  const newD = parseConfigNum(getConfig(KEY_NEW), 0);
  setConfig(KEY_PAID, String(roundMoney(paid + routed.paydownSum)));
  setConfig(KEY_NEW, String(roundMoney(newD + routed.newDebtSum)));
  if (routed.interestSum > 0) {
    const interest = parseConfigNum(getConfig(KEY_INTEREST), 0);
    setConfig(KEY_INTEREST, String(roundMoney(interest + routed.interestSum)));
  }
  if (routed.baselineBump > 0) bumpBaselineAndStart(routed.baselineBump);
  setConfig(KEY_LAST, String(debt));
  return {
    ...baseReturn,
    climbAction: 'deltas_applied',
    aggregate_debt_remaining: debt,
    routed,
  };
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
  const cumulativeInterestAccrued = Math.max(0, parseConfigNum(getConfig(KEY_INTEREST), 0));
  const lastAggregateDebt = parseConfigNum(getConfig(KEY_LAST), NaN);
  // Net improvement deliberately excludes interest: it measures progress from
  // the user's own actions (payments minus new spending/loans), not the cost of
  // carrying the debt, which is tracked separately.
  const netImprovement = roundMoney(cumulativePaidDown - cumulativeNewDebtAdded);

  let pctPaid = 0;
  if (climbBaselineDebt > 0) {
    pctPaid = Math.min(100, (cumulativePaidDown / climbBaselineDebt) * 100);
  }

  return {
    climbBaselineDebt,
    cumulativePaidDown,
    cumulativeNewDebtAdded,
    cumulativeInterestAccrued,
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
 * @returns {{ current: number, best: number, previousStreakLength: number, previousStreakEndedAt: string|null, lastBroken: number, lastBrokenAt: string|null }}
 *
 * Note: `previousStreakLength` / `previousStreakEndedAt` are the canonical names.
 * `lastBroken` / `lastBrokenAt` are deprecated aliases kept for compatibility
 * with older clients — they refer to the *prior* streak's length, not the
 * current one.
 */
function computeStreak(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      current: 0,
      best: 0,
      previousStreakLength: 0,
      previousStreakEndedAt: null,
      lastBroken: 0,
      lastBrokenAt: null,
    };
  }

  const decreased = (i) => {
    const newer = Number(snapshots[i].debt_remaining);
    const older = Number(snapshots[i + 1].debt_remaining);
    return Number.isFinite(newer) && Number.isFinite(older) && newer < older;
  };

  // Current streak: consecutive decreases from the newest snapshot, until the
  // first break. breakIndex marks that break (-1 if the whole history decreases).
  let current = 0;
  let breakIndex = -1;
  for (let i = 0; i < snapshots.length - 1; i++) {
    if (decreased(i)) {
      current++;
    } else {
      breakIndex = i;
      break;
    }
  }

  // Previous streak: the next run of decreases AFTER the break (older in time).
  // This is independent of `current` — the old code mistakenly reported the
  // current streak's length here whenever the break wasn't at index 0.
  let previousStreakLength = 0;
  let previousStreakEndedAt = null;
  if (breakIndex !== -1) {
    previousStreakEndedAt = snapshots[breakIndex].pulled_at || null;
    for (let j = breakIndex + 1; j < snapshots.length - 1; j++) {
      if (decreased(j)) previousStreakLength++;
      else break;
    }
  }

  // Best streak: longest run of decreases anywhere in history.
  let best = 0;
  let runLen = 0;
  for (let i = 0; i < snapshots.length - 1; i++) {
    if (decreased(i)) {
      runLen++;
      best = Math.max(best, runLen);
    } else {
      runLen = 0;
    }
  }

  return {
    current,
    best,
    previousStreakLength,
    previousStreakEndedAt,
    lastBroken: previousStreakLength,    // deprecated alias
    lastBrokenAt: previousStreakEndedAt, // deprecated alias
  };
}

module.exports = {
  KEY_BASELINE,
  KEY_PAID,
  KEY_NEW,
  KEY_INTEREST,
  KEY_LAST,
  KEY_UNDO,
  KEY_MAP_SEEDED,
  applyClimbMetricsOnPull,
  getClimbStatsFromConfig,
  reclassifyAddedDebt,
  recomputeTotalsFromHistory,
  recomputeClimbTotalsFromHistory,
  captureUndoState,
  undoLastPull,
  hasUndoState,
  peekUndoLabel,
  routeDeltasByClassification,
  applyDeltaToTotals,
  analyzePerAccountDebtDiff,
  buildCorrectedDebtSeries,
  correctedDebtSnapshots,
  recentCorrectedSnapshots,
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
