'use strict';

import { stewardApiUrl, readJsonRes } from './api.js';
import { STEWARD_SESSION_META_KEY, SESSION_APP_READY_KEY } from './session.js';

/* ── First-run commitment (optional DOM: `#commitment-screen` on play.html) ─ */
const STEWARD_PROMISE_MADE_KEY = 'steward_promise_made';
const STEWARD_PROMISE_AT_KEY = 'steward_promise_made_at';
const STEWARD_PROMISE_TEXT_KEY = 'steward_promise_text';
export const DASHBOARD_ONBOARDING_KEY = 'steward_dashboard_guided_tour_v2';

export function readPromiseMadeFlag() {
  try {
    const v = localStorage.getItem(STEWARD_PROMISE_MADE_KEY);
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

function persistPromiseAck(customText) {
  try {
    localStorage.setItem(STEWARD_PROMISE_MADE_KEY, 'true');
    localStorage.setItem(STEWARD_PROMISE_AT_KEY, new Date().toISOString());
    const t = (customText || '').trim();
    if (t) localStorage.setItem(STEWARD_PROMISE_TEXT_KEY, t);
    else localStorage.removeItem(STEWARD_PROMISE_TEXT_KEY);
  } catch (err) {
    console.warn('[commitment] could not persist', err);
  }
}

export function openCommitmentGate(done) {
  const root = document.getElementById('commitment-screen');
  const customInput = document.getElementById('commitment-custom-input');
  const btn = document.getElementById('commitment-confirm-btn');
  if (!root || !btn) {
    done();
    return;
  }

  root.removeAttribute('hidden');
  try {
    btn.focus();
  } catch (_) {
    /* ignore */
  }

  const onConfirm = async () => {
    btn.removeEventListener('click', onConfirm);
    btn.disabled = true;

    // Lock in game start — user has seen their debt and said "I'm in"
    try {
      await fetch(stewardApiUrl('/api/start-game'), { method: 'POST' });
    } catch (_) { /* non-fatal — game still proceeds */ }

    persistPromiseAck(customInput && customInput.value);
    root.setAttribute('hidden', '');
    done();
  };

  btn.addEventListener('click', onConfirm);
}

/* ── Play game local reset — clears all play-only localStorage/sessionStorage ─ */
export function resetPlayGame() {
  const keys = [
    STEWARD_SESSION_META_KEY,
    STEWARD_PROMISE_MADE_KEY,
    STEWARD_PROMISE_AT_KEY,
    STEWARD_PROMISE_TEXT_KEY,
    DASHBOARD_ONBOARDING_KEY,
  ];
  try {
    keys.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[play] reset localStorage failed', err);
  }
  try { sessionStorage.removeItem(SESSION_APP_READY_KEY); } catch (_) {}
}
if (typeof window !== 'undefined') window.resetPlayGame = resetPlayGame;

export function initPlayClearLocalBtn() {
  const btn = document.getElementById('play-clear-local-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (
      !window.confirm(
        "Clear local session?\n\nThis only clears this browser's commitment, onboarding, and current play session state. It does not delete your database history.",
      )
    ) {
      return;
    }
    resetPlayGame();
    window.location.href = window.location.pathname;
  });
}

export function initPlayResetBtn() {
  const btn = document.getElementById('play-reset-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (
      !window.confirm(
        'Reset game?\n\nThis deletes the game database history: snapshots, debt account history, baseline, paid-down counter, game start, turn window, climb metrics, notifications, and cached play data.\n\nYour preferences are kept. Add your debts again when ready to begin the new game.',
      )
    ) {
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch(stewardApiUrl('/api/reset-game'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await readJsonRes(res, '/api/reset-game');
      if (!data || !data.ok) {
        throw new Error((data && data.error) || 'reset failed');
      }
    } catch (err) {
      console.error('[play] reset-game', err);
      window.alert(
        `Could not reset game database history. Is Steward running?\n\n${err && err.message ? err.message : err}`,
      );
      btn.disabled = false;
      return;
    }
    resetPlayGame();
    window.location.href = window.location.pathname;
  });
}
