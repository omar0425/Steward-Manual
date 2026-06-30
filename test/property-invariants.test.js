'use strict';

/**
 * Property / fuzz tests for the climb money-engine.
 *
 * The other suites check specific hand-picked cases. These throw RANDOM
 * sequences of pull / undo / reclassify (and random per-account balance maps)
 * at the engine and assert the money invariants ALWAYS hold — the guardrail
 * that stops a future change from silently re-breaking the exact bugs prior
 * batches fixed (phantom paydown on removal, negative totals, net dragged
 * below zero, pctPaid past 100, undo not restoring state).
 *
 * Determinism: a seeded PRNG drives every trial and the seed is printed in the
 * assertion message, so any failure is reproducible by re-running with that
 * seed. Balances are generated at exact cent precision so the arithmetic is
 * exact and invariants can be asserted as equalities, not tolerances.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  analyzePerAccountDebtDiff,
  routeDeltasByClassification,
  applyDeltaToTotals,
  recomputeTotalsFromHistory,
  applyClimbMetricsOnPull,
  captureUndoState,
  undoLastPull,
  reclassifyAddedDebt,
  getClimbStatsFromConfig,
  roundMoney,
} = require('../services/climbMetrics');

const {
  withUser,
  getAllDebtAccountBalances,
  replaceDebtAccountBalances,
  appendDebtAccountHistory,
  initGameState,
  resetAllGameState,
} = require('../db');

// ── Seeded RNG (mulberry32) ───────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random balance in dollars at exact cent precision, $0–$5,000. */
function randCents(rng) {
  return Math.floor(rng() * 500001) / 100;
}

/** Random Map<id, balance> with up to `maxAccounts` accounts (ids a0..aN). */
function randMap(rng, maxAccounts) {
  const n = Math.floor(rng() * (maxAccounts + 1));
  const m = new Map();
  for (let i = 0; i < n; i++) m.set('a' + i, randCents(rng));
  return m;
}

const sumVals = (map) => roundMoney([...map.values()].reduce((a, b) => a + b, 0));

// ── 1. analyzePerAccountDebtDiff — exact invariants over random maps ──────────
test('property: analyzePerAccountDebtDiff — paydown/new exact, removals never inflate', () => {
  const SEED = 0x51ed1;
  const rng = makeRng(SEED);
  for (let trial = 0; trial < 400; trial++) {
    const prev = randMap(rng, 6);
    const curr = randMap(rng, 6);
    const r = analyzePerAccountDebtDiff(prev, curr);
    const ctx = `seed=${SEED} trial=${trial} prev=${JSON.stringify([...prev])} curr=${JSON.stringify([...curr])}`;

    // Independently compute the expected sums.
    let expPaydown = 0;
    let expNew = 0;
    for (const [id, p] of prev) {
      if (curr.has(id)) {
        const d = roundMoney(curr.get(id) - p);
        if (d < 0) expPaydown += Math.abs(d);
        else if (d > 0) expNew += d;
      }
      // id in prev but not curr → removed → contributes to NEITHER sum.
    }
    for (const [id, c] of curr) if (!prev.has(id)) expNew += c;

    assert.strictEqual(r.paydownSum, roundMoney(expPaydown), `paydown mismatch — ${ctx}`);
    assert.strictEqual(r.newDebtSum, roundMoney(expNew), `newDebt mismatch — ${ctx}`);
    assert.ok(r.paydownSum >= 0 && r.newDebtSum >= 0, `negative sum — ${ctx}`);
  }
});

test('property: removing accounts (no other change) never produces paydown or new debt', () => {
  const SEED = 0xbead;
  const rng = makeRng(SEED);
  for (let trial = 0; trial < 200; trial++) {
    const prev = randMap(rng, 8);
    if (prev.size === 0) continue;
    // curr = prev with a random subset dropped; survivors keep identical balances.
    const curr = new Map();
    for (const [id, bal] of prev) if (rng() > 0.5) curr.set(id, bal);
    const r = analyzePerAccountDebtDiff(prev, curr);
    const ctx = `seed=${SEED} trial=${trial} prev=${JSON.stringify([...prev])}`;
    assert.strictEqual(r.paydownSum, 0, `removal inflated paydown — ${ctx}`);
    assert.strictEqual(r.newDebtSum, 0, `removal inflated new debt — ${ctx}`);
  }
});

