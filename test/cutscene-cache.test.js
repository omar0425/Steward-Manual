'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { cachePathFor, cachedPathIfReady, ensureCached } = require('../services/cutsceneCache');

// A tiny "origin" standing in for Dropbox, with a hit counter so tests can
// prove the cache stops re-fetching.
const CLIP = Buffer.from('CACHED-MP4-BYTES-0123456789-zyxwv');
let hits = 0;

function startOrigin() {
  const app = express();
  app.get('/clip.mp4', (req, res) => {
    hits += 1;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', CLIP.length);
    res.end(CLIP);
  });
  // Lies about length then truncates — a broken/interrupted download.
  app.get('/short.mp4', (req, res) => {
    hits += 1;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', CLIP.length * 2);
    res.end(CLIP);
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

let origin;
let scratchDir;
let prevCacheDir;

test.before(async () => {
  origin = await startOrigin();
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-cutscene-cache-test-'));
  prevCacheDir = process.env.STEWARD_CUTSCENE_CACHE_DIR;
  process.env.STEWARD_CUTSCENE_CACHE_DIR = scratchDir;
});

test.after(async () => {
  if (prevCacheDir === undefined) delete process.env.STEWARD_CUTSCENE_CACHE_DIR;
  else process.env.STEWARD_CUTSCENE_CACHE_DIR = prevCacheDir;
  fs.rmSync(scratchDir, { recursive: true, force: true });
  await new Promise((r) => origin.server.close(r));
});

test('cachePathFor: stable per URL, distinct across URLs, .mp4 extension', () => {
  const a1 = cachePathFor('http://x/clip-a.mp4');
  const a2 = cachePathFor('http://x/clip-a.mp4');
  const b = cachePathFor('http://x/clip-b.mp4');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.endsWith('.mp4'));
});

test('ensureCached: downloads once, then serves from disk with no re-fetch', async () => {
  const url = `http://127.0.0.1:${origin.port}/clip.mp4`;
  assert.equal(cachedPathIfReady(url), null);

  const before = hits;
  const p1 = await ensureCached(url);
  assert.ok(p1, 'first ensureCached resolves a path');
  assert.deepEqual(fs.readFileSync(p1), CLIP);
  assert.equal(hits, before + 1);

  // Warm now: resolves instantly to the same path, origin untouched.
  const p2 = await ensureCached(url);
  assert.equal(p2, p1);
  assert.equal(hits, before + 1);
  assert.equal(cachedPathIfReady(url), p1);
});

test('ensureCached: concurrent callers share a single download', async () => {
  const url = `http://127.0.0.1:${origin.port}/clip.mp4?copy=2`;
  const before = hits;
  const [p1, p2, p3] = await Promise.all([ensureCached(url), ensureCached(url), ensureCached(url)]);
  assert.ok(p1 && p1 === p2 && p2 === p3);
  assert.equal(hits, before + 1);
});

test('ensureCached: a short (truncated) download is rejected and leaves no file', async () => {
  const url = `http://127.0.0.1:${origin.port}/short.mp4`;
  const p = await ensureCached(url);
  assert.equal(p, null, 'resolves null rather than rejecting');
  assert.equal(cachedPathIfReady(url), null, 'no partial file is ever visible as cached');
  const leftovers = fs.readdirSync(scratchDir).filter((f) => f.includes('.part'));
  assert.deepEqual(leftovers, [], 'temp .part file cleaned up');
});
