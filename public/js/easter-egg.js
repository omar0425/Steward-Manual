'use strict';

/* ── The Steward's easter egg ──────────────────────────────────────────────────
   Trigger it two ways:
     • the Konami code  ↑ ↑ ↓ ↓ ← → ← → B A   (desktop)
     • tap his hat (the footer monocle 🧐) five times quickly   (mobile)
   Reward: a shower of gold and a dry Pennybags aphorism. Reduced-motion users
   get the line without the rain. Entirely self-contained — no app state touched. */

const APHORISMS = [
  'Compound interest is the eighth wonder of the world — and the bank’s favorite.',
  'A penny saved is a penny that no longer works for your creditor.',
  'The house always wins. So stop renting it your debt.',
  'Fortunes are made in the quiet months, when no one is watching.',
  'Every dollar you keep is a small employee. Hire more of them.',
  'Patience is the cheapest interest rate there is.',
];

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

let _buffer = [];
let _tapCount = 0;
let _tapTimer = null;
let _cooling = false;

function prefersReducedMotion() {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
}

function injectStylesOnce() {
  if (document.getElementById('ee-style')) return;
  const style = document.createElement('style');
  style.id = 'ee-style';
  style.textContent = `
    .ee-coins { position: fixed; inset: 0; pointer-events: none; z-index: 9998; overflow: hidden; }
    .ee-coin { position: absolute; top: -8vh; font-size: 26px; will-change: transform; animation: ee-fall linear forwards; }
    @keyframes ee-fall {
      0%   { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
      8%   { opacity: 1; }
      100% { transform: translateY(115vh) rotate(var(--ee-spin)); opacity: 1; }
    }
    .ee-toast {
      position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(12px);
      z-index: 9999; max-width: min(92vw, 460px);
      background: var(--surface, #12161f); color: var(--text, #f4efe4);
      border: 1px solid var(--gold, #cf993f); border-radius: 12px;
      padding: 14px 18px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      opacity: 0; transition: opacity .35s ease, transform .35s ease; text-align: center;
    }
    .ee-toast.ee-show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .ee-toast-title { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 600; color: var(--gold-2, #e3bd72); margin-bottom: 4px; }
    .ee-toast-line { font-size: 13px; font-style: italic; color: var(--text-2, #b9b3a6); line-height: 1.5; }
    @media (prefers-reduced-motion: reduce) { .ee-coin { animation: none; display: none; } }
  `;
  document.head.appendChild(style);
}

function rainGold() {
  if (prefersReducedMotion()) return;
  const wrap = document.createElement('div');
  wrap.className = 'ee-coins';
  wrap.setAttribute('aria-hidden', 'true');
  const faces = ['🪙', '💰', '🟡']; // 🪙 💰 🟡
  const N = 44;
  let maxMs = 0;
  for (let i = 0; i < N; i++) {
    const c = document.createElement('span');
    c.className = 'ee-coin';
    c.textContent = faces[i % faces.length];
    c.style.left = `${(i / N) * 100 + (Math.sin(i) * 4)}%`;
    const dur = 2.2 + (i % 7) * 0.32;            // 2.2s–4.1s, deterministic-ish
    const delay = (i % 11) * 0.12;
    c.style.animationDuration = `${dur}s`;
    c.style.animationDelay = `${delay}s`;
    c.style.fontSize = `${20 + (i % 5) * 6}px`;
    c.style.setProperty('--ee-spin', `${(i % 2 ? 1 : -1) * (180 + (i % 4) * 180)}deg`);
    maxMs = Math.max(maxMs, (dur + delay) * 1000);
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), maxMs + 400);
}

function showToast() {
  const existing = document.getElementById('ee-toast');
  if (existing) existing.remove();
  const line = APHORISMS[Math.floor((Date.now() / 1000) % APHORISMS.length)];
  const toast = document.createElement('div');
  toast.id = 'ee-toast';
  toast.className = 'ee-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <div class="ee-toast-title">🎩 The Steward tips his hat.</div>
    <div class="ee-toast-line"></div>
  `;
  toast.querySelector('.ee-toast-line').textContent = line;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('ee-show'));
  window.setTimeout(() => {
    toast.classList.remove('ee-show');
    window.setTimeout(() => toast.remove(), 400);
  }, 4200);
}

function fire() {
  if (_cooling) return;
  _cooling = true;
  window.setTimeout(() => { _cooling = false; }, 6000); // no spamming the butler
  injectStylesOnce();
  rainGold();
  showToast();
}

function onKeydown(e) {
  const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
  _buffer.push(key);
  if (_buffer.length > KONAMI.length) _buffer.shift();
  if (_buffer.length === KONAMI.length && KONAMI.every((k, i) => _buffer[i] === k)) {
    _buffer = [];
    fire();
  }
}

function onClick(e) {
  // The footer monocle only — the nav "S" is a link and would navigate away.
  const hat = e.target && e.target.closest && e.target.closest('.steward-footer-emoji');
  if (!hat) return;
  _tapCount += 1;
  if (_tapTimer) window.clearTimeout(_tapTimer);
  _tapTimer = window.setTimeout(() => { _tapCount = 0; }, 1500);
  if (_tapCount >= 5) {
    _tapCount = 0;
    fire();
  }
}

export function initEasterEgg() {
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onClick);
  // A wink for anyone who opens the console.
  try {
    console.log(
      '%c🧐 The Steward sees you in the console.',
      'color:#cf993f;font-family:Georgia,serif;font-size:14px;',
    );
    console.log('%cTry the Konami code — or tap my hat five times.', 'color:#b9b3a6;font-style:italic;');
  } catch (_) { /* ignore */ }
}

initEasterEgg();
