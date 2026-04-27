'use strict';

import { stewardApiUrl, stewardPublicOriginHint, readJsonRes } from './api.js';
import { readSessionMeta, writeSessionMeta, startPlaytimeTracking, SESSION_APP_READY_KEY } from './session.js';
import { render, setDebtSortMode, refreshDebtPanelData } from './render.js';
import { mountStartScreenSteward } from './character.js';
import { offerFirstVisitDashboardOnboarding, installDashboardHowItWorksButton } from './onboarding.js';
import { readPromiseMadeFlag, openCommitmentGate, initPlayResetBtn, initPlayClearLocalBtn } from './commitment.js';
import { AppMode, transitionTo, isSessionResume } from './state.js';

const STARTUP_UI_DEBUG = false;

let startupBootComplete = false;
let notificationsSentCache = null;

const MILESTONE_THRESHOLDS = [25, 50, 75, 90];
const MILESTONE_MESSAGES = {
  'pct_25': "25% paid. You're moving.",
  'pct_50': "50% paid. You're not the same person who started this.",
  'pct_75': "75% paid. The end is real now.",
  'pct_90': "90% paid. Almost there. Don't stop.",
};

async function loadNotificationsSent() {
  if (notificationsSentCache !== null) return notificationsSentCache;
  try {
    const res = await fetch(stewardApiUrl('/api/config/notifications-sent'));
    const data = await res.json();
    notificationsSentCache = Array.isArray(data.sent) ? data.sent : [];
  } catch {
    return [];
  }
  return notificationsSentCache;
}

async function markMilestoneSent(milestone) {
  try {
    const res = await fetch(stewardApiUrl('/api/config/notifications-sent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone }),
    });
    if (res.ok && notificationsSentCache && !notificationsSentCache.includes(milestone)) {
      notificationsSentCache.push(milestone);
    }
  } catch { /* best effort */ }
}

function fireNotification(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') new Notification(title, { body, icon: '/favicon.ico' });
    });
  }
}

async function checkPayoffMilestones(status) {
  if (!status || !status.ready || !status.stats) return;
  const pctPaid = status.stats.pctPaid;
  if (typeof pctPaid !== 'number') return;

  const sent = await loadNotificationsSent();

  // First boot: seed current state without firing notifications
  if (!sent.includes('__initialized')) {
    const toSeed = ['__initialized'];
    for (const threshold of MILESTONE_THRESHOLDS) {
      if (pctPaid >= threshold) toSeed.push(`pct_${threshold}`);
    }
    if (status.tier.id !== 'rock_bottom') toSeed.push(`tier_${status.tier.id}`);
    for (const key of toSeed) {
      await markMilestoneSent(key);
    }
    return;
  }

  for (const threshold of MILESTONE_THRESHOLDS) {
    const key = `pct_${threshold}`;
    if (pctPaid >= threshold && !sent.includes(key)) {
      const msg = MILESTONE_MESSAGES[key] || `${threshold}% paid.`;
      fireNotification('Steward', msg);
      await markMilestoneSent(key);
    }
  }

  // Tier change notification
  const tierKey = `tier_${status.tier.id}`;
  if (!sent.includes(tierKey) && status.tier.id !== 'rock_bottom') {
    fireNotification('Steward', `New tier reached: ${status.tier.label}. Keep moving.`);
    await markMilestoneSent(tierKey);
  }
}

function setBootErrorMessage(message) {
  const el = document.getElementById('app-error-text');
  if (el) el.textContent = message || '';
}

