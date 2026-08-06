'use strict';

// Cutscene firing v3: every real action by the cutscene user arms one play
// (saves, start-game, APRs/terms, commitment, verify, reclassify), with
// no-repeat clip rotation. The v2 accumulator survives as pure math below —
// still exported, still tested — but the routes no longer gate on it.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { withUser, resetAllGameState, getConfig } = require('../db');
const {
  cutsceneThreshold,
  accumulateCutsceneProgress,
  nextCutsceneIndex,
  CUTSCENE_USERNAME,
} = require('../services/cutscene');

// ── Pure math ─────────────────────────────────────────────────────────────────

test('cutsceneThreshold scales with remaining debt between $100 and $500', () => {
  assert.equal(cutsceneThreshold(50000), 500); // capped at $500
  assert.equal(cutsceneThreshold(5000), 500);  // 10% = 500, exactly the cap
  assert.equal(cutsceneThreshold(3000), 300);  // 10% band
  assert.equal(cutsceneThreshold(800), 100);   // floored at $100
  assert.equal(cutsceneThreshold(0), 100);
  assert.equal(cutsceneThreshold(NaN), 100);
});

test('accumulator: split payments earn the same reward as one big one', () => {
  // Two $300 saves at $10k debt (threshold $500): first banks, second fires.
  let r = accumulateCutsceneProgress(0, 300, 10000);
  assert.equal(r.fire, false);
  assert.equal(r.bucket, 300);
  r = accumulateCutsceneProgress(r.bucket, 300, 10000);
  assert.equal(r.fire, true);
  assert.equal(r.bucket, 100, 'remainder past the threshold carries over');
});

test('accumulator: debt increases never drain banked credit', () => {
  let r = accumulateCutsceneProgress(400, -250, 10000); // balances grew this save
  assert.equal(r.fire, false);
  assert.equal(r.bucket, 400, 'negative drop leaves the bucket untouched');
});

test('accumulator: garbage bucket state self-heals', () => {
  const r = accumulateCutsceneProgress(NaN, 600, 10000);
  assert.equal(r.fire, true);
  assert.equal(r.bucket, 100);
});

test('rotation: alternates and self-heals from bad state', () => {
  assert.equal(nextCutsceneIndex(null, 2), 0);
  assert.equal(nextCutsceneIndex(0, 2), 1);
  assert.equal(nextCutsceneIndex(1, 2), 0);
  assert.equal(nextCutsceneIndex(99, 2), 0);  // out of range → restart
  assert.equal(nextCutsceneIndex(0, 0), null); // empty pool
});

// ── Route integration (fake authenticated cutscene user) ─────────────────────

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

