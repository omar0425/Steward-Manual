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
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.id = 'steward-ai-dialog';
  overlay.className = 'steward-ai-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
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

  const close = () => {
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus(); } catch { /* ignore */ }
    }
  };

  overlay.querySelector('.steward-ai-dismiss').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close();
    }
  });

  const btn = overlay.querySelector('.steward-ai-dismiss');
  if (btn) { try { btn.focus(); } catch { /* ignore */ } }
}

/**
 * Trigger the Steward AI dialog after a fresh snapshot. Short-circuits when:
 *   - the snapshot is not Live (≥10 min old),
 *   - we've already shown a dialog for this snapshot,
 *   - the server returns 204 (no key, no data, or generation failure).
 *
 * Errors are swallowed: a failing AI fetch must never break the dashboard.
 */
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
