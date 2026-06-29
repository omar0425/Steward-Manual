'use strict';

/**
 * Property / fuzz tests for the climb money engine. Seeded random sequences of
 * pulls (and undos) are pushed through the REAL db + climbMetrics functions, and
 * the invariants are asserted after every step. This is the safety net that stops
 * a future change from silently re-breaking the audit fixes (removals-as-paydown,
 * undo completeness, negative metrics, net miscalc).
 *
 * Isolated DB; kept LAST in run-all.js (it rebinds the DB like admin-restore).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `steward-fuzz-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';

for (const m of ['../db', '../services/climbMetrics']) {
  delete require.cache[require.resolve(m)];
}

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const climb = require('../services/climbMetrics');

test.after(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${tmpDb}${ext}`); } catch (_) { /* ignore */ }
  }
});

// Deterministic PRNG (LCG) so any failure is reproducible from its seed.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const round2 = (n) => Math.round(n * 100) / 100;
let _uid = 5000;
const freshUser = () => ++_uid;
const BASE = Date.parse('2026-01-01T00:00:00Z');
const stamp = (i) => new Date(BASE + i * 60000).toISOString();

const CATS = ['purchase', 'new_loan', 'interest', 'preexisting'];

function mutate(prev, rng) {
  const next = new Map(prev);
  for (const [id, bal] of prev) {
    const r = rng();
    if (r < 0.30) next.set(id, Math.max(0, round2(bal - bal * rng())));      // pay down
    else if (r < 0.50) next.set(id, round2(bal + rng() * 500));               // increase
    else if (r < 0.58) next.delete(id);                                       // remove
  }
  if (rng() < 0.30) next.set(`a${Math.floor(rng() * 1e6)}`, round2(rng() * 1000));
  return next;
}
function classifyIncreases(prev, curr, rng) {
  const cls = {};
  for (const [id, bal] of curr) {
    const p = prev.has(id) ? prev.get(id) : 0;
    if (bal > p) cls[id] = CATS[Math.floor(rng() * CATS.length)];
  }
  return cls;
}
function debtSum(map) { return round2([...map.values()].reduce((s, v) => s + v, 0)); }

// One pull, exactly as POST /api/snapshot drives the engine (per-account path).
function doPull(prev, curr, cls, at) {
  climb.captureUndoState(null, prev, 'update', at);
  db.replaceDebtAccountBalances(curr);
  db.appendDebtAccountHistory(curr, at);
  climb.applyClimbMetricsOnPull(debtSum(curr), prev, curr, cls);
}

function checkInvariants(ctx) {
  const c = climb.getClimbStatsFromConfig();
  assert.ok(c.cumulativePaidDown >= 0, `${ctx}: paid >= 0 (got ${c.cumulativePaidDown})`);
  assert.ok(c.cumulativeNewDebtAdded >= 0, `${ctx}: new >= 0 (got ${c.cumulativeNewDebtAdded})`);
  assert.ok(c.cumulativeInterestAccrued >= 0, `${ctx}: interest >= 0 (got ${c.cumulativeInterestAccrued})`);
  assert.equal(c.netImprovement, round2(c.cumulativePaidDown - c.cumulativeNewDebtAdded), `${ctx}: net = paid - new`);
  assert.ok(c.pctPaid >= 0 && c.pctPaid <= 100, `${ctx}: pctPaid in [0,100] (got ${c.pctPaid})`);
  assert.ok(Number.isFinite(c.climbBaselineDebt) && c.climbBaselineDebt > 0, `${ctx}: baseline > 0`);
}

function seedGame(initial, atIdx = 0) {
  db.setConfig(climb.KEY_BASELINE, String(debtSum(initial)));
  db.setConfig(climb.KEY_PAID, '0');
  db.setConfig(climb.KEY_NEW, '0');
  db.setConfig(climb.KEY_INTEREST, '0');
  db.setConfig(climb.KEY_LAST, String(debtSum(initial)));
  db.setConfig(climb.KEY_MAP_SEEDED, '1');
  db.setConfig('game_start_debt', String(debtSum(initial)));
  db.setConfig('game_start_at', stamp(atIdx));
  db.setConfig(climb.KEY_UNDO, '');
  db.replaceDebtAccountBalances(initial);
  db.appendDebtAccountHistory(initial, stamp(atIdx));
}

