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
  syncPromiseToServer(customText);
}

/* Mirror the promise server-side so a new device/browser doesn't re-ask a
   mid-climb user to commit. Fire-and-forget — localStorage stays the fast path. */
function syncPromiseToServer(text) {
  try {
    void fetch(stewardApiUrl('/api/config/promise'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text != null ? { text: String(text) } : {}),
    });
  } catch (_) { /* offline — local copy still works */ }
}

/* Server says the promise was already made (e.g. on another device) — copy it
   into localStorage so every later boot takes the fast local path. */
export function hydratePromiseFromServer(data) {
  try {
    localStorage.setItem(STEWARD_PROMISE_MADE_KEY, 'true');
    if (data && data.madeAt) localStorage.setItem(STEWARD_PROMISE_AT_KEY, data.madeAt);
    const t = (data && data.text || '').trim();
    if (t && !localStorage.getItem(STEWARD_PROMISE_TEXT_KEY)) {
      localStorage.setItem(STEWARD_PROMISE_TEXT_KEY, t);
    }
  } catch (err) {
    console.warn('[commitment] could not hydrate', err);
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

/* "Clear game data" — wipes snapshots, debt accounts, history, and climb
   baseline. Account, password, and email are preserved. Renamed from the old
   "Reset game" to make its scope obvious. The server endpoint is unchanged
   (POST /api/reset-game). */
export function initPlayResetBtn() {
  const btn = document.getElementById('play-reset-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (
      !window.confirm(
        'Clear game data?\n\n' +
        'This deletes:\n' +
        '  • All snapshots and debt account history\n' +
        '  • Your climb baseline and progress counters\n' +
        '  • Turn window and milestone notifications\n\n' +
        'Your account (username, password, email) is preserved. ' +
        'You’ll stay logged in and can add debts to start a new climb.\n\n' +
        'This cannot be undone.'
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
        `Could not clear game data. Is Steward running?\n\n${err && err.message ? err.message : err}`,
      );
      btn.disabled = false;
      return;
    }
    resetPlayGame();
    window.location.href = window.location.pathname;
  });
}

/* "Delete account" — full account nuke. Requires the user to type their
   username (or "delete" if they have no username on file) to confirm. On
   success: clears local storage, alerts the user, and redirects to /login
   with an `accountDeleted=1` flag so the login page can show a banner. */
export function initDeleteAccountBtn() {
  const btn = document.getElementById('play-delete-account-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    /* First confirm — explains what will happen. */
    const ok = window.confirm(
      'Delete your account?\n\n' +
      'This permanently deletes:\n' +
      '  • Your username, password, and email\n' +
      '  • All snapshots, debt accounts, and history\n' +
      '  • Active sessions on every device\n\n' +
      'You will be logged out and redirected to the sign-in page.\n\n' +
      'THIS CANNOT BE UNDONE.'
    );
    if (!ok) return;

    /* Second confirm — typed phrase, so accidental Enter won't delete. */
    const phrase = window.prompt(
      'Type the word DELETE (in capitals) to confirm you want to permanently delete your account.',
      ''
    );
    if (phrase !== 'DELETE') {
      if (phrase != null) {
        window.alert('Account NOT deleted — confirmation text did not match. (You must type DELETE in capitals.)');
      }
      return;
    }

    btn.disabled = true;
    try {
      const res = await fetch(stewardApiUrl('/api/auth/delete-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await readJsonRes(res, '/api/auth/delete-account');
      if (!data || !data.ok) {
        throw new Error((data && data.error) || 'delete failed');
      }
    } catch (err) {
      console.error('[play] delete-account', err);
      window.alert(
        `Could not delete account. Try again, or contact support if the problem persists.\n\n${err && err.message ? err.message : err}`,
      );
      btn.disabled = false;
      return;
    }
    resetPlayGame();
    window.alert('Your account has been deleted. You’ll be redirected to the sign-in page.');
    window.location.href = '/login.html?accountDeleted=1';
  });
}

/* ── Inline commitment-reason editor ─────────────────────────────────────── */
/* Click pencil → swap display for input, save on Enter/blur, cancel on Escape. */
export function initCommitmentReasonEditor() {
  const wrap = document.getElementById('commitment-reason-wrap');
  if (!wrap || wrap.dataset.editorBound === '1') return;
  wrap.dataset.editorBound = '1';

  const displayEl = document.getElementById('commitment-reason-display');
  const editBtn = document.getElementById('commitment-reason-edit-btn');
  const inputEl = document.getElementById('commitment-reason-input');
  if (!displayEl || !editBtn || !inputEl) return;

  function readReason() {
    try {
      return (localStorage.getItem(STEWARD_PROMISE_TEXT_KEY) || '').trim();
    } catch {
      return '';
    }
  }
  function writeReason(text) {
    try {
      const t = (text || '').trim();
      if (t) localStorage.setItem(STEWARD_PROMISE_TEXT_KEY, t);
      else localStorage.removeItem(STEWARD_PROMISE_TEXT_KEY);
    } catch (err) {
      console.warn('[commitment] could not save reason', err);
    }
    syncPromiseToServer(text);
  }
  function refreshDisplay() {
    const r = readReason();
    if (r) {
      displayEl.textContent = r;
      displayEl.hidden = false;
      editBtn.textContent = '✎';
      editBtn.setAttribute('aria-label', 'Edit your reason');
      editBtn.title = 'Edit your reason';
      editBtn.dataset.empty = '';
    } else {
      displayEl.hidden = true;
      editBtn.textContent = '+ Add your reason';
      editBtn.setAttribute('aria-label', 'Add your reason for climbing');
      editBtn.title = 'Add your reason for climbing';
      editBtn.dataset.empty = '1';
    }
  }
  function enterEdit() {
    const current = readReason();
    inputEl.value = current;
    inputEl.placeholder = 'Write your reason — keep it close.';
    inputEl.hidden = false;
    displayEl.hidden = true;
    editBtn.hidden = true;
    try { inputEl.focus(); inputEl.select(); } catch (_) { /* ignore */ }
  }
  function exitEdit(save) {
    if (save) writeReason(inputEl.value);
    inputEl.hidden = true;
    editBtn.hidden = false;
    refreshDisplay();
  }

  editBtn.addEventListener('click', enterEdit);
  displayEl.addEventListener('click', enterEdit);
  inputEl.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); exitEdit(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); exitEdit(false); }
  });
  inputEl.addEventListener('blur', () => exitEdit(true));

  refreshDisplay();
}