// ── 2. routeDeltasByClassification — buckets reconcile, removals ignored ──────
test('property: routeDeltasByClassification — buckets sum to positives, decreases are paydown', () => {
  const SEED = 0xc1a55;
  const rng = makeRng(SEED);
  const cats = ['purchase', 'new_loan', 'interest', 'preexisting', 'mystery', undefined];
  for (let trial = 0; trial < 300; trial++) {
    const prev = randMap(rng, 6);
    const curr = randMap(rng, 6);
    const cls = {};
    for (const id of curr.keys()) cls[id] = cats[Math.floor(rng() * cats.length)];
    const r = routeDeltasByClassification(prev, curr, cls);
    const ctx = `seed=${SEED} trial=${trial} prev=${JSON.stringify([...prev])} curr=${JSON.stringify([...curr])} cls=${JSON.stringify(cls)}`;

    // Expected, computed independently with the same bucket rules.
    let expPaydown = 0, expNew = 0, expInterest = 0, expBaseline = 0;
    const route = (id, amt) => {
      const c = cls[id];
      if (c === 'interest') expInterest += amt;
      else if (c === 'preexisting') expBaseline += amt;
      else expNew += amt;
    };
    for (const [id, p] of prev) {
      if (!curr.has(id)) continue; // removed → ignored
      const d = roundMoney(curr.get(id) - p);
      if (d < 0) expPaydown += Math.abs(d);
      else if (d > 0) route(id, d);
    }
    for (const [id, c] of curr) if (!prev.has(id) && c > 0) route(id, c);

    assert.strictEqual(r.paydownSum, roundMoney(expPaydown), `paydown — ${ctx}`);
    assert.strictEqual(r.newDebtSum, roundMoney(expNew), `new — ${ctx}`);
    assert.strictEqual(r.interestSum, roundMoney(expInterest), `interest — ${ctx}`);
    assert.strictEqual(r.baselineBump, roundMoney(expBaseline), `baseline — ${ctx}`);
    for (const v of [r.paydownSum, r.newDebtSum, r.interestSum, r.baselineBump]) {
      assert.ok(v >= 0, `negative bucket — ${ctx}`);
    }
  }
});

// ── 3. applyDeltaToTotals — monotonic, correct delta accounting, round-trip ───
test('property: applyDeltaToTotals — monotonic and correctly attributes the delta', () => {
  const SEED = 0xd317a;
  const rng = makeRng(SEED);
  for (let trial = 0; trial < 400; trial++) {
    const last = randCents(rng);
    const debt = randCents(rng);
    const paid0 = randCents(rng);
    const new0 = randCents(rng);
    const r = applyDeltaToTotals(last, debt, paid0, new0);
    const ctx = `seed=${SEED} trial=${trial} last=${last} debt=${debt} paid0=${paid0} new0=${new0}`;

    assert.ok(r.cumulativePaidDown >= roundMoney(paid0) - 1e-9, `paid decreased — ${ctx}`);
    assert.ok(r.cumulativeNewDebtAdded >= roundMoney(new0) - 1e-9, `new decreased — ${ctx}`);
    assert.strictEqual(r.last, roundMoney(debt), `last not updated — ${ctx}`);

    const delta = roundMoney(debt - last);
    if (delta < 0) {
      assert.strictEqual(r.cumulativePaidDown, roundMoney(paid0 + Math.abs(delta)), `paydown delta — ${ctx}`);
      assert.strictEqual(r.cumulativeNewDebtAdded, roundMoney(new0), `new should be flat — ${ctx}`);
    } else if (delta > 0) {
      assert.strictEqual(r.cumulativeNewDebtAdded, roundMoney(new0 + delta), `new delta — ${ctx}`);
      assert.strictEqual(r.cumulativePaidDown, roundMoney(paid0), `paid should be flat — ${ctx}`);
    } else {
      assert.strictEqual(r.cumulativePaidDown, roundMoney(paid0), `paid flat on zero delta — ${ctx}`);
      assert.strictEqual(r.cumulativeNewDebtAdded, roundMoney(new0), `new flat on zero delta — ${ctx}`);
    }
  }
});

