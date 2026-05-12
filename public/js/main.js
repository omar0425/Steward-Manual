'use strict';

/* ── Side-effect imports (CSS injection, character styles) ──────── */
import './character.js';

/* ── Module imports ────────────────────────────────────────────── */
import { currentShell, getDashboardRoot, isPlayDashboardDoc } from './shell.js';
import { formatNextTierGapHeadline, roundDebtTierBandPctClient, debtTierBandBarDisplay, syncDebtTierBandDebugOverlay } from './format.js';
import { stewardApiUrl } from './api.js';
import { TIER_META, TIER_FLOW } from './tiers.js';
import { buildSteward } from './character.js';
import { startDashboardOnboarding } from './onboarding.js';
import { resetPlayGame } from './commitment.js';
import { initDashboardBoot, manualRefresh } from './boot.js';
import { setDebtSortMode, toggleAprForm } from './render.js';
import { mountPlayShell } from './views/play.js';
import { loadCharacterTemplate } from './template-loader.js';
import './views/dashboard-enhance.js';
import { initManualEntryForm } from './manual-entry.js';

/* ── Window exports (for inline onclick handlers in HTML) ──────── */
window.manualRefresh = manualRefresh;
window.formatNextTierGapHeadline = formatNextTierGapHeadline;
window.startDashboardOnboarding = startDashboardOnboarding;
window.resetPlayGame = resetPlayGame;
window.TIER_META = TIER_META;
window.stewardTierMeta = TIER_META;
window.stewardTierFlow = TIER_FLOW;
window.buildSteward = buildSteward;
window.roundDebtTierBandPctClient = roundDebtTierBandPctClient;
window.debtTierBandBarDisplay = debtTierBandBarDisplay;
window.syncDebtTierBandDebugOverlay = syncDebtTierBandDebugOverlay;
window.stewardApiUrl = stewardApiUrl;
window.setDebtSortMode = setDebtSortMode;
window.toggleAprForm = toggleAprForm;

/* ── Theme toggle (dark / light via data-theme on body) ────────── */
function initTheme() {
  const legacy = localStorage.getItem('steward-dark-mode');
  const saved = localStorage.getItem('steward-theme') || (legacy === 'false' ? 'light' : 'dark');
  document.body.dataset.theme = saved;

  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const update = () => {
    const isDark = document.body.dataset.theme === 'dark';
    btn.textContent = isDark ? '\u263D Dark' : '\u2600 Light';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  };

  update();
  btn.addEventListener('click', () => {
    const isDark = document.body.dataset.theme === 'dark';
    document.body.dataset.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('steward-theme', document.body.dataset.theme);
    update();
  });
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
    document.body.dataset.stewardBuild = 'remake';
    console.info('Steward: consolidated build active');

    initTheme();
    initLogout();
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
