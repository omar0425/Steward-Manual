'use strict';

/**
 * Regression tests for the backend-usage audit fixes (data-safety + correctness).
 * Isolated DB file, `zzz`-style early env setup so the right DB binds before any
 * module loads it (mirrors admin-restore.test.js).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `steward-auditfix-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';

for (const m of ['../db', '../services/climbMetrics', '../services/stewardAiContext', '../services/payoffPlan']) {
  delete require.cache[require.resolve(m)];
}

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const climb = require('../services/climbMetrics');
const { paydownLast30FromHistory } = require('../services/stewardAiContext');
const { buildPayoffPlan } = require('../services/payoffPlan');

test.after(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${tmpDb}${ext}`); } catch (_) { /* ignore */ }
  }
});

let _uid = 100;
const freshUser = () => ++_uid;

// ── A1: restore wipe guard + skipped counts ───────────────────────────────────

test('A1: restore refuses an empty-but-valid payload when the user has data', () => {
  const uid = freshUser();
  db.withUser(uid, () => {
    db.insertSnapshot({
      source: 'manual', pulled_at: '2026-01-01T00:00:00Z', net_worth: 0, total_assets: 0,
      total_debt: 1000, investment_value: 0, debt_remaining: 1000, months_ahead: null,
      monthly_income: 0, monthly_expenses: 0, tier: 'rock_bottom', safety_liquid: 0,
    });
    db.setConfig('interest_rates', '{"a":20}');

    const emptyValid = { snapshots: [{ tier: 'rock_bottom' }], debtAccountBalances: [], settings: {} };
    assert.equal(db.isValidImportPayload(emptyValid).ok, true, 'shape is valid');
    assert.throws(() => db.importUserData(emptyValid), /Refusing to restore/, 'guard fires');

    // Data is untouched after the refusal.
    assert.equal(db.recentSnapshots(10).length, 1, 'snapshot preserved');
    assert.equal(db.getConfig('interest_rates'), '{"a":20}', 'config preserved');

    // force bypasses the guard (intentional wipe).
    const counts = db.importUserData(emptyValid, { force: true });
    assert.equal(counts.snapshots, 0);
    assert.equal(counts.skipped.snapshots, 1, 'the bad snapshot is reported skipped');
    assert.equal(db.recentSnapshots(10).length, 0, 'force wiped as asked');
  });
});

test('A1: skipped counts surface partial restores', () => {
  const uid = freshUser();
  db.withUser(uid, () => {
    const r = db.importUserData({
      snapshots: [
        { pulled_at: '2026-02-01T00:00:00Z', debt_remaining: 500 }, // good
        { tier: 'broke' },                                          // no pulled_at → skipped
      ],
      debtAccountBalances: [{ accountId: 'x', balance: -5 }],        // negative → skipped
    });
    assert.equal(r.snapshots, 1);
    assert.equal(r.skipped.snapshots, 1);
    assert.equal(r.skipped.balances, 1);
  });
});

// ── A2: undo deletes the history row the pull appended ─────────────────────────

test('A2: undoLastPull removes the appended history row (no phantom replay)', () => {
  const uid = freshUser();
  db.withUser(uid, () => {
    db.setConfig(climb.KEY_BASELINE, '1000');
    db.setConfig(climb.KEY_PAID, '0');
    db.setConfig(climb.KEY_NEW, '0');
    db.setConfig(climb.KEY_LAST, '1000');
    db.setConfig(climb.KEY_MAP_SEEDED, '1');
    db.setConfig('game_start_debt', '1000');
    db.replaceDebtAccountBalances(new Map([['card', 1000]]));
    db.appendDebtAccountHistory(new Map([['card', 1000]]), '2026-01-01T00:00:00Z');

    // A mistyped pull: card jumps to 1200 at a known timestamp.
    const at = '2026-02-01T00:00:00Z';
    const prev = new Map([['card', 1000]]);
    climb.captureUndoState(null, prev, 'update', at);
    const curr = new Map([['card', 1200]]);
    db.replaceDebtAccountBalances(curr);
    db.appendDebtAccountHistory(curr, at);
    climb.applyClimbMetricsOnPull(1200, prev, curr, {});
    assert.equal(db.getConfig(climb.KEY_NEW), '200', 'pull recorded as new debt');

    const r = climb.undoLastPull();
    assert.equal(r.undone, true);
    assert.equal(r.historyDeleted, 1, 'the appended history row was deleted');

    const rows = db.debtAccountHistoryRows().filter((h) => h.recordedAt === at);
    assert.equal(rows.length, 0, 'no history row remains at the undone pull timestamp');

    // A later recompute must NOT resurrect the reversed 1200.
    const rec = climb.recomputeClimbTotalsFromHistory({ apply: false });
    assert.equal(rec.after.cumulativeNewDebtAdded, 0, 'recompute does not replay the undone pull');
  });
});

