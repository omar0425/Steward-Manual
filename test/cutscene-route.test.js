'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const apiRouter = require('../routes/api');

// Mounts the api router with an optional injected user, mimicking the session
// middleware server.js applies ahead of it.
function startApp(username) {
  const app = express();
  if (username !== undefined) {
    app.use((req, res, next) => { req.user = { userId: 1, username }; next(); });
  }
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(username, fn) {
  const { server, baseUrl } = await startApp(username);
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

// A tiny on-disk fixture standing in for media/cutscene.mp4.
const FIXTURE = path.join(os.tmpdir(), `cutscene-fixture-${process.pid}.mp4`);
const FIXTURE_BYTES = Buffer.from('FAKEMP4DATA-0123456789');

test.before(() => {
  fs.writeFileSync(FIXTURE, FIXTURE_BYTES);
  process.env.STEWARD_CUTSCENE_VIDEO = FIXTURE;
});
test.after(() => {
  delete process.env.STEWARD_CUTSCENE_VIDEO;
  try { fs.unlinkSync(FIXTURE); } catch (_) { /* ignore */ }
});

test('GET /api/cutscene/video: 404 for an anonymous request', async () => {
  await withApp(undefined, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`);
    await res.arrayBuffer();
    assert.equal(res.status, 404);
  });
});

test('GET /api/cutscene/video: 404 for a non-cutscene user (private)', async () => {
  await withApp('SomeoneElse', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`);
    await res.arrayBuffer();
    assert.equal(res.status, 404);
  });
});

test('GET /api/cutscene/video: serves the clip to the cutscene user', async () => {
  await withApp('LoudFlipFlopz', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(buf.length, FIXTURE_BYTES.length);
  });
});

test('GET /api/cutscene/video: honors range requests for the cutscene user', async () => {
  await withApp('LoudFlipFlopz', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`, { headers: { Range: 'bytes=0-4' } });
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 0-4/${FIXTURE_BYTES.length}`);
    assert.equal(buf.length, 5);
    assert.deepEqual(buf, FIXTURE_BYTES.subarray(0, 5));
  });
});
