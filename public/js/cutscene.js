'use strict';

/* ── Milestone cutscene ─────────────────────────────────────────────────────
   A personal easter egg for LoudFlipFlopz: the server arms a `cutsceneReady`
   flag (status payload) after each real action — a saved check-in, starting
   the climb, APRs & terms, the commitment, a reconcile tick. On the next
   dashboard render we play ONE clip fullscreen, wrapped in Steward chrome,
   then tell the server to clear the flag so each arm plays exactly once.
   A later action re-arms, so one page session can play several — but never
   two at once, and never a replay of a consumed arm.

   The clip is served by the auth-gated route GET /api/cutscene/video, which
   404s everyone but the cutscene user. If playback fails we show a graceful
   themed card instead of a black void.
   ─────────────────────────────────────────────────────────────────────────── */

import { stewardApiUrl } from './api.js';

const VIDEO_SRC = '/api/cutscene/video';
// Re-play guard: after we consume an arm, ignore `cutsceneReady` echoes from
// status responses that were already in flight when we posted "seen".
const REPLAY_GUARD_MS = 8000;
let _lastPlayAt = 0;

function injectStylesOnce() {
  if (document.getElementById('cutscene-style')) return;
  const style = document.createElement('style');
  style.id = 'cutscene-style';
  style.textContent = `
    .cutscene-overlay {
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(4, 6, 12, 0.92); backdrop-filter: blur(6px);
      opacity: 0; transition: opacity .4s ease;
    }
    .cutscene-overlay.cutscene-show { opacity: 1; }
    .cutscene-stage {
      position: relative; display: flex; flex-direction: column;
      width: min(92vw, 960px); max-height: 92vh;
      border: 1px solid var(--gold, #c8a84c); border-radius: 14px;
      background: var(--surface, #12161f);
      box-shadow: 0 20px 80px rgba(0,0,0,0.6); overflow: hidden;
    }
    .cutscene-header {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 14px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
      background: linear-gradient(180deg, rgba(200,168,76,0.12), transparent);
    }
    .cutscene-emblem {
      width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; font-size: 17px; line-height: 1;
      background: var(--gold-soft, rgba(200,168,76,0.14)); border: 1px solid var(--gold, #c8a84c);
    }
    .cutscene-title {
      font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 600;
      color: var(--gold-2, #e3bd72); letter-spacing: 0.01em; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cutscene-skip {
      margin-left: auto; flex-shrink: 0;
      font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-2, #b9b3a6); background: transparent;
      border: 1px solid var(--border-2, rgba(255,255,255,0.18)); border-radius: 999px;
      padding: 6px 14px; cursor: pointer; transition: color .15s ease, border-color .15s ease;
    }
    .cutscene-skip:hover { color: var(--text, #f4efe4); border-color: var(--gold, #c8a84c); }
    .cutscene-body { position: relative; display: flex; background: #000; min-height: 0; }
    .cutscene-video { display: block; width: 100%; height: auto; max-height: 72vh; background: #000; }
    .cutscene-unmute {
      position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3;
      display: inline-flex; align-items: center; gap: 8px;
      font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.06em;
      color: #0a0c14; background: var(--gold, #c8a84c); border: none; border-radius: 999px;
      padding: 9px 18px; cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,0.45);
      transition: background .15s ease;
    }
    .cutscene-unmute:hover { background: var(--gold-2, #e3bd72); }
    .cutscene-footer {
      padding: 10px 16px; border-top: 1px solid var(--border, rgba(255,255,255,0.08));
      font-family: 'Cormorant Garamond', serif; font-size: 14px; font-style: italic;
      color: var(--text-2, #b9b3a6); text-align: center;
    }
    .cutscene-fallback {
      padding: 44px 28px; text-align: center; width: 100%;
      font-family: 'Cormorant Garamond', serif;
    }
    .cutscene-fallback-title { font-size: 22px; font-weight: 600; color: var(--gold-2, #e3bd72); margin-bottom: 8px; }
    .cutscene-fallback-line { font-size: 14px; font-style: italic; color: var(--text-2, #b9b3a6); }
  `;
  document.head.appendChild(style);
}