// ── A4: recompute refuses to zero totals when there is no history ──────────────

test('A4: recompute apply refuses to wipe totals when there is no usable history', () => {
  const uid = freshUser();
  db.withUser(uid, () => {
    db.setConfig('game_start_at', '2026-01-01T00:00:00Z');
    db.setConfig(climb.KEY_PAID, '750'); // real progress, but history is gone
    // No debt_account_history rows exist for this user.
    const res = climb.recomputeClimbTotalsFromHistory({ apply: true });
    assert.equal(res.applied, false, 'did not apply');
    assert.equal(res.refused, 'no_history');
    assert.equal(db.getConfig(climb.KEY_PAID), '750', 'totals preserved');
  });
});

// ── A3: transactions nest safely (savepoint rollback) ─────────────────────────

test('A3: nested transaction rolls back the inner unit without aborting the outer', () => {
  const uid = freshUser();
  db.withUser(uid, () => {
    db.setConfig('keep', 'outer');
    db.transaction(() => {
      db.setConfig('outer_key', 'a');
      try {
        db.transaction(() => {
          db.setConfig('inner_key', 'b');
          throw new Error('boom'); // roll back just this savepoint
        });
      } catch (_) { /* swallowed */ }
    });
    assert.equal(db.getConfig('outer_key'), 'a', 'outer write committed');
    assert.equal(db.getConfig('inner_key'), null, 'inner write rolled back');
  });
});

// ── B1: removed accounts are not counted as 30-day paydown ─────────────────────

test('B1: paydownLast30FromHistory ignores a removed account (no phantom paydown)', () => {
  // Account "gone" is absent from the latest history (removed) — its disappearance
  // must NOT read as paydown. "card" genuinely dropped 1000→800 = 200 paid.
  const hist = {
    card: [{ date: '2026-01-01', balance: 1000 }, { date: '2026-01-20', balance: 800 }],
    gone: [{ date: '2026-01-01', balance: 5000 }], // last record before removal; no $0 row
  };
  const r = paydownLast30FromHistory(hist);
  assert.equal(r.paydown, 200, 'only the real per-account drop counts, not the removal');
});

// ── B4: streak previous-length + payoff sub-$1 ────────────────────────────────

test('B4: computeStreak reports the PRIOR streak length, not the current one', () => {
  // newest-first debt. decreased(i) = debt[i] < debt[i+1] (paid down going older→newer).
  // i0:10<20 T, i1:20<30 T → current=2. i2:30<25 F → break. i3:25<40 T, i4:40<38 F
  // → previous=1. The OLD code reported previousStreakLength = current (2); the fix
  // measures the older run independently (1).
  const snaps = [
    { debt_remaining: 10, pulled_at: '2026-06-06' },
    { debt_remaining: 20, pulled_at: '2026-06-05' },
    { debt_remaining: 30, pulled_at: '2026-06-04' }, // break boundary
    { debt_remaining: 25, pulled_at: '2026-06-03' },
    { debt_remaining: 40, pulled_at: '2026-06-02' },
    { debt_remaining: 38, pulled_at: '2026-06-01' },
  ];
  const s = climb.computeStreak(snaps);
  assert.equal(s.current, 2, 'current streak = 2 most-recent decreases');
  assert.equal(s.previousStreakLength, 1, 'older run = 1, NOT the current streak length');
  assert.equal(s.previousStreakEndedAt, '2026-06-04', 'ended at the break snapshot');

  // Second distinguishing case: current=1, previous=2.
  const snaps2 = [
    { debt_remaining: 1, pulled_at: 'd7' },
    { debt_remaining: 2, pulled_at: 'd6' }, // i0: 1<2 → current=1
    { debt_remaining: 2, pulled_at: 'd5' }, // i1: 2<2 false → break
    { debt_remaining: 3, pulled_at: 'd4' }, // i2: 2<3 → previous=1
    { debt_remaining: 4, pulled_at: 'd3' }, // i3: 3<4 → previous=2
    { debt_remaining: 4, pulled_at: 'd2' }, // i4: 4<4 false → stop
  ];
  const s2 = climb.computeStreak(snaps2);
  assert.equal(s2.current, 1);
  assert.equal(s2.previousStreakLength, 2, 'prior run measured independently of current');
});

test('B4: buildPayoffPlan keeps a genuine sub-$1 account instead of dropping it', () => {
  const plan = buildPayoffPlan([{ id: 'a', name: 'Dust', balance: 0.4, apr: 0 }]);
  assert.notEqual(plan, null, 'a real positive balance under $1 still yields a target');
  assert.equal(plan.snowball.target.name, 'Dust');
});
