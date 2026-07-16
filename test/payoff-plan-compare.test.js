'use strict';

/** Route test for GET /api/payoff-plan/compare — JSON comparison + CPLEX .lp export. */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { withUser, resetAllGameState } = require('../db');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

async function postJson(baseUrl, urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test.beforeEach(() => { withUser(0, resetAllGameState); });

async function seed(baseUrl) {
  let res = await postJson(baseUrl, '/api/snapshot', {
    debtAccounts: [
      { id: 'card-a', name: 'Big Card', balance: 8000 },
      { id: 'card-b', name: 'Promo Card', balance: 1500 },
    ],
  });
  assert.equal(res.status, 200);
  res = await postJson(baseUrl, '/api/config/interest-rates', { rates: { 'card-a': 12, 'card-b': 0 } });
  assert.equal(res.status, 200);
  res = await postJson(baseUrl, '/api/config/debt-terms', {
    terms: { 'card-b': { promoEndsOn: '2099-01-01', postPromoApr: 29.99, minPayment: 25 } },
  });
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.equal(saved.terms['card-b'].promoEndsOn, '2099-01-01', 'promo fields persist');
  assert.equal(saved.terms['card-b'].postPromoApr, 29.99);
}

test('payoff-plan/compare: returns all four strategies with sane shape', async () => {
  await withApp(async (baseUrl) => {
    await seed(baseUrl);
    const res = await fetch(`${baseUrl}/api/payoff-plan/compare?budget=500`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.totalDebt, 9500);
    assert.equal(body.strategies.length, 4);
    const names = body.strategies.map((s) => s.strategy);
    assert.deepEqual(names, ['avalanche', 'snowball', 'promo-aware', 'optimal-lp']);
    for (const s of body.strategies) {
      assert.ok(s.debtFree, `${s.strategy} reaches debt-free at $500/mo`);
      assert.ok(Number.isFinite(s.totalInterest));
      assert.ok(Array.isArray(s.firstMonth) && s.firstMonth.length > 0, `${s.strategy} has a first-month plan`);
    }
    assert.equal(body.promoCliffs.length, 1);
  });
});

test('payoff-plan/compare: format=lp downloads a CPLEX LP model', async () => {
  await withApp(async (baseUrl) => {
    await seed(baseUrl);
    const res = await fetch(`${baseUrl}/api/payoff-plan/compare?budget=500&format=lp`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.match(res.headers.get('content-disposition'), /steward-payoff-model\.lp/);
    const lp = await res.text();
    assert.match(lp, /^\\ Steward Strategy Lab/);
    assert.match(lp, /Minimize[\s\S]*Subject To[\s\S]*Bounds[\s\S]*End/);
  });
});

test('payoff-plan/compare: rejects a missing or absurd budget', async () => {
  await withApp(async (baseUrl) => {
    await seed(baseUrl);
    for (const q of ['', '?budget=0', '?budget=-5', '?budget=notanumber']) {
      const res = await fetch(`${baseUrl}/api/payoff-plan/compare${q}`);
      assert.equal(res.status, 400, `rejected: "${q}"`);
    }
  });
});
