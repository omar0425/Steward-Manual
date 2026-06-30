'use strict';

/* ── "How is this calculated?" popover ───────────────────────────────────────
   Hover `title` tooltips are invisible on touch, and this is a mobile-first app.
   Derived values (blended APR, payoff forecast, interest, paid-down) carry a
   tappable ⓘ button — `.info-dot[data-explain]` — that opens one shared,
   dismissible popover with the same plain-language explanation.

   Single delegated controller so dots added by later re-renders just work.
   Accessible: the dot is a real <button> (Enter/Space), Escape closes and
   returns focus, click-outside closes, scroll/resize dismiss to avoid a
   stranded popover. Theming uses the same CSS variables as the rest of the app.
   ─────────────────────────────────────────────────────────────────────────── */

let _popover = null;
let _openDot = null;

function ensurePopover() {
  if (_popover) return _popover;
  const p = document.createElement('div');
  p.id = 'info-popover';
  p.className = 'info-popover';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'How this is calculated');
  p.hidden = true;
  p.tabIndex = -1;
  document.body.appendChild(p);
  _popover = p;
  return p;
}

function positionPopover(p, dot) {
  const r = dot.getBoundingClientRect();
  const margin = 8;
  const pw = p.offsetWidth;
  const ph = p.offsetHeight;
  let left = r.left;
  if (left + pw + margin > window.innerWidth) left = window.innerWidth - pw - margin;
  if (left < margin) left = margin;
  // Prefer below the dot; flip above when there isn't room below.
  let top = r.bottom + 6;
  if (top + ph + margin > window.innerHeight && r.top - ph - 6 > margin) {
    top = r.top - ph - 6;
  }
  p.style.left = `${Math.round(left)}px`;
  p.style.top = `${Math.round(top)}px`;
}

function closePopover(restoreFocus) {
  if (!_popover || _popover.hidden) return;
  _popover.hidden = true;
  _popover.textContent = '';
  const dot = _openDot;
  _openDot = null;
  if (dot) {
    dot.setAttribute('aria-expanded', 'false');
    if (restoreFocus) { try { dot.focus(); } catch (_) { /* ignore */ } }
  }
}

function openPopover(dot) {
  const text = dot.getAttribute('data-explain');
  if (!text) return;
  const p = ensurePopover();
  p.textContent = text;
  p.hidden = false;
  positionPopover(p, dot); // measured after it's visible
  _openDot = dot;
  dot.setAttribute('aria-expanded', 'true');
  try { p.focus(); } catch (_) { /* ignore */ }
}

document.addEventListener('click', (e) => {
  const dot = e.target.closest && e.target.closest('.info-dot');
  if (dot) {
    e.preventDefault();
    e.stopPropagation();
    if (_openDot === dot) closePopover(true);
    else { if (_openDot) closePopover(false); openPopover(dot); }
    return;
  }
  if (_popover && !_popover.hidden && !(e.target.closest && e.target.closest('#info-popover'))) {
    closePopover(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopover(true);
});

window.addEventListener('resize', () => closePopover(false));
window.addEventListener('scroll', () => closePopover(false), true);

/**
 * Build an info-dot button for createElement render sites. `explain` is the
 * plain-language "how this is calculated" text shown in the popover.
 */
export function createInfoDot(explain) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'info-dot';
  b.setAttribute('aria-label', 'How is this calculated?');
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('data-explain', String(explain == null ? '' : explain));
  b.textContent = 'ⓘ';
  return b;
}
