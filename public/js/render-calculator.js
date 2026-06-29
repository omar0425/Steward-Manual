'use strict';

/**
 * Two-way paydown ↔ percentage calculator + average-APR readout.
 *
 * Percentages are of your CURRENT total debt (stats.debtRemaining):
 *   $ paid  → %   :  dollars / debt × 100
 *   %       → $   :  pct / 100 × debt
 *
 * Also surfaces the balance-weighted average APR across your debts
 * (stats.avgApr, computed server-side so it matches the payoff forecast).
 *
 * Pure client-side. The debt basis is refreshed from every status render so the
 * math always tracks what you currently owe.
 */

/** Pure: percent of debt a dollar paydown represents (null when no debt). */
export function pctOfDebt(dollars, debt) {
  const d = Number(dollars);
  const b = Number(debt);
  if (!Number.isFinite(d) || d < 0 || !Number.isFinite(b) || b <= 0) return null;
  return (d / b) * 100;
}

/** Pure: dollars to pay to clear a given percent of debt (null when no debt). */
export function dollarsForPct(pct, debt) {
  const p = Number(pct);
  const b = Number(debt);
  if (!Number.isFinite(p) || p < 0 || !Number.isFinite(b) || b <= 0) return null;
  return (p / 100) * b;
}

let _debt = 0;
let _wired = false;

function fmtPct(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function recompute(src) {
  const d = document.getElementById('calc-dollars');
  const p = document.getElementById('calc-percent');
  if (!d || !p || _debt <= 0) return;
  if (src === 'dollars') {
    if (d.value === '') { p.value = ''; return; }
    const pct = pctOfDebt(parseFloat(d.value), _debt);
    if (pct != null) p.value = fmtPct(pct);
  } else {
    if (p.value === '') { d.value = ''; return; }
    const dollars = dollarsForPct(parseFloat(p.value), _debt);
    if (dollars != null) d.value = String(Math.round(dollars));
  }
}

function wireOnce() {
  if (_wired) return;
  const d = document.getElementById('calc-dollars');
  const p = document.getElementById('calc-percent');
  if (!d || !p) return;
  d.addEventListener('input', () => recompute('dollars'));
  p.addEventListener('input', () => recompute('percent'));
  _wired = true;
}

/** Called on every status render. Updates the debt basis + average-APR readout. */
export function renderCalculator(stats) {
  const card = document.getElementById('paydown-calc-section');
  if (!card) return;

  _debt = Number(stats && stats.debtRemaining);
  if (!Number.isFinite(_debt) || _debt < 0) _debt = 0;

  const basis = document.getElementById('calc-basis');
  if (basis) {
    basis.textContent = _debt > 0
      ? `Percentages are of your $${Math.round(_debt).toLocaleString()} current debt.`
      : 'Add a debt first — then this works against what you owe.';
  }

  const aprEl = document.getElementById('calc-avg-apr');
  if (aprEl) {
    const apr = Number(stats && stats.avgApr);
    if (Number.isFinite(apr) && apr > 0) {
      const txt = `${fmtPct(apr)}%`;
      aprEl.textContent = stats && stats.avgAprMissing ? `${txt} · some APRs not set` : txt;
    } else {
      aprEl.textContent = (stats && stats.avgAprMissing) ? 'Set your APRs to see this' : '—';
    }
  }

  wireOnce();
  // Refresh outputs against the (possibly changed) debt basis without stomping a
  // field the user may be mid-edit: recompute from whichever side has a value.
  const d = document.getElementById('calc-dollars');
  recompute(d && d.value !== '' ? 'dollars' : 'percent');
}
