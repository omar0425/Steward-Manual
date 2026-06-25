'use strict';

/* ── Milestone cutscene ─────────────────────────────────────────────────────
   A personal easter egg for LoudFlipFlopz: every 75th login the server arms a
   `cutsceneReady` flag (status payload). On the next dashboard render we play a
   short fullscreen video once, then tell the server to clear the flag so it
   never repeats.

   Drop the video at:  public/videos/cutscene.mp4   (served at /videos/cutscene.mp4)
   If the file is missing we show a graceful themed card instead of a black void.
   ─────────────────────────────────────────────────────────────────────────── */

import { stewardApiUrl } from './api.js';

const VIDEO_SRC = '/videos/cutscene.mp4';
let _played = false; // once per page load, even if render() runs again

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
      position: relative; width: min(92vw, 960px); max-height: 86vh;
      border: 1px solid var(--gold, #c8a84c); border-radius: 14px;
      box-shadow: 0 20px 80px rgba(0,0,0,0.6); overflow: hidden; background: #000;
    }
    .cutscene-video { display: block; width: 100%; height: auto; max-height: 86vh; background: #000; }
    .cutscene-skip {
      position: absolute; top: 12px; right: 12px; z-index: 2;
      font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
      color: rgba(255,255,255,0.9); background: rgba(0,0,0,0.55);
      border: 1px solid rgba(255,255,255,0.3); border-radius: 999px;
      padding: 6px 14px; cursor: pointer; transition: background .15s ease;
    }
    .cutscene-skip:hover { background: rgba(0,0,0,0.85); }
    .cutscene-fallback {
      padding: 48px 32px; text-align: center; color: var(--text, #f4efe4);
      font-family: 'Cormorant Garamond', serif;
    }
    .cutscene-fallback-title { font-size: 24px; font-weight: 600; color: var(--gold-2, #e3bd72); margin-bottom: 8px; }
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

function showFallback(stage) {
  stage.innerHTML = `
    <div class="cutscene-fallback">
      <div class="cutscene-fallback-title">🎩 The Steward prepared a moment for you…</div>
      <div class="cutscene-fallback-line">…but the reel isn't loaded yet. Press Skip to carry on.</div>
    </div>`;
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'cutscene-skip';
  skip.textContent = 'Skip ▸';
  stage.appendChild(skip);
  return skip;
}

function showCutscene() {
  injectStylesOnce();

  const overlay = document.createElement('div');
  overlay.className = 'cutscene-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Cutscene');

  const stage = document.createElement('div');
  stage.className = 'cutscene-stage';

  const video = document.createElement('video');
  video.className = 'cutscene-video';
  video.src = VIDEO_SRC;
  video.setAttribute('playsinline', '');
  video.controls = true;
  video.autoplay = true;

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'cutscene-skip';
  skip.textContent = 'Skip ▸';

  stage.appendChild(video);
  stage.appendChild(skip);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('cutscene-show'));

  function onKey(e) { if (e.key === 'Escape') dismiss(overlay, onKey); }
  document.addEventListener('keydown', onKey);

  skip.addEventListener('click', () => dismiss(overlay, onKey));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(overlay, onKey); });
  video.addEventListener('ended', () => dismiss(overlay, onKey));
  video.addEventListener('error', () => {
    const fallbackSkip = showFallback(stage);
    fallbackSkip.addEventListener('click', () => dismiss(overlay, onKey));
  });

  // Autoplay-with-sound is often blocked on load; the controls let the user
  // start it manually in that case, so a rejected play() is fine to swallow.
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

/**
 * Called from render() with the status payload. Plays the cutscene once when the
 * server has armed it (every 75th login for the cutscene user).
 */
export function maybePlayCutscene(status) {
  if (_played) return;
  if (!status || status.cutsceneReady !== true) return;
  _played = true;
  clearFlag();
  showCutscene();
}
