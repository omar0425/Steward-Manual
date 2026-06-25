'use strict';

/* ── Milestone cutscene ─────────────────────────────────────────────────────
   A personal easter egg for LoudFlipFlopz: whenever a balance update clears
   $500+ of debt, the server arms a `cutsceneReady` flag (status payload). On the
   next dashboard render we play ONE random clip fullscreen, wrapped in Steward
   chrome, then tell the server to clear the flag so it plays only once.

   The clip is served by the auth-gated route GET /api/cutscene/video, which
   302-redirects the cutscene user to a random video and 404s everyone else. If
   playback fails we show a graceful themed card instead of a black void.
   ─────────────────────────────────────────────────────────────────────────── */

import { stewardApiUrl } from './api.js';

const VIDEO_SRC = '/api/cutscene/video';
let _played = false;          // once per page load, even if render() runs again
let _isCutsceneUser = false;  // set from the status payload; gates the test trigger

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
    .cutscene-body { display: flex; background: #000; min-height: 0; }
    .cutscene-video { display: block; width: 100%; height: auto; max-height: 72vh; background: #000; }
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

async function clearFlag() {
  // Consume the trigger so it plays exactly once, regardless of playback outcome.
  try {
    await fetch(stewardApiUrl('/api/config/cutscene-seen'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (_) { /* best-effort; the flag clears on next successful POST */ }
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
    <div class="cutscene-footer">Another $500 cleared. The climb continues.</div>
  `;

  const body = stage.querySelector('.cutscene-body');
  const skip = stage.querySelector('.cutscene-skip');

  const video = document.createElement('video');
  video.className = 'cutscene-video';
  // Cache-buster so each trigger re-hits the route and gets a fresh random clip.
  video.src = `${stewardApiUrl(VIDEO_SRC)}?t=${Date.now()}`;
  video.setAttribute('playsinline', '');
  video.controls = true;
  video.autoplay = true;
  body.appendChild(video);

  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('cutscene-show'));

  function onKey(e) { if (e.key === 'Escape') dismiss(overlay, onKey); }
  document.addEventListener('keydown', onKey);

  skip.addEventListener('click', () => dismiss(overlay, onKey));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(overlay, onKey); });
  video.addEventListener('ended', () => dismiss(overlay, onKey));
  video.addEventListener('error', () => {
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
 * Called from render() with the status payload. Plays one random cutscene when
 * the server has armed it (a $500+ debt drop, cutscene user only).
 */
export function maybePlayCutscene(status) {
  if (status && status.cutsceneUser === true) _isCutsceneUser = true;
  maybePlayTestCutscene();
  if (_played) return;
  if (!status || status.cutsceneReady !== true) return;
  _played = true;
  clearFlag();
  showCutscene();
}

/* ── Manual test trigger (cutscene user only) ────────────────────────────────
   Preview the cutscene without clearing $500 — neither path touches the real
   trigger flag:
     • run  stewardPlayCutscene()  in the browser console (re-fireable), or
     • load the dashboard with  ?cutscene=test
   Gated to the cutscene account; and even if bypassed, the video route 404s for
   anyone else, so they'd only ever see the empty fallback card. */
let _testParamChecked = false;
function maybePlayTestCutscene() {
  if (_testParamChecked || !_isCutsceneUser) return;
  _testParamChecked = true;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cutscene') === 'test') showCutscene();
  } catch (_) { /* ignore */ }
}

if (typeof window !== 'undefined') {
  window.stewardPlayCutscene = () => { if (_isCutsceneUser) showCutscene(); };
}
