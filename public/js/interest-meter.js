'use strict';

/* ── Live interest meter ─────────────────────────────────────────────────────
   A counter that ticks up the interest accruing on the current balances in real
   time — the visceral "this is costing me money right now" signal. Fed by the
   same monthly-interest figure the panel already computes (balances × APRs).
   Pure client-side, no cost. Hidden until APRs are entered.
   ─────────────────────────────────────────────────────────────────────────── */

const SECONDS_PER_YEAR = 31557600; // 365.25 days

let _perSecond = 0;
let _start = 0;     // anchored once, so the "since you opened" counter is stable
let _raf = null;
let _lastPaint = 0;
let _reduced = false;
try { _reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* ignore */ }

function fmtAccrued(n) {
  // Whole cents — this is a currency value, and 4 decimals (e.g. $0.0514) reads
  // as a rendering glitch. On a real balance the cents still tick visibly; on a
  // tiny balance it moves slowly, which is honest.
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paint() {
  _raf = window.requestAnimationFrame(paint);
  const now = Date.now();
  // Throttle: ~8fps normally, 1fps for reduced-motion users.
  if (now - _lastPaint < (_reduced ? 1000 : 120)) return;
  _lastPaint = now;
  const el = document.getElementById('interest-meter');
  if (!el) return;
  const accrued = _perSecond * ((now - _start) / 1000);
  const perDay = _perSecond * 86400;
  el.innerHTML =
    `<span class="im-label">Interest accruing</span>` +
    `<span class="im-val">$${fmtAccrued(accrued)}</span>` +
    `<span class="im-since">since you opened this · ~$${Math.round(perDay).toLocaleString()}/day</span>`;
}

/**
 * Update the meter with the current monthly interest cost (balances × APRs).
 * Call it whenever that figure is recomputed. Zero / unknown → hide + stop.
 */
export function updateInterestMeter(monthlyInterest) {
  const el = document.getElementById('interest-meter');
  if (!el) return;
  // Screen-reader summary lives on a separate aria-live="polite" element so the
  // ~8fps ticker (aria-live="off") never spams. This is only rewritten here, on
  // recompute, so it announces when the figure meaningfully changes — not per frame.
  const a11y = document.getElementById('interest-meter-a11y');
  const monthly = Number(monthlyInterest);
  if (!Number.isFinite(monthly) || monthly <= 0) {
    el.hidden = true;
    if (a11y) a11y.textContent = '';
    if (_raf) { window.cancelAnimationFrame(_raf); _raf = null; }
    return;
  }
  _perSecond = (monthly * 12) / SECONDS_PER_YEAR;
  if (!_start) _start = Date.now(); // anchor once for a continuous count-up
  el.hidden = false;
  if (a11y) {
    const perDay = Math.round(_perSecond * 86400);
    a11y.textContent = `Your balances are accruing about $${perDay.toLocaleString()} per day in interest.`;
  }
  if (!_raf) paint();
}
