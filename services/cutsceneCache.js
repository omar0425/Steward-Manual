'use strict';

/**
 * Disk cache for the cutscene clips.
 *
 * The clips are ~85MB remote MP4s (Dropbox). Proxying every byte range through
 * this server on every playback means each seek costs a fresh phone→server→
 * Dropbox round trip (~1s+ each) — on mobile the player's buffer starves and
 * playback freezes in a way scrubbing can't recover. So: download each clip to
 * local disk once, then let Express serve it natively (res.sendFile handles
 * byte ranges), turning playback into a single fast hop.
 *
 * The cache lives in the OS temp dir by default (ephemeral on redeploy — the
 * first playback after a deploy re-warms it). Override with
 * STEWARD_CUTSCENE_CACHE_DIR (tests point it at a scratch dir).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

/* One download per URL at a time, shared across concurrent range requests. */
const _inFlight = new Map();

function cacheDir() {
  const env = process.env.STEWARD_CUTSCENE_CACHE_DIR;
  return env && env.trim() ? env : path.join(os.tmpdir(), 'steward-cutscene-cache');
}

/** Deterministic on-disk path for a clip URL. .mp4 so Express types it right. */
function cachePathFor(url) {
  const hash = crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
  return path.join(cacheDir(), `clip-${hash}.mp4`);
}

/** Absolute path when the clip is fully cached, else null. Never throws. */
function cachedPathIfReady(url) {
  try {
    const p = cachePathFor(url);
    return fs.statSync(p).size > 0 ? p : null;
  } catch {
    return null;
  }
}

async function downloadToCache(url) {
  const dest = cachePathFor(url);
  // pid-suffixed temp name: a crashed writer can't corrupt a later attempt,
  // and the final rename is atomic so readers only ever see complete files.
  const part = `${dest}.part-${process.pid}`;
  await fs.promises.mkdir(cacheDir(), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);
  const expected = Number(res.headers.get('content-length'));
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
    const size = (await fs.promises.stat(part)).size;
    if (Number.isFinite(expected) && expected > 0 && size !== expected) {
      throw new Error(`short download: ${size} of ${expected} bytes`);
    }
  } catch (err) {
    await fs.promises.rm(part, { force: true }).catch(() => {});
    throw err;
  }
  await fs.promises.rename(part, dest);
  return dest;
}

/**
 * Resolve to the cached path, downloading if needed. Concurrent callers for
 * the same URL share one download. Resolves null (never rejects) on failure —
 * callers fall back to proxying.
 */
function ensureCached(url) {
  const ready = cachedPathIfReady(url);
  if (ready) return Promise.resolve(ready);
  if (_inFlight.has(url)) return _inFlight.get(url);
  const p = downloadToCache(url)
    .catch((err) => {
      console.error('[cutscene] cache download failed:', err && err.message ? err.message : err);
      return null;
    })
    .finally(() => _inFlight.delete(url));
  _inFlight.set(url, p);
  return p;
}

module.exports = { cacheDir, cachePathFor, cachedPathIfReady, ensureCached };
