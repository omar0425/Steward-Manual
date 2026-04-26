'use strict';

/**
 * Validates that persisted per-account debt magnitudes stay aligned with the
 * latest snapshot and with the aggregate debt figure.
 */

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Max |aggregate − Σ per-account rounded| when each account uses cent rounding. */
function aggregateSumTolerance(accountCount) {
  const n = Math.max(0, accountCount);
  return roundMoney(0.005 * Math.max(n, 1) + 0.01);
}

function sumMapValues(m) {
  let t = 0;
  for (const v of m.values()) {
    t += Number(v);
  }
  return roundMoney(t);
}

/**
 * @param {object} p
 * @param {number} p.aggregateDebtRemaining  Same as pull snapshot / parseAccounts total debt.
 * @param {Map<string, number>} p.storedDebtByAccountId  After replaceDebtAccountBalances + read.
 * @param {Map<string, number>} p.currentDebtByAccountId  debtBalanceMap from latest snapshot.
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateDebtSyncState({ aggregateDebtRemaining, storedDebtByAccountId, currentDebtByAccountId, ynabDebtByAccountId }) {
  const errors = [];
  const stored =
    storedDebtByAccountId instanceof Map ? storedDebtByAccountId : new Map(Object.entries(storedDebtByAccountId || {}));
  const current =
    (currentDebtByAccountId || ynabDebtByAccountId) instanceof Map
      ? (currentDebtByAccountId || ynabDebtByAccountId)
      : new Map(Object.entries((currentDebtByAccountId || ynabDebtByAccountId) || {}));

  const agg = roundMoney(Number(aggregateDebtRemaining));
  if (!Number.isFinite(Number(aggregateDebtRemaining))) {
    errors.push(`aggregate_debt_remaining is not a finite number: ${aggregateDebtRemaining}`);
  } else if (agg < 0) {
    errors.push(`aggregate_debt_remaining is negative: ${agg}`);
  }

  for (const [id, bal] of stored) {
    const b = Number(bal);
    if (!Number.isFinite(b)) {
      errors.push(`stored balance for ${id} is not finite: ${bal}`);
    } else if (b < 0) {
      errors.push(`stored balance for ${id} is negative (expected debt magnitude ≥ 0): ${b}`);
    }
  }

  for (const [id, bal] of current) {
    const b = Number(bal);
    if (!Number.isFinite(b)) {
      errors.push(`balance for ${id} is not finite: ${bal}`);
    } else if (b < 0) {
      errors.push(`balance for ${id} is negative (expected debt magnitude ≥ 0): ${b}`);
    }
  }

  const currentIds = [...current.keys()].sort();
  const storedIds = [...stored.keys()].sort();

  for (const id of currentIds) {
    if (!stored.has(id)) {
      errors.push(`missing account: debt account ${id} is not in the stored map`);
    }
  }
  for (const id of storedIds) {
    if (!current.has(id)) {
      errors.push(`ghost account: stored id ${id} is not in the current debt map`);
    }
  }

  for (const id of currentIds) {
    if (!stored.has(id)) continue;
    const sb = roundMoney(Number(stored.get(id)));
    const cb = roundMoney(Number(current.get(id)));
    if (Math.abs(sb - cb) > 0.001) {
      errors.push(`balance mismatch for ${id}: stored $${sb} vs current $${cb}`);
    }
  }

  const sumStored = sumMapValues(stored);
  const tol = aggregateSumTolerance(Math.max(stored.size, current.size));
  if (Number.isFinite(agg) && Math.abs(sumStored - agg) > tol) {
    errors.push(
      `sum of stored balances (${sumStored}) does not match aggregate debt (${agg}); tolerance ±${tol}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateDebtSyncState,
  aggregateSumTolerance,
  sumMapValues,
};
