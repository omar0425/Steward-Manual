'use strict';

// Per-account reconcile stamp (last_verified_at): the ✓ tick endpoint, the
// /status join, and preservation across the delete+reinsert in
// replaceDebtAccountBalances (unchanged balances keep their stamp; changed or
// new balances are stamped by the save itself).

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { resetAllGameState, withUser, exportUserData } = require('../db');

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

async function statusLines(baseUrl) {
  const res = await fetch(`${baseUrl}/api/status`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const lines = data.stats && data.stats.debtAccountLines;
  assert.ok(Array.isArray(lines), 'status should include debtAccountLines');
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  return byId;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.beforeEach(() => {
  withUser(0, resetAllGameState);
});

test('verify endpoint stamps an account and /status reports it', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 16500,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 4500 },
        { id: 'loan', name: 'Car Loan', balance: 12000 },
      ],
    });
    assert.equal(res.status, 200);

    // New accounts are stamped by the save itself (entering the number IS a check).
    let lines = await statusLines(baseUrl);
    assert.ok(lines.get('visa').lastVerifiedAt, 'new account should carry a stamp');
    assert.ok(lines.get('loan').lastVerifiedAt, 'new account should carry a stamp');

    await sleep(10);
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 'visa' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(Number.isFinite(Date.parse(data.verifiedAt)), 'verifiedAt must be an ISO timestamp');

    lines = await statusLines(baseUrl);
    assert.equal(lines.get('visa').lastVerifiedAt, data.verifiedAt);
  });
});

test('verify endpoint rejects bad input', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/debt-account/verify', {});
    assert.equal(res.status, 400);
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 42 });
    assert.equal(res.status, 400);
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 'nope-never-tracked' });
    assert.equal(res.status, 404);
  });
});

test('a save preserves stamps on unchanged accounts and re-stamps changed ones', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 16500,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 4500 },
        { id: 'loan', name: 'Car Loan', balance: 12000 },
      ],
    });
    assert.equal(res.status, 200);

    await sleep(10);
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 'visa' });
    assert.equal(res.status, 200);
    const visaStamp = (await res.json()).verifiedAt;
    const loanStampBefore = (await statusLines(baseUrl)).get('loan').lastVerifiedAt;

    // Pay down the loan only; the visa row rides along unchanged.
    await sleep(10);
    res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 15500,
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 4500 },
        { id: 'loan', name: 'Car Loan', balance: 11000 },
      ],
    });
    assert.equal(res.status, 200);

    const lines = await statusLines(baseUrl);
    assert.equal(
      lines.get('visa').lastVerifiedAt, visaStamp,
      'unchanged balance must keep its reconcile stamp across the save',
    );
    assert.notEqual(
      lines.get('loan').lastVerifiedAt, loanStampBefore,
      'changed balance must be re-stamped by the save',
    );
    assert.ok(
      Date.parse(lines.get('loan').lastVerifiedAt) > Date.parse(loanStampBefore),
      'changed-balance stamp must move forward in time',
    );
  });
});

test('verify does not create a snapshot or touch climb metrics', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 4500,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 4500 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    const before = await (await fetch(`${baseUrl}/api/status`)).json();
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 'visa' });
    assert.equal(res.status, 200);
    const after = await (await fetch(`${baseUrl}/api/status`)).json();

    assert.equal(after.meta.lastSnapshotAt, before.meta.lastSnapshotAt, 'no new snapshot');
    assert.equal(
      after.stats.cumulativePaidDown, before.stats.cumulativePaidDown,
      'paydown totals untouched',
    );
  });
});

test('export includes lastVerifiedAt so a restore round-trips the stamps', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 4500,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 4500 }],
    });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/debt-account/verify', { id: 'visa' });
    assert.equal(res.status, 200);
    const { verifiedAt } = await res.json();

    const exported = withUser(0, exportUserData);
    const visa = exported.debtAccountBalances.find((b) => b.accountId === 'visa');
    assert.ok(visa, 'export should include the account');
    assert.equal(visa.lastVerifiedAt, verifiedAt);
  });
});