async function saveDebt(baseUrl, balance) {
  const res = await fetch(`${baseUrl}/api/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ totalDebt: balance, debtAccounts: [{ id: 'visa', name: 'Visa', balance }] }),
  });
  assert.equal(res.status, 200);
}

async function cutsceneReady(baseUrl) {
  const s = await (await fetch(`${baseUrl}/api/status`)).json();
  return s.cutsceneReady === true;
}

test.beforeEach(() => {
  withUser(1, resetAllGameState);
});

test('route: every save arms; seen clears; rotation advances per arm', async () => {
  // NOTE: assertions go through the API (cutsceneReady) wherever possible —
  // the shared-process test runner leaks other files' root hooks (e.g. the
  // cutscene-route suite overrides STEWARD_CUTSCENE_VIDEOS to a 1-clip pool),
  // so rotation expectations are computed from the RUNTIME pool length.
  const { cutsceneVideos } = require('../services/cutscene');
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    // The very first setup save is already an action — it arms.
    await saveDebt(baseUrl, 10000);
    assert.equal(await cutsceneReady(baseUrl), true, 'a setup save arms the cutscene');
    assert.equal(withUser(1, () => getConfig('cutscene_next_index')), '0');

    // Watching it clears the flag — but the PIN must survive: the client
    // posts cutscene-seen the moment the player opens, and the <video> keeps
    // issuing range requests afterward. Clearing the pin here made
    // pause→resume resolve to a different clip mid-stream (broken playback).
    // The stale pin is overwritten by the next arm.
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), false);
    assert.equal(withUser(1, () => getConfig('cutscene_last_index')), '0');
    assert.equal(
      withUser(1, () => getConfig('cutscene_next_index')), '0',
      'pinned clip index must survive cutscene-seen so mid-playback range requests stay on the same file',
    );

    // Starting the climb is an action → arms, and rotation advances (with a
    // 2-clip pool that's clip 1; a 1-clip pool can only re-pick 0 — derive
    // from whatever pool is active).
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), true, 'start-game arms the cutscene');
    const poolLen = cutsceneVideos().length;
    assert.equal(
      withUser(1, () => getConfig('cutscene_next_index')),
      String(1 % poolLen),
    );
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });

    // A small paydown — under the old $500 threshold — still arms: the
    // reward follows the action now, not the amount.
    await saveDebt(baseUrl, 9900);
    assert.equal(await cutsceneReady(baseUrl), true, 'any successful save arms, regardless of amount');
  });
});

test('route: APRs, terms, commitment, reclassify, and verify all arm', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    const seen = () => fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    await seen();

    const post = (path, body) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const arms = [
      ['/config/interest-rates', { rates: { visa: 24.99 } }],
      ['/config/debt-terms', { terms: { visa: { minPayment: 35, dueDay: 12 } } }],
      ['/config/promise', { text: 'Out of the pit this year.' }],
      ['/debt-account/verify', { id: 'visa' }],
    ];
    for (const [path, body] of arms) {
      const res = await post(path, body);
      assert.equal(res.status, 200, `${path} succeeds`);
      assert.equal(await cutsceneReady(baseUrl), true, `${path} arms the cutscene`);
      await seen();
    }

    // Reclassify needs "new debt added" on the books: raise a balance as a
    // purchase first — a backslide, so that save must NOT arm — then the
    // correction (moving it to interest) does.
    const up = await post('/snapshot', {
      totalDebt: 10200,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 10200 }],
      classifications: { visa: 'purchase' },
    });
    assert.equal(up.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'a spending increase must not arm');
    const rec = await post('/climb/reclassify-added-debt', { amount: 200, kind: 'interest' });
    assert.equal(rec.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'reclassify arms the cutscene');
  });
});

test('route: backsliding saves never arm — the reel is a reward, not a laugh track', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    const post = (path, body) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const seen = () => fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    const save = (balance, classifications) => post('/snapshot', {
      totalDebt: balance,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance }],
      ...(classifications ? { classifications } : {}),
    });

    await save(10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await seen();

    // Interest posted → balance up → no video.
    let res = await save(10040, { visa: 'interest' });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'an interest increase must not arm');

    // A new loan → up → no video.
    res = await save(10240, { visa: 'new_loan' });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'a new-loan increase must not arm');

    // Forgot-to-log debt is bookkeeping, not backsliding → still worthy.
    res = await save(10440, { visa: 'preexisting' });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'a preexisting correction still arms');
    await seen();

    // A flat confirm check-in is the habit itself → worthy.
    res = await save(10440);
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'a flat check-in still arms');
    await seen();

    // Net movement decides a mixed pull: a real payment that outweighs the
    // interest that posted alongside it still earns the moment.
    res = await post('/snapshot', {
      totalDebt: 9975,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 9975 }],
      classifications: {},
    });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'a net paydown arms');
  });
});

test('route: passive reads and seen-acks never arm', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    // Reading status / config endpoints must not re-arm — otherwise the
    // dashboard's own polling would loop the video forever.
    await fetch(`${baseUrl}/api/status`);
    await fetch(`${baseUrl}/api/config/interest-rates`);
    await fetch(`${baseUrl}/api/config/promise`);
    assert.equal(await cutsceneReady(baseUrl), false, 'reads must not arm');
  });
});

test('route: cutscene-seen is idempotent — double delivery clears once and stays clear', async () => {
  // The client now sends "seen" via a keepalive POST AND a pagehide sendBeacon
  // backup, so on a backgrounded phone BOTH can land. Two deliveries must be
  // harmless and leave the flag cleared (this is what stops the replay).
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await saveDebt(baseUrl, 9400); // $600 → arms the cutscene
    assert.equal(await cutsceneReady(baseUrl), true);

    const first = await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'first delivery clears the flag');

    const second = await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    assert.equal(second.status, 200, 'a redundant second delivery is accepted, not an error');
    assert.equal(await cutsceneReady(baseUrl), false, 'flag stays cleared — no replay');
  });
});

test('route: pause→resume serves the SAME clip after cutscene-seen (byte-level)', async () => {
  // Repro of the user-reported bug: the client posts cutscene-seen when the
  // player OPENS; every pause→resume then issues a fresh range request. With
  // a 2-clip pool, un-pinning on seen made the fallback resolve to the OTHER
  // clip — different bytes mid-stream, playback never recovers.
  const clipA = Buffer.from('CLIP-A-' + 'a'.repeat(64));
  const clipB = Buffer.from('CLIP-B-' + 'b'.repeat(64));
  const origin = express();
  origin.get('/a.mp4', (req, res) => { res.setHeader('Content-Type', 'video/mp4'); res.end(clipA); });
  origin.get('/b.mp4', (req, res) => { res.setHeader('Content-Type', 'video/mp4'); res.end(clipB); });
  const originSrv = await new Promise((resolve) => { const s = origin.listen(0, () => resolve(s)); });
  const port = originSrv.address().port;
  const envBefore = process.env.STEWARD_CUTSCENE_VIDEOS;
  process.env.STEWARD_CUTSCENE_VIDEOS = `http://127.0.0.1:${port}/a.mp4,http://127.0.0.1:${port}/b.mp4`;
  try {
    await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
      await saveDebt(baseUrl, 10000);
      await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
      await saveDebt(baseUrl, 9400); // $600 → fires, pins a clip
      assert.equal(await cutsceneReady(baseUrl), true);

      const first = Buffer.from(await (await fetch(`${baseUrl}/api/cutscene/video?v=1`)).arrayBuffer());
      // Player opened → client consumes the trigger immediately.
      await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
      // User pauses, then resumes → browser re-requests the stream.
      const resumed = Buffer.from(await (await fetch(`${baseUrl}/api/cutscene/video?v=1`)).arrayBuffer());
      assert.ok(first.equals(resumed), 'resume must stream the same clip that started playing');
    });
  } finally {
    if (envBefore === undefined) delete process.env.STEWARD_CUTSCENE_VIDEOS;
    else process.env.STEWARD_CUTSCENE_VIDEOS = envBefore;
    await new Promise((r) => originSrv.close(r));
  }
});

