'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { withUser, resetAllGameState } = require('../db');

const DEFAULT_TEST_USER_ID = 777;

function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = Number(req.get('x-test-user-id') || DEFAULT_TEST_USER_ID);
    req.user = { userId };
    next();
  });
  app.use('/api', apiRouter);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function headers(userId = DEFAULT_TEST_USER_ID) {
  return {
    'content-type': 'application/json',
    'x-test-user-id': String(userId),
  };
}

async function getJson(baseUrl, path, userId = DEFAULT_TEST_USER_ID) {
  const res = await fetch(`${baseUrl}${path}`, { headers: headers(userId) });
  return { res, body: await res.json() };
}

async function postJson(baseUrl, path, body = {}, userId = DEFAULT_TEST_USER_ID) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

test('backend state machine: no data -> setup -> active climb -> reset', async () => {
  const userId = 7771;
  withUser(userId, resetAllGameState);

  await withApp(async (baseUrl) => {
    let result = await getJson(baseUrl, '/api/status', userId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.noData, true);
    assert.equal(result.body.setupIncomplete, undefined);

    result = await postJson(baseUrl, '/api/start-game', {}, userId);
    assert.equal(result.res.status, 503);
    assert.equal(result.body.ok, false);

    result = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'test-card-a', name: 'Test Card A', balance: 5000 },
        { id: 'test-loan-b', name: 'Test Loan B', balance: 4000 },
      ],
    }, userId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.setupIncomplete, true);
    assert.equal(result.body.debtRemaining, 9000);

    result = await getJson(baseUrl, '/api/status', userId);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.setupIncomplete, true);
    assert.equal(result.body.stats.debtRemaining, 9000);
    assert.equal(result.body.stats.gameStartDebt, null);
    assert.equal(result.body.stats.debtAccountLines.length, 2);

    result = await postJson(baseUrl, '/api/start-game', {}, userId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.gameStartDebt, 9000);

    result = await getJson(baseUrl, '/api/status', userId);
    assert.equal(result.body.ready, true);
    assert.equal(result.body.tier.id, 'rock_bottom');
    assert.equal(result.body.stats.climbBaselineDebt, 9000);
    assert.equal(result.body.stats.debtRemaining, 9000);
    assert.equal(result.body.stats.debtTierBandPct, 0);
    assert.equal(result.body.nextTier.id, 'broke');
    assert.equal(result.body.nextTier.gapDollars, 1000);

    result = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'test-card-a', name: 'Test Card A', balance: 4500 },
        { id: 'test-loan-b', name: 'Test Loan B', balance: 3500 },
      ],
    }, userId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.setupIncomplete, false);
    assert.equal(result.body.debtRemaining, 8000);

    result = await getJson(baseUrl, '/api/status', userId);
    assert.equal(result.body.ready, true);
    assert.equal(result.body.tier.id, 'broke');
    assert.equal(result.body.stats.debtRemaining, 8000);
    assert.equal(result.body.stats.debtTierJourney.pctAlongJourney, 11.1);
    assert.equal(result.body.stats.debtTierBandPct, 0);
    assert.equal(result.body.nextTier.id, 'struggling');

    result = await postJson(baseUrl, '/api/reset-game', { confirm: true }, userId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.ok, true);

    result = await getJson(baseUrl, '/api/status', userId);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.noData, true);
  });
});

test('backend state machine saves data only for the authenticated test user', async () => {
  const testUserId = 7772;
  const otherUserId = 8882;
  withUser(testUserId, resetAllGameState);
  withUser(otherUserId, resetAllGameState);

  await withApp(async (baseUrl) => {
    let result = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'test-user-card', name: 'Test User Card', balance: 4300 },
      ],
    }, testUserId);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.debtRemaining, 4300);

    result = await getJson(baseUrl, '/api/status', testUserId);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.setupIncomplete, true);
    assert.equal(result.body.stats.debtRemaining, 4300);

    result = await getJson(baseUrl, '/api/status', otherUserId);
    assert.equal(result.body.ready, false);
    assert.equal(result.body.noData, true);
  });
});
