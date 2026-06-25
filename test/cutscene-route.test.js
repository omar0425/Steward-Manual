'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { DEFAULT_CUTSCENE_VIDEOS } = require('../services/cutscene');

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

test('GET /api/cutscene/video: 404 for an anonymous request', async () => {
  await withApp(undefined, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`, { redirect: 'manual' });
    await res.arrayBuffer();
    assert.equal(res.status, 404);
  });
});

test('GET /api/cutscene/video: 404 for a non-cutscene user (private)', async () => {
  await withApp('SomeoneElse', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`, { redirect: 'manual' });
    await res.arrayBuffer();
    assert.equal(res.status, 404);
  });
});

test('GET /api/cutscene/video: redirects the cutscene user to a pool clip', async () => {
  await withApp('LoudFlipFlopz', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`, { redirect: 'manual' });
    await res.arrayBuffer();
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(DEFAULT_CUTSCENE_VIDEOS.includes(loc), `unexpected redirect target: ${loc}`);
  });
});