// ── 4. recomputeTotalsFromHistory — monotone histories give clean totals ─────
test('property: recomputeTotalsFromHistory — pure-paydown and pure-growth histories', () => {
  const SEED = 0xf00d;
  const rng = makeRng(SEED);
  const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
  const stamp = (i) => new Date(baseTime + i * 86400000).toISOString();

  for (let trial = 0; trial < 120; trial++) {
    const pulls = 2 + Math.floor(rng() * 6);
    const goingDown = rng() > 0.5;
    let bal = goingDown ? randCents(rng) + 1000 : randCents(rng);
    const rows = [];
    const balances = [];
    for (let i = 0; i < pulls; i++) {
      balances.push(roundMoney(bal));
      rows.push({ accountId: 'solo', recordedAt: stamp(i), balance: roundMoney(bal) });
      const step = Math.floor(rng() * 20000) / 100; // up to $200
      bal = goingDown ? Math.max(0, bal - step) : bal + step;
    }
    const r = recomputeTotalsFromHistory(rows, stamp(0));
    const ctx = `seed=${SEED} trial=${trial} balances=${JSON.stringify(balances)}`;

    assert.ok(r.cumulativePaidDown >= 0 && r.cumulativeNewDebtAdded >= 0, `negative total — ${ctx}`);
    const first = balances[0];
    const lastBal = balances[balances.length - 1];
    if (goingDown) {
      assert.strictEqual(r.cumulativeNewDebtAdded, 0, `monotone paydown added new debt — ${ctx}`);
      assert.strictEqual(r.cumulativePaidDown, roundMoney(first - lastBal), `paydown total wrong — ${ctx}`);
    } else {
      assert.strictEqual(r.cumulativePaidDown, 0, `monotone growth produced paydown — ${ctx}`);
      assert.strictEqual(r.cumulativeNewDebtAdded, roundMoney(lastBal - first), `new total wrong — ${ctx}`);
    }
  }
});

