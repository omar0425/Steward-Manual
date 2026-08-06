'use strict';

// Cutscene firing v4 — the original contract, restored and corrected: ONE
// check-in that pays down $500+ NET (interest/spending in the same pull count
// against; forgot-to-log is neutral) arms one play, with no-repeat clip
// rotation. Nothing else arms — not setup saves, not start-game, not config
// writes. The v2 accumulator survives as pure math below — still exported,
// still tested — but the routes no longer gate on it.

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

test('route: one check-in paying down $500+ arms; $499 does not; seen clears and rotation advances', async () => {
  // NOTE: assertions go through the API (cutsceneReady) wherever possible —
  // the shared-process test runner leaks other files' root hooks (e.g. the
  // cutscene-route suite overrides STEWARD_CUTSCENE_VIDEOS to a 1-clip pool),
  // so rotation expectations are computed from the RUNTIME pool length.
  const { cutsceneVideos } = require('../services/cutscene');
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    assert.equal(await cutsceneReady(baseUrl), false, 'setup saves never arm');
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), false, 'start-game never arms');

    // $499 in one check-in → under the line → quiet.
    await saveDebt(baseUrl, 9501);
    assert.equal(await cutsceneReady(baseUrl), false, 'a $499 paydown stays quiet');

    // $501 in ONE check-in → the reward. First fire pins clip 0.
    await saveDebt(baseUrl, 9000);
    assert.equal(await cutsceneReady(baseUrl), true, 'a $500+ paydown arms');
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

    // The next $500+ check-in advances the rotation (with a 2-clip pool that
    // is clip 1; a 1-clip pool can only re-pick 0 — derive from the pool).
    await saveDebt(baseUrl, 8400);
    assert.equal(await cutsceneReady(baseUrl), true);
    const poolLen = cutsceneVideos().length;
    assert.equal(
      withUser(1, () => getConfig('cutscene_next_index')),
      String(1 % poolLen),
    );
  });
});

test('route: split payments under $500 each never fire — the reward is per check-in, not cumulative', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    // Three $300 check-ins: $900 total, but never $500 at a time → quiet.
    for (const bal of [9700, 9400, 9100]) {
      await saveDebt(baseUrl, bal);
      assert.equal(await cutsceneReady(baseUrl), false, `paying to ${bal} must not arm`);
    }
  });
});

test('route: the $500 is NET — interest and spending in the same pull count against it', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    const post = (path, body) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const save = (accounts, classifications) => post('/snapshot', {
      totalDebt: accounts.reduce((s, a) => s + a.balance, 0),
      debtAccounts: accounts,
      ...(classifications ? { classifications } : {}),
    });

    await save([{ id: 'visa', name: 'Visa', balance: 6000 }, { id: 'mc', name: 'MC', balance: 4000 }]);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });

    // Paid $600 on the Visa while $150 of interest hit the MC → net $450 → quiet.
    let res = await save(
      [{ id: 'visa', name: 'Visa', balance: 5400 }, { id: 'mc', name: 'MC', balance: 4150 }],
      { mc: 'interest' },
    );
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'net $450 must not arm');

    // Paid $560 while $50 of interest posted → net $510 → the reward.
    res = await save(
      [{ id: 'visa', name: 'Visa', balance: 4840 }, { id: 'mc', name: 'MC', balance: 4200 }],
      { mc: 'interest' },
    );
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'net $510 arms');
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });

    // Pure backslide — interest and spending only — must never arm, and one
    // account dropping while the total grows must not either (the old
    // credited-drop flaw that made the reel fire on growth turns).
    res = await save(
      [{ id: 'visa', name: 'Visa', balance: 4772 }, { id: 'mc', name: 'MC', balance: 4369 }],
      { mc: { interest: 84, purchase: 85 } },
    );
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), false, 'a net-growth turn must not arm even when one account fell');

    // Forgot-to-log debt is neutral: a $500 payment alongside a $2,000
    // preexisting correction still earns the moment.
    res = await save(
      [{ id: 'visa', name: 'Visa', balance: 4272 }, { id: 'mc', name: 'MC', balance: 6369 }],
      { mc: 'preexisting' },
    );
    assert.equal(res.status, 200);
    assert.equal(await cutsceneReady(baseUrl), true, 'preexisting corrections do not eat the reward');
  });
});

test('route: config saves, verify, reclassify, and reads never arm', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    const post = (path, body) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });

    const nonArms = [
      ['/config/interest-rates', { rates: { visa: 24.99 } }],
      ['/config/debt-terms', { terms: { visa: { minPayment: 35, dueDay: 12 } } }],
      ['/config/promise', { text: 'Out of the pit this year.' }],
      ['/debt-account/verify', { id: 'visa' }],
    ];
    for (const [path, body] of nonArms) {
      const res = await post(path, body);
      assert.equal(res.status, 200, `${path} succeeds`);
      assert.equal(await cutsceneReady(baseUrl), false, `${path} must not arm`);
    }

    // Reads and seen-acks are inert too.
    await fetch(`${baseUrl}/api/status`);
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), false);
  });
});

test('route: cutscene-seen is idempotent — double delivery clears once and stays clear', async () => {
  // The client sends "seen" via a keepalive POST AND a pagehide sendBeacon
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

test('route: never fires for other users, no matter the drop', async () => {
  await withApp('SomebodyElse', async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await saveDebt(baseUrl, 4000); // $6,000 in one save
    assert.equal(await cutsceneReady(baseUrl), false);
  });
});
