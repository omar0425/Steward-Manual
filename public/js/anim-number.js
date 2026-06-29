'use strict';

/* ── Number roll-up ──────────────────────────────────────────────────────────
   Counts an element's number from its previous value to a new one with an
   ease-out, so headline figures (debt remaining, paid down) feel alive instead
   of snapping. Reduced-motion users — and the first paint — get the value
   instantly. The final frame always lands on the exact value so nothing (tests,
   screen readers) ever reads a half-counted number once it's settled. */

const reduceMotion = () => {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
};

/**
 * @param {HTMLElement} el       target element
 * @param {number} to            new numeric value
 * @param {(v:number)=>string} render  formats a value to display text
 * @param {object} [opts]        { duration=650 }
 */
export function animateNumber(el, to, render, opts = {}) {
  if (!el || typeof render !== 'function' || !Number.isFinite(Number(to))) return;
  const target = Number(to);
  const prev = Number(el.dataset.animVal);
  const hasPrev = Number.isFinite(prev);

  // First paint, no change, or reduced motion → set instantly.
  if (!hasPrev || prev === target || reduceMotion()) {
    el.dataset.animVal = String(target);
    el.textContent = render(target);
    return;
  }

  el.dataset.animVal = String(target);
  const duration = Number(opts.duration) || 650;
  const start = performance.now();
  const from = prev;
  const delta = target - from;

  // Cancel any in-flight roll-up on this element.
  if (el._animRaf) cancelAnimationFrame(el._animRaf);

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    if (t >= 1) {
      el.textContent = render(target); // exact landing
      el._animRaf = null;
      return;
    }
    el.textContent = render(from + delta * eased);
    el._animRaf = requestAnimationFrame(tick);
  };
  el._animRaf = requestAnimationFrame(tick);
}