// Track whether the server has confirmed the "seen" post for this playback, so
// the page-hide backup only fires when it's still needed (and never twice).
let _seenConfirmed = false;

/**
 * Tell the server this cutscene was consumed so it plays exactly once. The old
 * version was a plain fire-and-forget fetch, which mobile browsers routinely
 * kill when the tab is backgrounded mid-clip — leaving the flag armed, so the
 * SAME video replayed on the next sign-on. Now:
 *   - `keepalive: true` lets the request outlive a page/tab teardown, and
 *   - a pagehide/visibilitychange backup re-sends via sendBeacon if the first
 *     attempt hasn't been confirmed yet.
 * Idempotent: the route just sets the flag to 0, so a double-send is harmless.
 */
async function clearFlag() {
  const url = stewardApiUrl('/api/config/cutscene-seen');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    });
    if (res && res.ok) _seenConfirmed = true;
  } catch (_) { /* the pagehide backup below is the safety net */ }
}

// Backup delivery: if the primary POST hasn't been confirmed by the time the
// user backgrounds or closes the tab, sendBeacon queues the "seen" post at the
// OS level so it survives the teardown. Registered once.
let _seenBackupWired = false;
function wireSeenBackup() {
  if (_seenBackupWired) return;
  _seenBackupWired = true;
  const flush = () => {
    if (_seenConfirmed) return;
    try {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(
          stewardApiUrl('/api/config/cutscene-seen'),
          new Blob(['{}'], { type: 'application/json' }),
        );
        if (ok) _seenConfirmed = true;
      } else {
        // No beacon (older browsers) → keepalive fetch is the fallback.
        void clearFlag();
      }
    } catch (_) { /* nothing more we can do */ }
  };
  // pagehide covers tab close + bfcache; visibilitychange→hidden covers the
  // mobile "switched apps" case that was dropping the original request.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function dismiss(overlay, onKey) {
  document.removeEventListener('keydown', onKey);
  overlay.classList.remove('cutscene-show');
  window.setTimeout(() => overlay.remove(), 400);
}

