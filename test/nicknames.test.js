'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  assignNicknames,
  detectNicknameCandidates,
} = require('../services/stewardAiNicknames');

// Helper: build a flat history of N points all at `bal` (stable balance).
function flat(bal, n) {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-01-${i + 1}`, balance: bal }));
}

// Helper: a gently declining history (−$10/step). Spread > $20 over 4 points so
// it does NOT read as "Stubborn", no increases so not "Wound", and large balances
// stay ≥ $500 so not "Quiet Closer" — i.e. it matches ONLY The Bleeder via APR.
function declining(start, n) {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-01-${i + 1}`, balance: start - i * 10 }));
}

test('nickname candidates: high APR yields The Bleeder regardless of history', () => {
  const c = detectNicknameCandidates({ history: [], apr: 24, currentBalance: 4000 });
  assert.ok(c.includes('The Bleeder'));
});

test('nicknames are unique: a wallet of high-APR cards does not all become The Bleeder', () => {
  const accounts = [
    { id: 'a', balance: 4000 },
    { id: 'b', balance: 3000 },
    { id: 'c', balance: 2000 },
  ];
  const aprMap = { a: 22, b: 26, c: 21 }; // all ≥ 20 → all match The Bleeder
  // Declining histories so The Bleeder is the ONLY pattern each one matches.
  const history = { a: declining(4000, 5), b: declining(3000, 5), c: declining(2000, 5) };

  const nicks = assignNicknames(accounts, aprMap, history, {});
  const names = Object.values(nicks);

  // No duplicates among assigned names.
  assert.strictEqual(new Set(names).size, names.length, `expected unique names, got ${JSON.stringify(nicks)}`);

  // The single Bleeder goes to the highest-APR account (b @ 26%).
  assert.strictEqual(nicks.b, 'The Bleeder');
  // The others (a, c) match only The Bleeder, which is now taken, so they fall
  // through to no nickname rather than duplicating it.
  assert.strictEqual(nicks.a, undefined);
  assert.strictEqual(nicks.c, undefined);
});

test('nicknames fall through to a distinct weaker pattern when the strong one is taken', () => {
  // Two accounts both high-APR, but one also reads as "Stubborn" (flat balance).
  // The higher APR claims The Bleeder; the other should still get a DISTINCT
  // name from its next matching pattern rather than nothing.
  const accounts = [
    { id: 'hi', balance: 5000 },
    { id: 'stub', balance: 1500 },
  ];
  const aprMap = { hi: 25, stub: 21 };
  const history = {
    hi: flat(5000, 5),     // only matches Bleeder
    stub: flat(1500, 6),   // Bleeder + Stubborn One (flat ≥4 snapshots, bal ≥100)
  };

  const nicks = assignNicknames(accounts, aprMap, history, {});
  assert.strictEqual(nicks.hi, 'The Bleeder');
  assert.strictEqual(nicks.stub, 'The Stubborn One');
});

test('nicknames are sticky and pruned: existing names kept; removed accounts dropped', () => {
  const existing = { a: 'The Bleeder', gone: 'The Quiet Closer' };
  const accounts = [{ id: 'a', balance: 4000 }, { id: 'b', balance: 1000 }];
  const aprMap = { a: 22, b: 23 };
  const history = { a: flat(4000, 5), b: flat(1000, 5) };

  const nicks = assignNicknames(accounts, aprMap, history, existing);

  assert.strictEqual(nicks.a, 'The Bleeder');   // sticky
  assert.strictEqual(nicks.gone, undefined);    // pruned (no longer a live account)
  // 'a' already holds The Bleeder, so 'b' cannot duplicate it.
  assert.notStrictEqual(nicks.b, 'The Bleeder');
});
