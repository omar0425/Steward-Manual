'use strict';

/**
 * Integration-style tests for climb apply + SQLite (isolated DB file).
 * Filename `zzz-` so Node’s default test file ordering runs this after other suites.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `steward-climb-apply-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;

delete require.cache[require.resolve('../db')];
delete require.cache[require.resolve('../services/climbMetrics')];

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyClimbMetricsOnPull,
  reclassifyAddedDebt,
  getClimbStatsFromConfig,
  captureUndoState,
  undoLastPull,
  hasUndoState,
  KEY_MAP_SEEDED,
  KEY_BASELINE,
  KEY_PAID,
  KEY_NEW,
  KEY_INTEREST,
  KEY_LAST,
} = require('../services/climbMetrics');
const {
  appendDebtAccountHistory,
  getAllDebtAccountBalances,
  getConfig,
  getDebtAccountHistory,
  insertSnapshot,
  recentSnapshots,
  replaceDebtAccountBalances,
  resetAllGameState,
  setConfig,
  withUser,
} = require('../db');

test.after(() => {
  try {
    fs.unlinkSync(tmpDb);
  } catch (_) {
    /* ignore */
  }
  try {
    fs.unlinkSync(`${tmpDb}-wal`);
  } catch (_) {
    /* ignore */
  }
  try {
    fs.unlinkSync(`${tmpDb}-shm`);
  } catch (_) {
    /* ignore */
  }
});

function seedClimbBaseline(aggregateDebt) {
  setConfig(KEY_BASELINE, String(aggregateDebt));
  setConfig(KEY_PAID, '0');
  setConfig(KEY_NEW, '0');
  setConfig(KEY_LAST, String(aggregateDebt));
}

test('anchor pull applies no cumulative delta even if analysis shows paydown', () => {
  withUser(0, () => {
    seedClimbBaseline(10000);
    setConfig(KEY_MAP_SEEDED, '0');
    replaceDebtAccountBalances(new Map([['a', 10000]]));
    const prev = new Map([['a', 10000]]);
    const curr = new Map([['a', 9000]]);
    const r = applyClimbMetricsOnPull(9000, prev, curr);
    assert.equal(r.climbAction, 'anchor_no_delta');
    assert.equal(getConfig(KEY_PAID), '0');
    assert.ok(r.analysis.paydownSum >= 1000);
  });
});

test('after seeded, payment on one account updates cumulative paid', () => {
  withUser(0, () => {
    seedClimbBaseline(9000);
    setConfig(KEY_MAP_SEEDED, '1');
    setConfig(KEY_LAST, '9000');
    replaceDebtAccountBalances(new Map([['a', 9000]]));
    const prev = new Map([['a', 9000]]);
    const curr = new Map([['a', 8000]]);
    const r = applyClimbMetricsOnPull(8000, prev, curr);
    assert.equal(r.climbAction, 'deltas_applied');
    assert.equal(getConfig(KEY_PAID), '1000');
  });
});

test('resetAllGameState clears database-backed game history but keeps preferences', () => {
  withUser(0, () => {
    insertSnapshot({
      source: 'ynab',
      pulled_at: '2026-04-26T12:00:00.000Z',
      net_worth: 1000,
      total_assets: 2000,
      total_debt: 1000,
      investment_value: 0,
      debt_remaining: 1000,
      months_ahead: 1,
      monthly_income: 5000,
      monthly_expenses: 3000,
      tier: 'Base Camp',
      safety_liquid: 1500,
    });
    replaceDebtAccountBalances(new Map([['card-a', 1000]]));
    appendDebtAccountHistory(new Map([['card-a', 1000]]));
    setConfig('game_start_debt', '1000');
    setConfig('cumulative_paid_down', '25');
    setConfig('notifications_sent', 'yes');
    setConfig('interest_rates', '{"card-a":19.99}');

    resetAllGameState();

    assert.equal(recentSnapshots().length, 0);
    assert.equal(getAllDebtAccountBalances().size, 0);
    assert.equal(Object.keys(getDebtAccountHistory()).length, 0);
    assert.equal(getConfig('game_start_debt'), null);
    assert.equal(getConfig('cumulative_paid_down'), null);
    assert.equal(getConfig('notifications_sent'), null);
    assert.equal(getConfig('interest_rates'), '{"card-a":19.99}');
  });
});

test('seeded pull with all debt accounts gone — no paydown bump', () => {
  withUser(0, () => {
    seedClimbBaseline(5000);
    setConfig(KEY_MAP_SEEDED, '1');
    setConfig(KEY_LAST, '5000');
    const prev = new Map([['only', 5000]]);
    const curr = new Map();
    const r = applyClimbMetricsOnPull(0, prev, curr);
    assert.equal(r.climbAction, 'deltas_applied');
    assert.equal(r.analysis.accountsRemovedCount, 1);
    assert.equal(r.analysis.paydownSum, 0);
    assert.equal(getConfig(KEY_PAID), '0');
  });
});

