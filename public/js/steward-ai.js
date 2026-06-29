'use strict';

/**
 * Steward AI dialog — Pennybags-voiced commentary on each fresh snapshot.
 *
 *   - Server picks one of: rotating modes (adversary / today's deal /
 *     climb forecast / if-you-do-nothing / anti-flattery / observation) or
 *     deterministic events (closing certificate / quarterly letter).
 *   - Client renders per-mode framing (different eyebrow + title styling).
 *   - 204 from the server → render nothing (no API key, or skip condition).
 *   - localStorage tracks the snapshot pulled_at we've already shown, so
 *     the dialog appears once per fresh snapshot.
 */

import { stewardApiUrl } from './api.js';

const SEEN_KEY = 'steward-ai-seen-at';

// Per-mode framing copy. Order: eyebrow, default title, dismiss button.
// The server can override `title` (e.g. for the quarterly letter / closing
// certificate) but never the eyebrow — the eyebrow signals which TYPE of
// communique you're looking at.
const MODE_FRAMING = {
  closing_certificate: {
    eyebrow: 'Notice of Closure',
    title:   'An Account is Struck from the Ledger',
    dismiss: 'Acknowledged',
    cardClass: 'is-certificate',
  },
  quarterly_letter: {
    eyebrow: 'Quarterly Letter',
    title:   'A Letter from the Steward',
    dismiss: 'Read',
    cardClass: 'is-letter',
  },
  adversary: {
    eyebrow: 'On the Adversary',
    title:   'Interest, This Month',
    dismiss: 'Reclaim it',
    cardClass: '',
  },
  todays_deal: {
    eyebrow: "Today's Deal",
    title:   'A Trade Worth Making',
    dismiss: 'Take it',
    cardClass: '',
  },
  climb_forecast: {
    eyebrow: 'The Climb Forecast',
    title:   'A Date on the Calendar',
    dismiss: 'Onward',
    cardClass: '',
  },
  if_you_do_nothing: {
    eyebrow: 'Idle Silver',
    title:   "If You Do Nothing",
    dismiss: 'I will not',
    cardClass: '',
  },
  anti_flattery: {
    eyebrow: 'A Plain Word',
    title:   'The Turn Went Sideways',
    dismiss: 'Understood',
    cardClass: '',
  },
  observation: {
    eyebrow: 'Steward AI',
    title:   'A Word From Your Steward',
    dismiss: 'Onward',
    cardClass: '',
  },
};

// Ceremonial messages earn a centered, focus-trapping modal — they're rare and
// momentous (an account closed; a quarter turned). Everything else is routine
// coaching and shows as a non-blocking corner toast, so the user can keep
// working and dismiss it on their own time.
const CEREMONIAL = new Set(['closing_certificate', 'quarterly_letter']);

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}
function writeSeen(pulledAt) {
  try { localStorage.setItem(SEEN_KEY, pulledAt); } catch { /* ignore */ }
}

function showDialog({ mode, title, text }) {
  const existing = document.getElementById('steward-ai-dialog');
  if (existing) existing.remove();

  const framing = MODE_FRAMING[mode] || MODE_FRAMING.observation;
  const isToast = !CEREMONIAL.has(mode);
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.id = 'steward-ai-dialog';
  overlay.className = 'steward-ai-overlay' + (isToast ? ' steward-ai-overlay--toast' : '');
  if (isToast) {
    // A toast announces itself politely without stealing focus or trapping it.
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
  } else {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
  }
  overlay.setAttribute('aria-labelledby', 'steward-ai-title');
  overlay.dataset.mode = mode || 'observation';

  // All user-visible fields go through textContent below; innerHTML here only
  // builds the static skeleton, so model output / titles can't inject HTML.
  overlay.innerHTML = `
    <div class="steward-ai-card ${framing.cardClass}">
      <div class="steward-ai-eyebrow"></div>
      <h3 class="steward-ai-title" id="steward-ai-title"></h3>
      <p class="steward-ai-body"></p>
      <div class="steward-ai-actions">
        <button type="button" class="steward-ai-dismiss"></button>
      </div>
    </div>
  `;
  overlay.querySelector('.steward-ai-eyebrow').textContent = framing.eyebrow;
  overlay.querySelector('.steward-ai-title').textContent = title || framing.title;
  overlay.querySelector('.steward-ai-body').textContent = text;
  overlay.querySelector('.steward-ai-dismiss').textContent = framing.dismiss;
  document.body.appendChild(overlay);

  let autoTimer = null;
  // Hoisted so EVERY close path (dismiss, backdrop, auto-timeout, Escape) removes
  // the document-level keydown listener. Previously only the Escape branch removed
  // it, so toasts that closed any other way leaked a listener (and a closure
  // retaining the removed overlay) on every snapshot.
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    // Only the modal stole focus, so only the modal restores it. Returning
    // focus after a toast would yank the user away from what they were doing.
    if (!isToast && previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus(); } catch { /* ignore */ }
    }
  };

  overlay.querySelector('.steward-ai-dismiss').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  if (isToast) {
    // Linger long enough to read, then fade on its own; hovering pauses it.
    const startTimer = () => { autoTimer = setTimeout(close, 14000); };
    overlay.addEventListener('mouseenter', () => { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } });
    overlay.addEventListener('mouseleave', () => { if (!autoTimer) startTimer(); });
    startTimer();
  } else {
    // Modal: backdrop click closes it, and focus moves to the dismiss button.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const btn = overlay.querySelector('.steward-ai-dismiss');
    if (btn) { try { btn.focus(); } catch { /* ignore */ } }
  }
}

