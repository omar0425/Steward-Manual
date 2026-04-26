'use strict';

/**
 * Validates that persisted per-account debt magnitudes stay aligned with YNAB
 * and with the aggregate debt figure from the same pull (parseAccounts total).
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
 * @param {Map<string, number>} p.ynabDebtByAccountId  debtBalanceMapFromAccounts(accounts).
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateDebtSyncState({ aggregateDebtRemaining, storedDebtByAccountId, ynabDebtByAccountId }) {
  const errors = [];
  const stored =
    storedDebtByAccountId instanceof Map ? storedDebtByAccountId : new Map(Object.entries(storedDebtByAccountId || {}));
  const ynab =
    ynabDebtByAccountId instanceof Map ? ynabDebtByAccountId : new Map(Object.entries(ynabDebtByAccountId || {}));

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

  for (const [id, bal] of ynab) {
    const b = Number(bal);
    if (!Number.isFinite(b)) {
      errors.push(`YNAB balance for ${id} is not finite: ${bal}`);
    } else if (b < 0) {
      errors.push(`YNAB balance for ${id} is negative (expected debt magnitude ≥ 0): ${b}`);
    }
  }

  const ynabIds = [...ynab.keys()].sort();
  const storedIds = [...stored.keys()].sort();

  for (const id of ynabIds) {
    if (!stored.has(id)) {
      errors.push(`missing account: YNAB debt account ${id} is not in the stored map`);
    }
  }
  for (const id of storedIds) {
    if (!ynab.has(id)) {
      errors.push(`ghost account: stored id ${id} is not in the YNAB debt map`);
    }
  }

  for (const id of ynabIds) {
    if (!stored.has(id)) continue;
    const sb = roundMoney(Number(stored.get(id)));
    const yb = roundMoney(Number(ynab.get(id)));
    if (Math.abs(sb - yb) > 0.001) {
      errors.push(`balance mismatch for ${id}: stored $${sb} vs YNAB $${yb}`);
    }
  }

  const sumStored = sumMapValues(stored);
  const tol = aggregateSumTolerance(Math.max(stored.size, ynab.size));
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