// ── 5. Stateful engine fuzz — random pull/undo/reclassify keeps invariants ────
test('property: stateful pull/undo/reclassify sequences preserve all invariants', () => {
  const SEED = 0x5ec0;
  const rng = makeRng(SEED);
  const USER = 990123;
  const baseTime = Date.parse('2026-03-01T00:00:00.000Z');
  let tick = 0;
  const nextTs = () => new Date(baseTime + tick++ * 1000).toISOString();

  function stats() {
    const s = getClimbStatsFromConfig();
    return {
      paid: s.cumulativePaidDown,
      newD: s.cumulativeNewDebtAdded,
      interest: s.cumulativeInterestAccrued,
      baseline: s.climbBaselineDebt,
      net: s.netImprovement,
      pct: s.pctPaid,
    };
  }

  function assertInvariants(label) {
    const s = getClimbStatsFromConfig();
    assert.ok(s.cumulativePaidDown >= 0, `${label}: paid<0 (seed=${SEED})`);
    assert.ok(s.cumulativeNewDebtAdded >= 0, `${label}: new<0 (seed=${SEED})`);
    assert.ok(s.cumulativeInterestAccrued >= 0, `${label}: interest<0 (seed=${SEED})`);
    assert.ok(s.pctPaid >= 0 && s.pctPaid <= 100, `${label}: pctPaid out of [0,100]=${s.pctPaid} (seed=${SEED})`);
    assert.strictEqual(
      s.netImprovement,
      roundMoney(s.cumulativePaidDown - s.cumulativeNewDebtAdded),
      `${label}: net != paid-new (seed=${SEED})`,
    );
    assert.ok(s.climbBaselineDebt > 0, `${label}: baseline not positive (seed=${SEED})`);
  }

  function doPull(newMap, cls) {
    const prev = getAllDebtAccountBalances();
    const debt = sumVals(newMap);
    const t = nextTs();
    captureUndoState(null, prev, 'update', t);
    replaceDebtAccountBalances(newMap);
    appendDebtAccountHistory(newMap, t);
    applyClimbMetricsOnPull(debt, prev, newMap, cls || {});
    return debt;
  }

  withUser(USER, () => {
    for (let seq = 0; seq < 8; seq++) {
      resetAllGameState();

      // Lock a baseline from a non-empty starting inventory.
      let initial = randMap(rng, 4);
      if (initial.size === 0) initial = new Map([['a0', 1000]]);
      // guarantee a positive total so baseline > 0
      if (sumVals(initial) <= 0) initial.set('a0', 1000);
      const t0 = nextTs();
      replaceDebtAccountBalances(initial);
      appendDebtAccountHistory(initial, t0);
      initGameState(sumVals(initial), t0);
      assertInvariants(`seq${seq} init`);

      let prevPaid = stats().paid;
      let prevNew = stats().newD;
      let current = new Map(initial);

      for (let step = 0; step < 25; step++) {
        const op = rng();

        if (op < 0.2) {
          // ── UNDO round-trip: pull then immediately undo, expect exact restore.
          const before = stats();
          const probe = new Map(current);
          for (const id of probe.keys()) if (rng() > 0.5) probe.set(id, randCents(rng));
          doPull(probe, {});
          const u = undoLastPull();
          assert.ok(u.undone, `seq${seq} step${step}: undo reported nothing (seed=${SEED})`);
          assert.deepStrictEqual(stats(), before, `seq${seq} step${step}: undo did not restore state (seed=${SEED})`);
          assertInvariants(`seq${seq} step${step} post-undo`);
          // current balances were restored by undo; keep `current` as-is.
        } else if (op < 0.35 && current.size > 0) {
          // ── REMOVAL only: drop a subset, survivors unchanged → no paydown/new.
          const before = stats();
          const next = new Map();
          for (const [id, bal] of current) if (rng() > 0.4) next.set(id, bal);
          doPull(next, {});
          const after = stats();
          assert.strictEqual(after.paid, before.paid, `seq${seq} step${step}: removal inflated paydown (seed=${SEED})`);
          assert.strictEqual(after.newD, before.newD, `seq${seq} step${step}: removal inflated new debt (seed=${SEED})`);
          current = next;
          assertInvariants(`seq${seq} step${step} post-removal`);
        } else if (op < 0.5) {
          // ── RECLASSIFY: move some "new debt" to preexisting/interest.
          const kind = rng() > 0.5 ? 'interest' : 'preexisting';
          const amt = randCents(rng);
          captureUndoState(null, getAllDebtAccountBalances(), 'correction');
          reclassifyAddedDebt(amt, kind);
          assertInvariants(`seq${seq} step${step} post-reclassify`);
          // reclassify legitimately lowers new debt; refresh the monotonic baseline.
          prevPaid = stats().paid;
          prevNew = stats().newD;
        } else {
          // ── PULL: random balance changes, adds, classifications.
          const next = new Map(current);
          for (const id of next.keys()) if (rng() > 0.5) next.set(id, randCents(rng));
          if (rng() > 0.6) next.set('a' + (5 + step), randCents(rng)); // occasionally add
          const cls = {};
          for (const id of next.keys()) {
            const r = rng();
            cls[id] = r < 0.25 ? 'interest' : r < 0.5 ? 'preexisting' : 'purchase';
          }
          doPull(next, cls);
          const after = stats();
          // Pure pulls never decrease the cumulative counters.
          assert.ok(after.paid >= prevPaid - 1e-9, `seq${seq} step${step}: paid decreased on pull (seed=${SEED})`);
          assert.ok(after.newD >= prevNew - 1e-9, `seq${seq} step${step}: new decreased on pull (seed=${SEED})`);
          prevPaid = after.paid;
          prevNew = after.newD;
          current = next;
          assertInvariants(`seq${seq} step${step} post-pull`);
        }
      }
    }
    // Leave no fuzz state behind for other suites sharing the DB.
    resetAllGameState();
  });
});