function showCutscene() {
  // Never stack overlays (rapid re-fires of the test trigger, or test + real).
  if (document.querySelector('.cutscene-overlay')) return;
  injectStylesOnce();

  const overlay = document.createElement('div');
  overlay.className = 'cutscene-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'A moment from the Steward');

  // Steward chrome: header (emblem + title + skip) · body (video) · footer line.
  const stage = document.createElement('div');
  stage.className = 'cutscene-stage';
  stage.innerHTML = `
    <div class="cutscene-header">
      <span class="cutscene-emblem" aria-hidden="true">🧐</span>
      <span class="cutscene-title">A moment, well earned.</span>
      <button type="button" class="cutscene-skip">Skip ▸</button>
    </div>
    <div class="cutscene-body"></div>
    <div class="cutscene-footer">Duly noted in the ledger. The climb continues.</div>
  `;

  const body = stage.querySelector('.cutscene-body');
  const skip = stage.querySelector('.cutscene-skip');

  const video = document.createElement('video');
  video.className = 'cutscene-video';
  // One random seed per play: the server resolves it to a single stable clip, so
  // every range request in this playback hits the same file (a per-request random
  // pick corrupts seeking). The seed is unique per play, so it also cache-busts.
  const seed = Math.floor(Math.random() * 1e9);
  video.src = `${stewardApiUrl(VIDEO_SRC)}?v=${seed}`;
  video.setAttribute('playsinline', '');
  video.controls = true;
  video.autoplay = true;
  video.preload = 'auto'; // buffer immediately so it starts the moment it opens
  // Muted autoplay is the only kind browsers allow without a prior user gesture.
  // Without this the clip starts then halts after ~a second. We auto-start muted
  // and offer a one-tap unmute for sound.
  video.muted = true;
  body.appendChild(video);

  // Kick playback as soon as there's enough buffered — a belt-and-suspenders
  // retry on top of the autoplay attribute so nothing waits on a manual press.
  const kick = () => { const pr = video.play(); if (pr && typeof pr.catch === 'function') pr.catch(() => {}); };
  video.addEventListener('loadeddata', kick, { once: true });
  video.addEventListener('canplay', kick, { once: true });

  const unmute = document.createElement('button');
  unmute.type = 'button';
  unmute.className = 'cutscene-unmute';
  unmute.textContent = '🔊 Tap for sound';
  body.appendChild(unmute);
  unmute.addEventListener('click', () => {
    video.muted = false;
    const pr = video.play();
    if (pr && typeof pr.catch === 'function') pr.catch(() => {});
    unmute.remove();
  });
  // If they unmute via the native controls instead, drop our prompt.
  video.addEventListener('volumechange', () => { if (!video.muted) unmute.remove(); });

  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  // Move focus into the modal so keyboard/SR users land inside it (Skip is the
  // safe default target) rather than staying on the page behind the overlay.
  try { skip.focus(); } catch { /* ignore */ }
  requestAnimationFrame(() => overlay.classList.add('cutscene-show'));

  // ── Stall watchdog ──
  // On phones the media pipeline can wedge hard mid-stream (buffer starved on
  // a slow hop): playback freezes and no amount of scrubbing recovers, because
  // the decoder itself is stuck. The only cure is a full load() reset. Watch
  // for "should be playing but the clock isn't moving" for 8s, then reset and
  // resume from the same spot. Capped so a truly dead network can't loop.
  let lastTime = -1;
  let stallSince = 0;
  let recoveries = 0;
  const watchdog = window.setInterval(() => {
    if (video.paused || video.ended || video.seeking || video.readyState === 0) { stallSince = 0; return; }
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; stallSince = 0; return; }
    if (!stallSince) { stallSince = Date.now(); return; }
    if (Date.now() - stallSince < 8000 || recoveries >= 3) return;
    recoveries += 1;
    stallSince = 0;
    const resumeAt = video.currentTime;
    const wasMuted = video.muted;
    video.load();
    video.addEventListener('loadeddata', () => {
      video.muted = wasMuted;
      try { video.currentTime = resumeAt; } catch (_) { /* ignore */ }
      const pr = video.play();
      if (pr && typeof pr.catch === 'function') pr.catch(() => {});
    }, { once: true });
  }, 2000);
  const close = () => { window.clearInterval(watchdog); dismiss(overlay, onKey); };

  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  skip.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  video.addEventListener('ended', close);
  video.addEventListener('error', () => {
    // A seek/abort cancelling an in-flight request fires error code 1
    // (MEDIA_ERR_ABORTED) — that's benign, not a load failure, so don't tear the
    // player down for it.
    if (video.error && video.error.code === 1) return;
    // Keep the chrome; swap just the video area for a graceful card.
    body.innerHTML = `
      <div class="cutscene-fallback">
        <div class="cutscene-fallback-title">🎩 The Steward prepared a moment for you…</div>
        <div class="cutscene-fallback-line">…but the reel couldn't load just now. Press Skip to carry on.</div>
      </div>`;
  });

  // Autoplay-with-sound is often blocked on load; the controls let the user
  // start it manually in that case, so a rejected play() is fine to swallow.
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

/**
 * Called from render() with the status payload. Plays one cutscene per server
 * arm (an action by the cutscene user); a fresh arm later in the same page
 * session plays again once the previous overlay is gone.
 */
export function maybePlayCutscene(status) {
  if (!status || status.cutsceneReady !== true) return;
  if (document.querySelector('.cutscene-overlay')) return; // never stack
  if (Date.now() - _lastPlayAt < REPLAY_GUARD_MS) return;  // in-flight echo
  _lastPlayAt = Date.now();
  _seenConfirmed = false;
  wireSeenBackup();   // arm the pagehide/visibility backup before playback
  void clearFlag();   // primary keepalive attempt
  showCutscene();
}
