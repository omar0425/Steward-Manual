'use strict';

/* ── App session (Start Game) — localStorage only; no financial data ─ */
export const STEWARD_SESSION_META_KEY = 'steward_app_session_meta_v1';
export const SESSION_APP_READY_KEY = 'steward_app_ready';

function defaultSessionMeta() {
  return {
    firstStartedAt: null,
    currentSessionStartedAt: null,
    lastSeenAt: null,
    totalPlaySeconds: 0,
    sessionCount: 0,
  };
}

function normalizeSessionMeta(raw) {
  const d = defaultSessionMeta();
  if (!raw || typeof raw !== 'object') return d;
  d.firstStartedAt = typeof raw.firstStartedAt === 'string' ? raw.firstStartedAt : null;
  d.currentSessionStartedAt = typeof raw.currentSessionStartedAt === 'string' ? raw.currentSessionStartedAt : null;
  d.lastSeenAt = typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : null;
  const t = Number(raw.totalPlaySeconds);
  d.totalPlaySeconds = Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0;
  const c = Number(raw.sessionCount);
  d.sessionCount = Number.isFinite(c) && c >= 0 ? Math.floor(c) : 0;
  return d;
}

export function readSessionMeta() {
  try {
    const raw = localStorage.getItem(STEWARD_SESSION_META_KEY);
    if (!raw) return defaultSessionMeta();
    return normalizeSessionMeta(JSON.parse(raw));
  } catch {
    return defaultSessionMeta();
  }
}

export function writeSessionMeta(meta) {
  try {
    const normalized = normalizeSessionMeta(meta);
    localStorage.setItem(STEWARD_SESSION_META_KEY, JSON.stringify(normalized));
  } catch (err) {
    console.warn('[session] could not persist metadata', err);
  }
}

/** HH:MM:SS for the session line (matches "This visit 00:18:44 · Focused 00:09:12"). */
function formatDurationClockHMS(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 99) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function sessionWallSecondsFrom(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Single-flight foreground accrual (one interval + listeners per page load). */
const stewardPlaytime = {
  active: false,
  lastAnchorMs: 0,
  accrualIntervalId: null,
  uiIntervalId: null,
  listenersBound: false,
};

/** Ignore sub-frame noise; cap spikes (sleep / clock skew) so one flush cannot add huge bogus time. */
const MIN_FLUSH_DELTA_MS = 250;
const MAX_FLUSH_DELTA_MS = 1000 * 60 * 120;

function clearStewardPlaytimeIntervals() {
  if (stewardPlaytime.accrualIntervalId != null) {
    window.clearInterval(stewardPlaytime.accrualIntervalId);
    stewardPlaytime.accrualIntervalId = null;
  }
  if (stewardPlaytime.uiIntervalId != null) {
    window.clearInterval(stewardPlaytime.uiIntervalId);
    stewardPlaytime.uiIntervalId = null;
  }
}

function updateSessionTimeDisplay() {
  const el = document.getElementById('data-session-time');
  if (!el) return;
  const meta = readSessionMeta();
  const sessionSec = sessionWallSecondsFrom(meta.currentSessionStartedAt);
  const totalSec = meta.totalPlaySeconds;
  el.textContent = `This visit ${formatDurationClockHMS(sessionSec)} · Focused ${formatDurationClockHMS(totalSec)}`;
}

/**
 * Credits time from lastAnchorMs → now into totalPlaySeconds, then advances the anchor.
 * Safe if called twice in succession (visibility + pagehide): second call sees ~0 delta.
 * Does not run while the tab is backgrounded for the *periodic* tick — caller gates that.
 */
function applyForegroundAccrual() {
  if (!stewardPlaytime.active) return;
  const now = Date.now();
  let deltaMs = now - stewardPlaytime.lastAnchorMs;
  if (deltaMs <= 0) return;
  if (deltaMs > MAX_FLUSH_DELTA_MS) deltaMs = MAX_FLUSH_DELTA_MS;
  if (deltaMs < MIN_FLUSH_DELTA_MS) return;

  stewardPlaytime.lastAnchorMs = now;

  const meta = readSessionMeta();
  const addSec = deltaMs / 1000;
  meta.totalPlaySeconds = Math.floor(meta.totalPlaySeconds + addSec);
  meta.lastSeenAt = new Date().toISOString();
  writeSessionMeta(meta);
  updateSessionTimeDisplay();
}

function onPlaytimeVisibility() {
  if (!stewardPlaytime.active) return;
  if (document.hidden) {
    applyForegroundAccrual();
  } else {
    stewardPlaytime.lastAnchorMs = Date.now();
  }
}

function onPlaytimePageHide() {
  if (!stewardPlaytime.active) return;
  applyForegroundAccrual();
}

/**
 * Multi-tab: only the focused top-level document runs the accrual timer, so two visible windows are not both credited.
 * localStorage totals can still race if multiple tabs flush at once; focus prevents the common double-count case.
 */
function documentHasFocusSafe() {
  return typeof document.hasFocus !== 'function' || document.hasFocus();
}

function shouldAccrueOnForegroundTick() {
  return stewardPlaytime.active && !document.hidden && documentHasFocusSafe();
}

/** Periodic save: visible, focused tab only; background tabs do not accrue. */
function onForegroundAccrualInterval() {
  if (!shouldAccrueOnForegroundTick()) return;
  applyForegroundAccrual();
}

function onWindowBlur() {
  if (!stewardPlaytime.active) return;
  applyForegroundAccrual();
}

function onWindowFocus() {
  if (!stewardPlaytime.active) return;
  stewardPlaytime.lastAnchorMs = Date.now();
}

export function startPlaytimeTracking() {
  if (stewardPlaytime.active) return;
  stewardPlaytime.active = true;
  stewardPlaytime.lastAnchorMs = Date.now();

  if (!stewardPlaytime.listenersBound) {
    stewardPlaytime.listenersBound = true;
    document.addEventListener('visibilitychange', onPlaytimeVisibility, { passive: true });
    window.addEventListener('pagehide', onPlaytimePageHide, { passive: true });
    window.addEventListener('blur', onWindowBlur, { passive: true });
    window.addEventListener('focus', onWindowFocus, { passive: true });
  }

  clearStewardPlaytimeIntervals();
  stewardPlaytime.accrualIntervalId = window.setInterval(onForegroundAccrualInterval, 4000);
  stewardPlaytime.uiIntervalId = window.setInterval(() => {
    if (stewardPlaytime.active) updateSessionTimeDisplay();
  }, 1000);

  const el = document.getElementById('data-session-time');
  if (el) {
    console.debug('[startup-visibility-direct]', 'data-session-time', 'el.hidden=false');
    el.hidden = false;
  }
  updateSessionTimeDisplay();
}