function initStartGameGate() {
  const startRoot = document.getElementById('start-game-screen');
  const clockEl = document.getElementById('start-game-clock');
  const btn = document.getElementById('start-game-btn');

  const resumeAfterRefresh = isSessionResume();

  if (!startRoot || !btn) {
    const now = new Date().toISOString();
    const meta = readSessionMeta();
    if (!meta.firstStartedAt) meta.firstStartedAt = now;
    meta.currentSessionStartedAt = now;
    meta.lastSeenAt = now;
    meta.sessionCount += 1;
    writeSessionMeta(meta);
    startPlaytimeTracking();
    transitionTo(AppMode.LOADING, 'init: no start gate');
    void load({ refresh: false }).catch(err => {
      console.error('[Steward] load() failed (no start gate)', err);
      setBootErrorMessage(err && err.message ? err.message : String(err));
      transitionTo(AppMode.ERROR, `load reject: ${err && err.message ? err.message : err}`);
    });
    return;
  }

  if (resumeAfterRefresh) {
    transitionTo(AppMode.LOADING, 'session resume (same tab)');
    void load({ refresh: false }).catch(err => {
      console.error('[Steward] load() failed (session resume)', err);
      setBootErrorMessage(err && err.message ? err.message : String(err));
      transitionTo(AppMode.ERROR, `load reject: ${err && err.message ? err.message : err}`);
    });
    return;
  }

  transitionTo(AppMode.START, 'init: start gate shown');

  mountStartScreenSteward();

  // Show stored commitment text on the start gate
  try {
    const reason = localStorage.getItem('steward_promise_text');
    const quoteEl = document.getElementById('start-commitment-quote');
    if (quoteEl && reason && reason.trim()) {
      quoteEl.textContent = '“' + reason.trim() + '”';
      quoteEl.removeAttribute('hidden');
    }
  } catch (_) { /* ignore */ }

  const tickClock = () => {
    if (!clockEl) return;
    clockEl.textContent = new Date().toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  };
  tickClock();
  const clockTimer = window.setInterval(tickClock, 1000);

  let startClickInFlight = false;

  const onStart = () => {
    if (startClickInFlight) {
      if (STARTUP_UI_DEBUG) console.debug('[Steward] ignored: Start Game click (in flight)');
      return;
    }
    startClickInFlight = true;

    window.clearInterval(clockTimer);
    btn.disabled = true;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animDelay = reducedMotion ? 0 : 1400;

    document.body.classList.add('start-animating');

    setTimeout(() => {
      transitionTo(AppMode.LOADING, 'start button click');

      const now = new Date().toISOString();
      const meta = readSessionMeta();
      if (!meta.firstStartedAt) meta.firstStartedAt = now;
      meta.currentSessionStartedAt = now;
      meta.lastSeenAt = now;
      meta.sessionCount += 1;
      writeSessionMeta(meta);

      startPlaytimeTracking();

      void load({ refresh: false }).catch(err => {
        console.error('[Steward] load() failed after Start Game', err);
        setBootErrorMessage(err && err.message ? err.message : String(err));
        transitionTo(AppMode.ERROR, `load reject: ${err && err.message ? err.message : err}`);
      });
    }, animDelay);
  };

  btn.addEventListener('click', onStart);
}

export function initDashboardBoot() {
  initPlayResetBtn();
  initPlayClearLocalBtn();
  const root = document.getElementById('commitment-screen');
  if (!root) {
    initStartGameGate();
    return;
  }
  if (readPromiseMadeFlag()) {
    initStartGameGate();
    return;
  }
  openCommitmentGate(() => initStartGameGate());
}