/**
 * Trigger the Steward AI dialog after a fresh snapshot. Short-circuits when:
 *   - the snapshot is not Live (≥10 min old),
 *   - we've already shown a dialog for this snapshot,
 *   - the server returns 204 (no key, no data, or generation failure).
 *
 * Errors are swallowed: a failing AI fetch must never break the dashboard.
 */
/* "Ask the Steward" panel — suggested-question chips that query the AI about
   the user's own numbers. Gated on aiEnabled (no API key → panel stays hidden);
   the setup-mode CSS handles hiding it before a climb starts. Bound once. */
export function initAskSteward() {
  const panel = document.getElementById('ask-steward-panel');
  const chipsWrap = document.getElementById('ask-steward-chips');
  const answerEl = document.getElementById('ask-steward-answer');
  if (!panel || !chipsWrap || !answerEl || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  // Reveal only when the server reports an API key is configured. Setup-mode
  // visibility is handled by the dashboard-only-section CSS, so we don't gate
  // on climb state here — the panel appears automatically once the climb starts.
  fetch(stewardApiUrl('/api/status'))
    .then((r) => r.json())
    .then((status) => { if (status && status.aiEnabled) panel.hidden = false; })
    .catch(() => { /* leave hidden */ });

  let busy = false;
  const setChipsDisabled = (v) => chipsWrap.querySelectorAll('.ask-steward-chip').forEach((c) => { c.disabled = v; });

  chipsWrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ask-steward-chip');
    if (!btn || busy) return;
    const question = btn.textContent.trim();
    busy = true;
    setChipsDisabled(true);
    answerEl.hidden = false;
    answerEl.classList.remove('is-error');
    answerEl.textContent = 'The Steward is considering…';
    try {
      const res = await fetch(stewardApiUrl('/api/steward-ai/ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (res.status === 204) { panel.hidden = true; return; } // AI turned off server-side
      const data = await res.json().catch(() => null);
      if (data && data.ok && data.text) {
        answerEl.textContent = data.text;
      } else {
        answerEl.classList.add('is-error');
        answerEl.textContent = (data && data.error) || 'The Steward could not answer just now.';
      }
    } catch (_) {
      answerEl.classList.add('is-error');
      answerEl.textContent = 'Could not reach the Steward. Try again.';
    } finally {
      busy = false;
      setChipsDisabled(false);
    }
  });
}

export async function maybeShowStewardAiComment(status) {
  if (!status || !status.ready || !status.meta) return;
  const pulledAt = status.meta.lastSnapshotAt;
  const freshness = status.meta.freshness;
  if (!pulledAt || freshness !== 'Live') return;
  if (readSeen() === pulledAt) return;

  let res;
  try {
    res = await fetch(stewardApiUrl('/api/steward-ai/comment'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
  } catch {
    return;
  }

  if (res.status === 204) {
    writeSeen(pulledAt);
    return;
  }
  if (!res.ok) return;

  let data;
  try { data = await res.json(); } catch { return; }
  if (!data || !data.ok || !data.text) return;

  writeSeen(pulledAt);
  showDialog({ mode: data.mode, title: data.title, text: data.text });
}