test('mixed pull: payment on one account + removed other — only payment counts', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '12000');
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '0');
    setConfig(KEY_LAST, '12000');
    setConfig(KEY_MAP_SEEDED, '1');
    const prev = new Map([
      ['gone', 10000],
      ['stay', 2000],
    ]);
    const curr = new Map([['stay', 1000]]);
    const r = applyClimbMetricsOnPull(1000, prev, curr);
    assert.equal(r.climbAction, 'deltas_applied');
    assert.equal(r.analysis.accountsRemovedCount, 1);
    assert.equal(r.analysis.accountsDecreasedCount, 1);
    assert.equal(getConfig(KEY_PAID), '1000');
    assert.equal(getConfig(KEY_NEW), '0');
  });
});

test('classified pull: interest goes to its bucket, not new debt; baseline holds', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '10000');
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '0');
    setConfig(KEY_INTEREST, '0');
    setConfig(KEY_LAST, '10000');
    setConfig(KEY_MAP_SEEDED, '1');
    setConfig('game_start_debt', '10000');
    const prev = new Map([['card', 10000]]);
    const curr = new Map([['card', 10150]]);
    applyClimbMetricsOnPull(10150, prev, curr, { card: 'interest' });
    assert.equal(getConfig(KEY_NEW), '0', 'interest is not new debt');
    assert.equal(getConfig(KEY_INTEREST), '150', 'interest tracked separately');
    assert.equal(getConfig(KEY_BASELINE), '10000', 'baseline unchanged by interest');
  });
});

test('classified pull: a forgotten pre-existing account folds into the baseline', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '10000');
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '0');
    setConfig(KEY_LAST, '10000');
    setConfig(KEY_MAP_SEEDED, '1');
    setConfig('game_start_debt', '10000');
    const prev = new Map([['card', 10000]]);
    const curr = new Map([['card', 10000], ['loan', 2034]]);
    applyClimbMetricsOnPull(12034, prev, curr, { loan: 'preexisting' });
    assert.equal(getConfig(KEY_NEW), '0', 'forgotten debt is not new debt');
    assert.equal(getConfig(KEY_BASELINE), '12034', 'baseline absorbed the forgotten loan');
    assert.equal(getConfig('game_start_debt'), '12034', 'game-start debt rose too');
  });
});

test('reclassifyAddedDebt: moves new debt into the baseline, capped at available', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '10000');
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '2034');
    setConfig('game_start_debt', '10000');
    const r = reclassifyAddedDebt(2034, 'preexisting');
    assert.equal(r.moved, 2034);
    assert.equal(getConfig(KEY_NEW), '0', 'new debt cleared');
    assert.equal(getConfig(KEY_BASELINE), '12034', 'baseline rose by the correction');
    assert.equal(getConfig('game_start_debt'), '12034');
    // Can't move more than what's there.
    const r2 = reclassifyAddedDebt(500, 'preexisting');
    assert.equal(r2.moved, 0);
    assert.equal(getClimbStatsFromConfig().cumulativeNewDebtAdded, 0);
  });
});

test('undoLastPull: restores interest + baseline + balances captured before a pull', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '10000');
    setConfig(KEY_PAID, '0');
    setConfig(KEY_NEW, '0');
    setConfig(KEY_INTEREST, '0');
    setConfig(KEY_LAST, '10000');
    setConfig(KEY_MAP_SEEDED, '1');
    setConfig('game_start_debt', '10000');
    replaceDebtAccountBalances(new Map([['card', 10000]]));

    // Capture BEFORE the pull, then apply a classified pull (interest + forgot).
    const prev = new Map([['card', 10000]]);
    captureUndoState(null, prev);
    assert.equal(hasUndoState(), true);
    const curr = new Map([['card', 10150], ['loan', 2000]]);
    applyClimbMetricsOnPull(12150, prev, curr, { card: 'interest', loan: 'preexisting' });
    assert.equal(getConfig(KEY_INTEREST), '150');
    assert.equal(getConfig(KEY_BASELINE), '12000');
    replaceDebtAccountBalances(curr);

    const r = undoLastPull();
    assert.equal(r.undone, true);
    assert.equal(getConfig(KEY_INTEREST), '0', 'interest restored');
    assert.equal(getConfig(KEY_BASELINE), '10000', 'baseline restored');
    assert.equal(getConfig('game_start_debt'), '10000', 'game-start restored');
    assert.equal(getConfig(KEY_LAST), '10000', 'last reading restored');
    assert.equal(getAllDebtAccountBalances().size, 1, 'the forgotten loan row is gone');
    assert.equal(hasUndoState(), false);
  });
});

test('reclassifyAddedDebt: interest kind moves new debt into the interest bucket', () => {
  withUser(0, () => {
    setConfig(KEY_BASELINE, '10000');
    setConfig(KEY_NEW, '300');
    setConfig(KEY_INTEREST, '0');
    const r = reclassifyAddedDebt(300, 'interest');
    assert.equal(r.moved, 300);
    assert.equal(getConfig(KEY_NEW), '0');
    assert.equal(getConfig(KEY_INTEREST), '300');
    assert.equal(getConfig(KEY_BASELINE), '10000', 'baseline untouched for interest');
  });
});
