'use strict';

/* ── Side-effect imports (CSS injection, character styles) ──────── */
import './character.js';

/* ── Module imports ────────────────────────────────────────────── */
import { currentShell, getDashboardRoot, isPlayDashboardDoc } from './shell.js';
import { formatNextTierGapHeadline, roundDebtTierBandPctClient, debtTierBandBarDisplay, syncDebtTierBandDebugOverlay } from './format.js';
import { TIER_META } from './tiers.js';
import { buildSteward } from './character.js';
import { resetPlayGame } from './commitment.js';
import { initDashboardBoot } from './boot.js';
import { setDebtSortMode, toggleAprForm } from './render.js';
import { mountPlayShell } from './views/play.js';
import { loadCharacterTemplate } from './template-loader.js';
import './views/dashboard-enhance.js';
import { initManualEntryForm } from './manual-entry.js';

/* ── Window exports ─────────────────────────────────────────────
   showcase.html runs a <script type="module"> after main.js loads and
   reads these as bare globals; play.js wires inline onclick attributes
   to window.setDebtSortMode / window.toggleAprForm. */
window.formatNextTierGapHeadline = formatNextTierGapHeadline;
window.TIER_META = TIER_META;
window.buildSteward = buildSteward;
window.roundDebtTierBandPctClient = roundDebtTierBandPctClient;
window.debtTierBandBarDisplay = debtTierBandBarDisplay;
window.syncDebtTierBandDebugOverlay = syncDebtTierBandDebugOverlay;
window.setDebtSortMode = setDebtSortMode;
window.toggleAprForm = toggleAprForm;

/* ── Theme toggle (dark / light via data-theme on body) ────────── */
function initTheme() {
  const legacy = localStorage.getItem('steward-dark-mode');
  const saved = localStorage.getItem('steward-theme') || (legacy === 'false' ? 'light' : 'dark');
  document.body.dataset.theme = saved;

  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  // aria-pressed reflects the active state of the toggle button: true while
  // dark mode is on, false while light mode is on. Updated alongside the
  // label/text each click so screen readers stay accurate.
  const update = () => {
    const isDark = document.body.dataset.theme === 'dark';
    btn.textContent = isDark ? '\u263D Dark' : '\u2600 Light';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  };

  update();
  /* Tracks the transient transition state so rapid clicks don't pile up timers. */
  let transitionTimer = null;
  btn.addEventListener('click', () => {
    const isDark = document.body.dataset.theme === 'dark';
    document.body.dataset.themeTransitioning = '1';
    document.body.dataset.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('steward-theme', document.body.dataset.theme);
    update();
    if (transitionTimer) window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      delete document.body.dataset.themeTransitioning;
      transitionTimer = null;
    }, 260);
  });
}

/* ── App version chip ───────────────────────────────────────────── */
/* /health carries the package.json version plus the deploy commit SHA when
   hosted (Railway). Fire-and-forget — the chip just stays "—" offline. */
function fillAppVersion() {
  const elV = document.getElementById('app-version');
  if (!elV) return;
  fetch('/health')
    .then((r) => r.json())
    .then((h) => {
      if (!h || !h.version) return;
      elV.textContent = `v${h.version}${h.commit ? ` (${h.commit})` : ''}`;
    })
    .catch(() => { /* leave the placeholder */ });
}

/* ── Logout handler ─────────────────────────────────────────────── */
function initLogout() {
  const btn = document.getElementById('nav-logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    window.location.href = '/login';
  });
}

/* ── Legacy account email prompt ──────────────────────────────────
 * Local accounts created before email was required can't reset their
 * password. /api/auth/me returns needsEmail:true for those; show a one-time
 * banner with an inline input so the user can attach an email without
 * leaving the dashboard. Dismissed via localStorage so we don't badger. */