// ── Property 1: invariants hold after every committed pull ──────────────────────
test('fuzz: climb invariants hold across random committed pulls', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    db.withUser(freshUser(), () => {
      const rng = makeRng(seed);
      seedGame(new Map([['seed', round2(5000 + rng() * 20000)]]));
      let prev = db.getAllDebtAccountBalances();
      for (let i = 1; i <= 200; i++) {
        const curr = mutate(prev, rng);
        doPull(prev, curr, classifyIncreases(prev, curr, rng), stamp(i));
        checkInvariants(`seed=${seed} iter=${i}`);
        prev = db.getAllDebtAccountBalances();
      }
    });
  }
});

// ── Property 2: undo restores the EXACT prior state (config + balances + history) ─
// Kept under the 30-row-per-account history prune window so undo's history delete
// is a true inverse of the pull's append.
test('fuzz: undo perfectly reverses a pull', () => {
  const KEYS = [climb.KEY_BASELINE, climb.KEY_PAID, climb.KEY_NEW, climb.KEY_INTEREST, climb.KEY_LAST, 'game_start_debt'];
  const snap = () => {
    const cfg = {};
    for (const k of KEYS) cfg[k] = db.getConfig(k);
    // Normalize the undo stack so '' and '[]' (both empty) compare equal.
    cfg.undoStack = JSON.parse(db.getConfig(climb.KEY_UNDO) || '[]');
    const bal = {};
    for (const [id, v] of db.getAllDebtAccountBalances()) bal[id] = v;
    const hist = db.debtAccountHistoryRows().map((r) => ({ a: r.accountId, t: r.recordedAt, b: r.balance }));
    return { cfg, bal, hist };
  };
  for (const seed of [3, 11, 99, 2024]) {
    db.withUser(freshUser(), () => {
      const rng = makeRng(seed);
      seedGame(new Map([['seed', round2(3000 + rng() * 9000)]]));
      let prev = db.getAllDebtAccountBalances();
      for (let i = 1; i <= 20; i++) {
        const before = snap();
        const curr = mutate(prev, rng);
        doPull(prev, curr, classifyIncreases(prev, curr, rng), stamp(i + 100 * seed));
        const r = climb.undoLastPull();
        assert.equal(r.undone, true, `seed=${seed} iter=${i}: undo ran`);
        assert.deepEqual(snap(), before, `seed=${seed} iter=${i}: undo restores exact state`);
        prev = db.getAllDebtAccountBalances();
      }
    });
  }
});

// ── Property 3: a removal-only pull never increases paydown ──────────────────────
test('fuzz: removing accounts never counts as paydown', () => {
  db.withUser(freshUser(), () => {
    seedGame(new Map([['x', 4000], ['y', 2000], ['z', 1000]]));
    // Anchor the engine on a no-op pull so KEY_LAST tracks the per-account map.
    let prev = db.getAllDebtAccountBalances();
    doPull(prev, new Map(prev), {}, stamp(1));
    const paidBefore = climb.getClimbStatsFromConfig().cumulativePaidDown;
    // Drop two accounts entirely (data cleanup) — keep the third unchanged.
    prev = db.getAllDebtAccountBalances();
    doPull(prev, new Map([['x', 4000]]), {}, stamp(2));
    const paidAfter = climb.getClimbStatsFromConfig().cumulativePaidDown;
    assert.equal(paidAfter, paidBefore, 'account removals must not inflate cumulative paydown');
  });
});

// ── Property 4: recompute parity when no interest/preexisting classifications ────
// With every increase treated as new debt (the recompute's only rule), replaying
// history must reproduce the live paid/new totals exactly.
test('fuzz: recompute from history matches live totals (unclassified runs)', () => {
  for (const seed of [5, 50, 500]) {
    db.withUser(freshUser(), () => {
      const rng = makeRng(seed);
      seedGame(new Map([['seed', round2(4000 + rng() * 6000)]]));
      let prev = db.getAllDebtAccountBalances();
      for (let i = 1; i <= 12; i++) { // under the 30-row prune window
        const curr = mutate(prev, rng);
        // No interest/preexisting → every increase is plain new debt.
        const cls = {};
        for (const [id, bal] of curr) {
          const p = prev.has(id) ? prev.get(id) : 0;
          if (bal > p) cls[id] = 'purchase';
        }
        doPull(prev, curr, cls, stamp(i));
        prev = db.getAllDebtAccountBalances();
      }
      const live = climb.getClimbStatsFromConfig();
      const rebuilt = climb.recomputeTotalsFromHistory(db.debtAccountHistoryRows(), db.getConfig('game_start_at'));
      assert.equal(rebuilt.cumulativePaidDown, live.cumulativePaidDown, `seed=${seed}: paid parity`);
      assert.equal(rebuilt.cumulativeNewDebtAdded, live.cumulativeNewDebtAdded, `seed=${seed}: new parity`);
    });
  }
});
