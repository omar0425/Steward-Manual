'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');

// A tiny "origin" server standing in for Dropbox: serves a fake clip with range
// support, so the proxy route can be tested without any external network.
const CLIP = Buffer.from('FAKE-MP4-BYTES-0123456789-abcdef');

function startOrigin() {
  const app = express();
  app.get('/clip.mp4', (req, res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = range[2] ? parseInt(range[2], 10) : CLIP.length - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${CLIP.length}`);
      res.setHeader('Content-Length', end - start + 1);
      return res.end(CLIP.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', CLIP.length);
    res.end(CLIP);
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function startApp(username) {
  const app = express();
  if (username !== undefined) {
    app.use((req, res, next) => { req.user = { userId: 1, username }; next(); });
  }
  app.use('/api', apiRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

let origin;
test.before(async () => {
  origin = await startOrigin();
  process.env.STEWARD_CUTSCENE_VIDEOS = `http://127.0.0.1:${origin.port}/clip.mp4`;
});
test.after(async () => {
  delete process.env.STEWARD_CUTSCENE_VIDEOS;
  await new Promise((r) => origin.server.close(r));
});

async function withApp(username, fn) {
  const { server, baseUrl } = await startApp(username);
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

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

test('GET /api/cutscene/video: proxies the clip to the cutscene user', async () => {
  await withApp('LoudFlipFlopz', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(buf, CLIP);
  });
});

test('GET /api/cutscene/video: forwards range requests (206) for the cutscene user', async () => {
  await withApp('LoudFlipFlopz', async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cutscene/video`, { headers: { Range: 'bytes=0-4' } });
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 0-4/${CLIP.length}`);
    assert.deepEqual(buf, CLIP.subarray(0, 5));
  });
});
