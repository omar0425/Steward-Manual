'use strict';

/**
 * Deterministic ledger sanity rules, run after every successful snapshot save.
 * Zero AI cost — plain arithmetic over the user's stored aggregates. These
 * catch the silent class of bug: numbers that render fine but have drifted
 * from what the ledger says they must be. Violations become admin bug reports
 * (kind 'invariant'); nothing here is ever shown to the user.
 *
 * Every rule is conservative on purpose: a false alarm in the admin panel is
 * cheap, but a rule that fires on a legitimate flow (undo, restore, verify,
 * reclassification) would cry wolf on every save. Tolerances absorb rounding;
 * checks that need state a fresh climb doesn't have yet skip silently.
 *
 * Reports must not carry user balances — drift MAGNITUDES are included
 * (they're the diagnostic), raw account figures are not.
 *
 * Must run inside withUser().
 */

const { getConfig, getGameStart, rawDebtBalances } = require('../db');
const { getClimbStatsFromConfig, roundMoney } = require('./climbMetrics');

// Same config keys climbMetrics maintains — read raw here because
// getClimbStatsFromConfig() clamps negatives away, and a negative counter is
// exactly the corruption we want to see.
const RAW_COUNTER_KEYS = ['cumulative_paid_down', 'cumulative_new_debt_added', 'cumulative_interest_accrued'];

const AGGREGATE_TOLERANCE = 1;       // dollars; stored sum vs stored aggregate
const IDENTITY_TOLERANCE_MIN = 5;    // dollars; ledger-identity drift floor
const IDENTITY_TOLERANCE_PCT = 0.005; // …or 0.5% of the baseline, whichever is larger

/**
 * Returns violations: [{ rule, severity, title, report }]. Empty array when
 * everything checks out (or when there is nothing to check yet).
 */
function checkLedgerInvariants() {
  const violations = [];
  const { gameStartDebt } = getGameStart();
  if (gameStartDebt == null) return violations; // setup mode — no ledger yet

  // 1. Stored balances must be finite and non-negative. The read helpers
  // filter such rows out, so a bad row silently vanishes from the dashboard —
  // this is the only place it becomes visible.
  const rows = rawDebtBalances();
  const badRows = rows.filter((r) => !Number.isFinite(Number(r.balance)) || Number(r.balance) < 0);
  if (badRows.length > 0) {
    violations.push({
      rule: 'negative_balance',
      severity: 'high',
      title: 'Invariant: stored account balance is negative or not a number',
      report: `${badRows.length} of ${rows.length} stored debt balances are negative or non-finite. `
        + 'These rows are silently hidden from the dashboard, so the user sees totals that no longer '
        + 'include them. Check debt_account_balances and the last write path that touched it.',
    });
  }

  // 2. The per-account sum and the stored aggregate are written in the same
  // transaction from the same data — divergence means a write path skipped one.
  const lastAggregate = Number(getConfig('last_aggregate_debt_for_climb'));
  if (Number.isFinite(lastAggregate) && badRows.length === 0) {
    const sum = roundMoney(rows.reduce((a, r) => a + Number(r.balance), 0));
    const gap = Math.abs(sum - lastAggregate);
    if (gap > AGGREGATE_TOLERANCE) {
      violations.push({
        rule: 'aggregate_mismatch',
        severity: 'high',
        title: 'Invariant: account sum no longer matches the stored total',
        report: `The per-account balances sum to a different figure than the stored aggregate `
          + `(gap ≈ $${Math.round(gap)}). Both are written in the same transaction, so one write `
          + 'path updated accounts without the aggregate (or vice versa) — undo and restore are '
          + 'the usual suspects.',
      });
    }
  }

  // 3. Cumulative counters must be finite and non-negative in their RAW form.
  for (const key of RAW_COUNTER_KEYS) {
    const raw = getConfig(key);
    if (raw == null) continue; // never written yet — fine on a fresh climb
    const n = Number(raw);
    if (!Number.isFinite(n) || n < -0.01) {
      violations.push({
        rule: `counter_corrupt:${key}`,
        severity: 'high',
        title: `Invariant: ${key} is ${Number.isFinite(n) ? 'negative' : 'not a number'}`,
        report: `The ${key} config counter holds an invalid value. The dashboard clamps it to zero `
          + 'so the user just sees a wrong (flattered or understated) progress figure with no error. '
          + 'Check reclassification and undo paths in climbMetrics.',
      });
    }
  }

  // 4. The ledger identity: baseline + everything added (spending + interest)
  // minus everything paid must land on the current total. Every legitimate
  // flow preserves it (paydowns, increases, interest reclassification moves
  // between counters, "preexisting" moves baseline and counter together), so
  // sustained drift beyond rounding means some path updated one side only.
  const stats = getClimbStatsFromConfig();
  if (
    Number.isFinite(lastAggregate)
    && Number.isFinite(stats.climbBaselineDebt)
    && stats.climbBaselineDebt > 0
  ) {
    const expected = roundMoney(
      stats.climbBaselineDebt + stats.cumulativeNewDebtAdded + stats.cumulativeInterestAccrued
      - stats.cumulativePaidDown,
    );
    const drift = Math.abs(expected - lastAggregate);
    const tolerance = Math.max(IDENTITY_TOLERANCE_MIN, stats.climbBaselineDebt * IDENTITY_TOLERANCE_PCT);
    if (drift > tolerance) {
      violations.push({
        rule: 'ledger_drift',
        severity: 'medium',
        title: 'Invariant: climb counters have drifted from the actual total',
        report: `baseline + added + interest − paid no longer reproduces the current total `
          + `(drift ≈ $${Math.round(drift)}). The user's progress figures (paid down, % climbed) are `
          + 'quietly wrong by about that much. Can be a false alarm right after a restore from an '
          + 'old export; if it recurs on normal saves it is real — audit the counter updates in '
          + 'saveSnapshotForUser and climbMetrics.',
      });
    }
  }

  return violations;
}

module.exports = { checkLedgerInvariants };
