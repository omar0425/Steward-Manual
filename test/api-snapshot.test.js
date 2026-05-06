'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { latestSnapshot, resetAllGameState, withUser } = require('../db');

function startApp() {
  const app = express();
  app.use(express.json());
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

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  withUser(0, resetAllGameState);
});

test('POST /api/snapshot: aggregate-only snapshots update climb paydown totals', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 1000,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 800,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.stats.cumulativePaidDown, 200);
    assert.equal(status.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: first saved debts stay in setup until start-game', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 25000 },
      ],
    });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.setupIncomplete, true);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.ready, false);
    assert.equal(body.setupIncomplete, true);
    assert.equal(body.stats.gameStartDebt, null);
    assert.equal(body.stats.debtRemaining, 25000);
    assert.equal(body.stats.debtAccountLines.length, 1);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.tier.id, 'rock_bottom');
    assert.equal(body.stats.gameStartDebt, 25000);
    assert.equal(body.stats.climbBaselineDebt, 25000);
    assert.equal(body.stats.cumulativePaidDown, 0);
  });
});

test('POST /api/snapshot: small starting debts still begin at rock bottom', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2500 },
        { id: 'loan-b', name: 'Loan B', balance: 1800 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.tier.id, 'rock_bottom');
    assert.equal(body.tier.label, 'Buried');
    assert.equal(body.stats.debtRemaining, 4300);
    assert.equal(body.stats.debtTierBandPct, 0);
    assert.equal(body.nextTier.id, 'broke');
    assert.equal(body.nextTier.gapDollars, 477.78);
  });
});

test('POST /api/snapshot: switching from aggregate to accounts does not create fake new debt', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 4300,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2500 },
        { id: 'loan-b', name: 'Loan B', balance: 1800 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.debtRemaining, 4300);
    assert.equal(body.stats.cumulativePaidDown, 0);
    assert.equal(body.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: aggregate to accounts handoff still counts real aggregate delta', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 4300,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2300 },
        { id: 'loan-b', name: 'Loan B', balance: 1700 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.debtRemaining, 4000);
    assert.equal(body.stats.cumulativePaidDown, 300);
    assert.equal(body.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: duplicate debt account ids are rejected before write', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 500,
      debtAccounts: [
        { id: 'card', name: 'Card A', balance: 200 },
        { id: 'card', name: 'Card B', balance: 300 },
      ],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Duplicate debt account id/);
    assert.equal(withUser(0, () => latestSnapshot()), null);
  });
});

test('POST /api/snapshot: negative debt is rejected before write', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: -1,
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'totalDebt cannot be negative');
    assert.equal(withUser(0, () => latestSnapshot()), null);
  });
});