function initEmailPrompt() {
  const DISMISS_KEY = 'steward-email-prompt-dismissed';
  (async () => {
    let me;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      me = await res.json();
    } catch { return; }
    if (!me || !me.needsEmail) return;
    try { if (localStorage.getItem(DISMISS_KEY) === '1') return; } catch { /* ignore */ }

    const banner = document.createElement('div');
    banner.id = 'email-prompt-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Add email for password reset');
    banner.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:10px 18px;background:var(--amber-soft,rgba(212,160,48,0.10));border-bottom:1px solid rgba(212,160,48,0.22);font-family:\'IBM Plex Sans\',sans-serif;font-size:13px;';
    banner.innerHTML = `
      <span style="flex:1;color:var(--text);">
        <strong style="color:var(--amber,#d4a030);">Add an email</strong> to your account so you can reset your password later.
      </span>
      <input id="email-prompt-input" type="email" placeholder="you@example.com" maxlength="254"
             style="flex:0 1 260px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:'IBM Plex Sans',sans-serif;font-size:13px;" />
      <button id="email-prompt-save" type="button"
              style="padding:6px 14px;background:var(--gold,#c8a84c);border:none;border-radius:4px;color:#1a1a1a;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;">
        Save
      </button>
      <button id="email-prompt-dismiss" type="button" aria-label="Dismiss"
              style="padding:4px 8px;background:transparent;border:none;color:var(--text-3);font-size:18px;cursor:pointer;">×</button>
      <span id="email-prompt-msg" aria-live="polite" style="font-size:12px;color:var(--text-3);"></span>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    const input = banner.querySelector('#email-prompt-input');
    const save  = banner.querySelector('#email-prompt-save');
    const msg   = banner.querySelector('#email-prompt-msg');
    banner.querySelector('#email-prompt-dismiss').addEventListener('click', () => {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
      banner.remove();
    });
    save.addEventListener('click', async () => {
      const v = (input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) {
        msg.textContent = 'That email doesn’t look right.';
        msg.style.color = 'var(--rose, #d94f6e)';
        return;
      }
      msg.textContent = 'Saving…';
      msg.style.color = 'var(--text-3)';
      save.disabled = true;
      try {
        const res = await fetch('/api/auth/me/email', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: v }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          msg.textContent = 'Saved.';
          msg.style.color = 'var(--emerald, #14a469)';
          try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
          setTimeout(() => banner.remove(), 1200);
        } else {
          msg.textContent = data.error || 'Could not save.';
          msg.style.color = 'var(--rose, #d94f6e)';
          save.disabled = false;
        }
      } catch {
        msg.textContent = 'Network error.';
        msg.style.color = 'var(--rose, #d94f6e)';
        save.disabled = false;
      }
    });
  })();
}

/* ── Browser storage feature-detect ─────────────────────────────
 * Safari private mode and some hardened browsers throw on
 * localStorage access. Steward leans on it for the commitment flag,
 * theme, session-resume hint, etc., so silent failure leaves the
 * user in a confusing state (commitment screen reappears, theme
 * doesn't stick). Detect once at boot and surface a banner. */
function checkBrowserStorageAvailable() {
  try {
    const key = '__steward_storage_probe__';
    localStorage.setItem(key, '1');
    if (localStorage.getItem(key) !== '1') return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function showStorageDisabledBanner() {
  if (document.getElementById('storage-disabled-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'storage-disabled-banner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position: sticky',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 9998',
    'background: var(--amber-soft, rgba(212,160,48,0.18))',
    'border-bottom: 1px solid var(--amber, #d4a030)',
    'color: var(--text, #f0e6c8)',
    "font-family: 'IBM Plex Sans', sans-serif",
    'font-size: 13px',
    'line-height: 1.45',
    'padding: 10px 16px',
    'text-align: center',
  ].join(';');
  banner.textContent =
    'Browser storage is disabled. Steward needs it to remember your commitment ' +
    'between sessions. Enable site data for this page.';
  if (document.body.firstChild) {
    document.body.insertBefore(banner, document.body.firstChild);
  } else {
    document.body.appendChild(banner);
  }
}

/* ── Init ──────────────────────────────────────────────────────── */
async function init() {
  if (!checkBrowserStorageAvailable()) {
    showStorageDisabledBanner();
  }

  const shell = currentShell();

  if (shell === 'play') {
    /* ── Consolidated Steward shell: JS-built DOM ──────────── */
    const root = document.getElementById('app-root');
    if (!root) {
      if (getDashboardRoot()) {
        initDashboardBoot();
      }
      return;
    }

    mountPlayShell(root);
    document.title = 'Steward';

    initTheme();
    initLogout();
    initEmailPrompt();
    fillAppVersion();
    await loadCharacterTemplate();

    if (typeof window !== 'undefined') {
      try {
        if (new URLSearchParams(window.location.search).has('clear-local')) {
          resetPlayGame();
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch (_) {}
    }

    const loadingText = document.querySelector('.loading-text');
    if (loadingText) loadingText.textContent = 'Loading Steward\u2026';

    initManualEntryForm();
    initDashboardBoot();
  } else if (getDashboardRoot()) {
    /* ── Fallback for any remaining static HTML shells ──────── */
    initDashboardBoot();
  }
}

init();
