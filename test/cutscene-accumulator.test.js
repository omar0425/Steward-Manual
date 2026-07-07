'use strict';

// Cutscene firing v2: cumulative-paydown accumulator with a debt-scaled
// threshold, carry-over remainder, and no-repeat clip rotation.

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

test('route: accumulates across saves, fires once, rotates clips on seen', async () => {
  // NOTE: assertions go through the API (cutsceneReady) wherever possible —
  // the shared-process test runner leaks other files' root hooks (e.g. the
  // cutscene-route suite overrides STEWARD_CUTSCENE_VIDEOS to a 1-clip pool),
  // so rotation expectations are computed from the RUNTIME pool length.
  const { cutsceneVideos } = require('../services/cutscene');
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });

    // $300 paydown at $9,700 remaining → threshold $500 → banked, no fire.
    await saveDebt(baseUrl, 9700);
    assert.equal(await cutsceneReady(baseUrl), false);

    // Another $300 → crosses $500 → fires; first fire pins clip 0.
    await saveDebt(baseUrl, 9400);
    assert.equal(await cutsceneReady(baseUrl), true);
    assert.equal(withUser(1, () => getConfig('cutscene_next_index')), '0');

    // Watching it clears the flag and rotates the pointer — but the PIN must
    // survive: the client posts cutscene-seen the moment the player opens,
    // and the <video> keeps issuing range requests afterward. Clearing the
    // pin here made pause→resume resolve to a different clip mid-stream
    // (broken playback). The stale pin is overwritten by the next fire.
    await fetch(`${baseUrl}/api/config/cutscene-seen`, { method: 'POST' });
    assert.equal(await cutsceneReady(baseUrl), false);
    assert.equal(withUser(1, () => getConfig('cutscene_last_index')), '0');
    assert.equal(
      withUser(1, () => getConfig('cutscene_next_index')), '0',
      'pinned clip index must survive cutscene-seen so mid-playback range requests stay on the same file',
    );

    // Next fire advances the rotation (with a 2-clip pool that's clip 1; a
    // 1-clip pool can only re-pick 0 — derive from whatever pool is active).
    await saveDebt(baseUrl, 8900); // $500 drop + $100 banked → fires
    assert.equal(await cutsceneReady(baseUrl), true);
    const poolLen = cutsceneVideos().length;
    assert.equal(
      withUser(1, () => getConfig('cutscene_next_index')),
      String(1 % poolLen),
    );
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
    assert.equal(withUser(1, () => getConfig('cutscene_paydown_bucket')), null, 'no bucket is even created');
  });
});

test('route: end-game taper — a $150 payment fires when only $1,200 is left', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 1350);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    // $150 drop, $1,200 remaining → threshold = max(100, 10%·1200) = $120 → fires.
    await saveDebt(baseUrl, 1200);
    assert.equal(await cutsceneReady(baseUrl), true);
  });
});

test('route: undo takes back the banked credit', async () => {
  await withApp(CUTSCENE_USERNAME, async (baseUrl) => {
    await saveDebt(baseUrl, 10000);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    await saveDebt(baseUrl, 9700); // banks $300 (no fire: threshold $500)
    const res = await fetch(`${baseUrl}/api/climb/undo-last`, { method: 'POST' });
    assert.equal(res.status, 200);
    // Behavioral contract: with the $300 credit reverted, another $300 save
    // stays under the threshold — no fire. (Were the bucket NOT reverted,
    // this save would cross $500 and fire.)
    await saveDebt(baseUrl, 9700);
    assert.equal(await cutsceneReady(baseUrl), false, 'undo must revert banked cutscene credit');
  });
});