async function load(options = {}) {
  const bootCompleteBefore = startupBootComplete;
  const isDataRefresh = bootCompleteBefore && options.refresh !== false;
  const isManual = !!options.manual;

  if (!isDataRefresh && document.body && document.body.dataset.appMode === AppMode.ERROR) {
    transitionTo(AppMode.LOADING, 'retry after error');
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    const txt = document.querySelector('.loading-text');
    if (txt) {
      txt.textContent = `This page must be served by Steward. Run npm start — then open ${stewardPublicOriginHint()}/ (not a local file). The file:// protocol cannot reach the API.`;
    }
    const fileMsg = `Open this app via ${stewardPublicOriginHint()}/ after npm start. The file:// protocol cannot reach the API.`;
    if (!isDataRefresh) {
      setBootErrorMessage(fileMsg);
      transitionTo(AppMode.ERROR, 'file: protocol');
    }
    return;
  }

  try {
    const cacheBust = (url) => {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}t=${Date.now()}`;
    };
    const fetchWithTimeout = (url, ms = 12000) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), ms);
      return fetch(cacheBust(url), { signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(tid));
    };
    const [statusRes, snapsRes] = await Promise.all([
      fetchWithTimeout(stewardApiUrl('/api/status?debugDebtSync=1')),
      fetchWithTimeout(stewardApiUrl('/api/snapshots')),
    ]);
    const [status, snapshots] = await Promise.all([
      readJsonRes(statusRes, '/api/status'),
      readJsonRes(snapsRes, '/api/snapshots'),
    ]);
    if (!status.ready) {
      if (startupBootComplete) {
        transitionTo(AppMode.LOADING, 'status no longer ready — wait for next sync');
      }
      const txt = document.querySelector('.loading-text');
      if (txt) {
        if (status.noData) {
          txt.textContent = 'No data yet \u2014 click \u201cAdd Snapshot\u201d below to enter your numbers.';
        } else if (status.lastError) {
          txt.textContent = status.lastError;
        } else {
          txt.textContent = status.message || 'Pulling your financial data\u2026';
        }
      }
      if (STARTUP_UI_DEBUG) console.debug(`[Steward] poll: status not ready \u2192 retry in 3s (dataRefresh=${isDataRefresh})`);
      if (status.noData) {
        // No snapshots at all — stop polling and let the user decide when to sync.
        // The "Add Snapshot" button on this screen will open the entry form.
        if (STARTUP_UI_DEBUG) console.debug('[Steward] no data: waiting for manual entry');
        return;
      }
      // Keep polling when a pull is actively in progress (post-manual-sync, initial install)
      window.setTimeout(() => load({ refresh: isDataRefresh, manual: isManual }), 3000);
      return;
    }

    await refreshDebtPanelData();
    render(status, snapshots);
    checkPayoffMilestones(status);

    // After a reset the commitment gate runs before data exists, so
    // POST /api/start-game fails silently. On the first successful data load,
    // if the user has made their commitment but game start was never recorded,
    // claim this snapshot as game start now.
    if (
      !startupBootComplete &&
      readPromiseMadeFlag() &&
      status.stats &&
      status.stats.gameStartDebt == null
    ) {
      void fetch(stewardApiUrl('/api/start-game'), { method: 'POST' })
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            // Re-load to pick up the newly-set game start in the stats
            void load({ refresh: false });
          }
        })
        .catch(() => { /* non-fatal */ });
    }

    if (!isDataRefresh) {
      startupBootComplete = true;
      transitionTo(AppMode.READY, 'load success');
      window.setTimeout(() => {
        offerFirstVisitDashboardOnboarding();
        installDashboardHowItWorksButton();
      }, 480);
    }
  } catch (err) {
    console.error('Failed to load status:', err);
    const detail = err && err.message && err.message.length < 220 ? err.message : '';
    const userLine = detail
      ? `Could not load dashboard. ${detail}`
      : `Could not reach the Steward server. Run npm start \u2014 then open ${stewardPublicOriginHint()}/`;

    if (!isDataRefresh) {
      setBootErrorMessage(userLine);
      transitionTo(AppMode.ERROR, `load failure: ${err && err.message ? err.message : err}`);
    }

    const txt = document.querySelector('.loading-text');
    if (txt) txt.textContent = userLine;

    if (STARTUP_UI_DEBUG) console.debug(`[Steward] load retry in 5s (dataRefresh=${isDataRefresh})`);
    window.setTimeout(() => load({ refresh: isDataRefresh, manual: isManual }), 5000);
  }
}

/* \u2500\u2500 Manual refresh \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export async function manualRefresh() {
  await load({ refresh: true, manual: true });
}
