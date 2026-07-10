'use strict';

// Steward Chat: validation, history/note persistence, and the context payload
// additions (payment terms + situation note + memories). Chat is available to
// every authenticated user (the old single-account beta gate is gone). Model
// calls are never made here — the suite runs keyless, so the configured-check
// paths are what's exercised.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { withUser, resetAllGameState, getConfig } = require('../db');
const { CUTSCENE_USERNAME } = require('../services/cutscene');
const stewardAiContext = require('../services/stewardAiContext');

function startApp(username) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { userId: 1, username }; next(); });
  app.use('/api', apiRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function withApp(username, fn) {
  const { server, baseUrl } = await startApp(username);
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedClimb(baseUrl) {
  let res = await postJson(baseUrl, '/api/snapshot', {
    totalDebt: 8000,
    debtAccounts: [
      { id: 'visa', name: 'Visa', balance: 6000 },
      { id: 'med', name: 'Medical', balance: 2000 },
    ],
  });
  assert.equal(res.status, 200);
  res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
  assert.equal(res.status, 200);
}

test.beforeEach(() => {
  withUser(1, resetAllGameState);
});

test('chat: available to every authenticated user (beta gate removed)', async () => {
  await withApp('SomebodyElse', async (baseUrl) => {
    const probe = await fetch(`${baseUrl}/api/steward-ai/chat`);
    assert.equal(probe.status, 200);
    const body = await probe.json();
    assert.equal(body.beta, true, 'chat is on for everyone now');
    assert.deepEqual(body.messages, []);
    assert.deepEqual(body.memories, []);
    // The write surface exists for them too (keyless → honest 503, not 404).
    assert.equal((await postJson(baseUrl, '/api/steward-ai/chat', { message: 'hi' })).status, 503);
    assert.equal((await fetch(`${baseUrl}/api/steward-ai/chat/clear`, { method: 'POST' })).status, 200);
    assert.equal((await postJson(baseUrl, '/api/steward-ai/situation-note', { note: 'x' })).status, 200);
  });
});

test('chat: beta user gets state; message validation; keyless → 503', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    const state = await (await fetch(`${baseUrl}/api/steward-ai/chat`)).json();
    assert.equal(state.ok, true);
    assert.deepEqual(state.messages, []);
    assert.equal(state.situationNote, '');
    assert.equal(typeof state.enabled, 'boolean');

    let res = await postJson(baseUrl, '/api/steward-ai/chat', { message: '' });
    assert.equal(res.status, 400);
    res = await postJson(baseUrl, '/api/steward-ai/chat', { message: 'x'.repeat(1501) });
    assert.equal(res.status, 400);
    // No ANTHROPIC_API_KEY in tests → the route refuses honestly and, crucially,
    // does NOT record the message into history.
    res = await postJson(baseUrl, '/api/steward-ai/chat', { message: 'What should I do with $1000?' });
    assert.equal(res.status, 503);
    const after = await (await fetch(`${baseUrl}/api/steward-ai/chat`)).json();
    assert.deepEqual(after.messages, [], 'a refused message must not pollute the thread');
  });
});

test('chat: situation note round-trips, caps at 2000, and clear wipes the thread', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/steward-ai/situation-note', {
      note: '  Missed two Visa payments in June; back to full hours now. ',
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).situationNote, 'Missed two Visa payments in June; back to full hours now.');

    res = await postJson(baseUrl, '/api/steward-ai/situation-note', { note: 'y'.repeat(5000) });
    assert.equal((await res.json()).situationNote.length, 2000);

    res = await postJson(baseUrl, '/api/steward-ai/situation-note', { note: 42 });
    assert.equal(res.status, 400);

    assert.equal((await fetch(`${baseUrl}/api/steward-ai/chat/clear`, { method: 'POST' })).status, 200);
    const state = await (await fetch(`${baseUrl}/api/steward-ai/chat`)).json();
    assert.deepEqual(state.messages, []);
  });
});

test('context payload carries payment terms and the situation note', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await seedClimb(baseUrl);
    await postJson(baseUrl, '/api/config/debt-terms', {
      terms: { visa: { minPayment: 150, dueDay: 21 }, med: { dueDay: 5 } },
    });
    await postJson(baseUrl, '/api/steward-ai/situation-note', { note: 'Missed June and July payments; have an extra $1000.' });

    const ctx = withUser(1, () => stewardAiContext.buildContext());
    assert.equal(ctx.skip, false, 'active climb must produce a payload');
    assert.ok(ctx.payload.terms, 'terms block present');
    assert.equal(ctx.payload.terms.minimumsMonthly, 150);
    const visa = ctx.payload.terms.accounts.find((a) => a.name === 'Visa');
    assert.equal(visa.minPayment, 150);
    assert.equal(visa.dueDay, 21);
    assert.match(visa.nextDueDate, /^\d{4}-\d{2}-\d{2}$/);
    const med = ctx.payload.terms.accounts.find((a) => a.name === 'Medical');
    assert.equal(med.dueDay, 5);
    assert.equal(ctx.payload.situationNote, 'Missed June and July payments; have an extra $1000.');
  });
});

test('context payload: no terms and no note → clean nulls (prompt stays lean)', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await seedClimb(baseUrl);
    // debt_terms is a user PREFERENCE — resetAllGameState deliberately keeps
    // it (like interest rates), so clear it explicitly for this assertion.
    await postJson(baseUrl, '/api/config/debt-terms', { terms: {} });
    const ctx = withUser(1, () => stewardAiContext.buildContext());
    assert.equal(ctx.skip, false);
    assert.equal(ctx.payload.terms, null);
    assert.equal(ctx.payload.situationNote, null);
  });
});
