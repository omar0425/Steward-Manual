'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeDeltasByClassification } = require('../services/climbMetrics');

test('routeDeltasByClassification: decreases are always paydown', () => {
  const prev = new Map([['a', 1000], ['b', 500]]);
  const curr = new Map([['a', 600], ['b', 500]]);
  const r = routeDeltasByClassification(prev, curr, {});
  assert.equal(r.paydownSum, 400);
  assert.equal(r.newDebtSum, 0);
  assert.equal(r.interestSum, 0);
  assert.equal(r.baselineBump, 0);
});

test('routeDeltasByClassification: unclassified increase defaults to new debt', () => {
  const prev = new Map([['a', 1000]]);
  const curr = new Map([['a', 1200]]);
  const r = routeDeltasByClassification(prev, curr, {});
  assert.equal(r.newDebtSum, 200);
});

test('routeDeltasByClassification: interest routes to its own bucket, never new debt', () => {
  const prev = new Map([['a', 1000]]);
  const curr = new Map([['a', 1090]]);
  const r = routeDeltasByClassification(prev, curr, { a: 'interest' });
  assert.equal(r.interestSum, 90);
  assert.equal(r.newDebtSum, 0);
});

test('routeDeltasByClassification: preexisting routes to baseline bump', () => {
  // A brand-new account the user already had → full balance folds into baseline.
  const prev = new Map([['a', 1000]]);
  const curr = new Map([['a', 1000], ['loan', 2034]]);
  const r = routeDeltasByClassification(prev, curr, { loan: 'preexisting' });
  assert.equal(r.baselineBump, 2034);
  assert.equal(r.newDebtSum, 0);
});

test('routeDeltasByClassification: mixed pull splits every bucket correctly', () => {
  const prev = new Map([['pay', 5000], ['buy', 1000], ['int', 2000]]);
  const curr = new Map([
    ['pay', 4500],   // -500 paydown
    ['buy', 1300],   // +300 purchase
    ['int', 2080],   // +80 interest
    ['old', 900],    // new, pre-existing
  ]);
  const r = routeDeltasByClassification(prev, curr, {
    buy: 'purchase', int: 'interest', old: 'preexisting',
  });
  assert.equal(r.paydownSum, 500);
  assert.equal(r.newDebtSum, 300);
  assert.equal(r.interestSum, 80);
  assert.equal(r.baselineBump, 900);
});

test('routeDeltasByClassification: removed account never counts', () => {
  const prev = new Map([['gone', 4000], ['stay', 1000]]);
  const curr = new Map([['stay', 1000]]);
  const r = routeDeltasByClassification(prev, curr, {});
  assert.equal(r.paydownSum, 0);
  assert.equal(r.newDebtSum, 0);
});

test('routeDeltasByClassification: a SPLIT rise lands each dollar part in its own bucket', () => {
  // One card: $30 interest posted AND $50 of new spending in the same pull.
  const prev = new Map([['card', 1000]]);
  const curr = new Map([['card', 1080]]);
  const r = routeDeltasByClassification(prev, curr, {
    card: { interest: 30, purchase: 50 },
  });
  assert.equal(r.interestSum, 30);
  assert.equal(r.newDebtSum, 50);
  assert.equal(r.baselineBump, 0);
  assert.equal(r.paydownSum, 0);
});

test('routeDeltasByClassification: a split on a NEW account works too', () => {
  const prev = new Map();
  const curr = new Map([['newcard', 600]]);
  const r = routeDeltasByClassification(prev, curr, {
    newcard: { preexisting: 500, purchase: 100 },
  });
  assert.equal(r.baselineBump, 500);
  assert.equal(r.newDebtSum, 100);
});