test('route: never fires for other users, no matter what they do', async () => {
  await withApp('SomebodyElse', async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    assert.equal(await cutsceneReady(baseUrl), false, 'saves never arm for other accounts');
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), false, 'start-game never arms for other accounts');
    await saveDebt(baseUrl, 4000); // even a $6,000 paydown
    assert.equal(await cutsceneReady(baseUrl), false);
    const rates = await fetch(`${baseUrl}/api/config/interest-rates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rates: { visa: 19.99 } }),
    });
    assert.equal(rates.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'APR saves never arm for other accounts');
  });
});

test('route: a split rise counts only its non-preexisting shares against the reel', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    const post = (path, body) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const seen = () => fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });

    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await seen();

    // Up $80 = $30 interest + $50 spending → real backslide → no video.
    let res = await post('/snapshot', {
      totalDebt: 10080,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 10080 }],
      classifications: { visa: { interest: 30, purchase: 50 } },
    });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'an interest+purchase split must not arm');

    // Up $200 = $190 forgot-to-log + $10 interest → the $10 is the only real
    // movement against them, and nothing offsets it → still quiet.
    res = await post('/snapshot', {
      totalDebt: 10280,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 10280 }],
      classifications: { visa: { preexisting: 190, interest: 10 } },
    });
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false);

    // A $100 payment while $20 of split interest posts elsewhere → net win → video.
    res = await post('/snapshot', {
      totalDebt: 10200,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 10200 }],
      classifications: { visa: { interest: 20, preexisting: 20 } },
    });
    // 10280 → 10200 is a $80 net drop with a $40 classified rise inside it?
    // No — one account: the balance FELL $80, so there is nothing to classify;
    // classifications on a decrease are ignored and the drop arms.
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'a net paydown still arms');
  });
});
