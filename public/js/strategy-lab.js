'use strict';

/* Strategy Lab client — drives /api/payoff-plan/compare and renders the
   comparison. The heavy lifting (simulator + LP solve) happens server-side,
   on the user's own instance; no balance ever leaves it. */

import { stewardApiUrl } from './api.js';

let _wired = false;
let _defaultBudget = null;
let _hasAnyApr = true;

const STRATEGY_LABELS = {
  avalanche: 'Avalanche',
  snowball: 'Snowball',
  'promo-aware': 'Promo-aware',
  'optimal-lp': 'Optimal (LP)',
};

function fmt$(n) {
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

function debtFreeLabel(months) {
  if (months == null) return 'not at this budget';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  const when = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return `${when} · ${months} mo`;
}

function renderResults(body) {
  const results = document.getElementById('lab-results');
  const tbody = document.getElementById('lab-table-body');
  if (!results || !tbody) return;
  tbody.innerHTML = '';

  // Best = least interest among strategies that reach debt-free.
  const free = body.strategies.filter((s) => s.debtFree);
  const best = free.length
    ? free.reduce((a, b) => (b.totalInterest < a.totalInterest ? b : a))
    : null;

  for (const s of body.strategies) {
    const tr = document.createElement('tr');
    if (best && s === best) tr.className = 'lab-row-best';
    const name = document.createElement('td');
    name.textContent = STRATEGY_LABELS[s.strategy] || s.strategy;
    if (best && s === best) {
      const badge = document.createElement('span');
      badge.className = 'lab-best-badge';
      badge.textContent = 'BEST';
      name.appendChild(badge);
    }
    const when = document.createElement('td');
    when.textContent = debtFreeLabel(s.months);
    const interest = document.createElement('td');
    interest.textContent = s.debtFree ? fmt$(s.totalInterest) : '—';
    const vs = document.createElement('td');
    const delta = Number(s.interestVsAvalanche);
    if (!s.debtFree || !Number.isFinite(delta) || Math.abs(delta) < 1) {
      vs.textContent = '—';
    } else if (delta > 0) {
      vs.textContent = `saves ${fmt$(delta)}`;
      vs.className = 'lab-saves';
    } else {
      vs.textContent = `costs ${fmt$(-delta)} more`;
      vs.className = 'lab-costs';
    }
    tr.append(name, when, interest, vs);
    tbody.appendChild(tr);
  }

  // The winning strategy's first-month allocation.
  const fmWrap = document.getElementById('lab-first-month');
  const fmList = document.getElementById('lab-first-month-list');
  if (fmWrap && fmList) {
    fmList.innerHTML = '';
    if (best && Array.isArray(best.firstMonth) && best.firstMonth.length) {
      for (const p of [...best.firstMonth].sort((a, b) => b.amount - a.amount)) {
        const row = document.createElement('div');
        row.className = 'lab-alloc-row';
        const n = document.createElement('span');
        n.className = 'lab-alloc-name';
        n.textContent = p.name;
        const v = document.createElement('span');
        v.className = 'lab-alloc-amount';
        v.textContent = fmt$(p.amount);
        row.append(n, v);
        fmList.appendChild(row);
      }
      fmWrap.hidden = false;
    } else {
      fmWrap.hidden = true;
    }
  }

  // Promo cliffs ahead — the reason this panel exists.
  const cliffs = document.getElementById('lab-cliffs');
  if (cliffs) {
    if (Array.isArray(body.promoCliffs) && body.promoCliffs.length) {
      cliffs.textContent = `⚠ Promo cliff${body.promoCliffs.length > 1 ? 's' : ''} ahead: ` + body.promoCliffs
        .map((c) => `${c.name} jumps to ${c.postPromoApr}% in ${c.inMonths} mo${c.deferredInterest ? ' (deferred interest — retroactive if missed)' : ''}`)
        .join(' · ');
      cliffs.hidden = false;
    } else {
      cliffs.textContent = '';
      cliffs.hidden = true;
    }
  }

  results.hidden = false;
}

async function runComparison() {
  const input = document.getElementById('lab-budget');
  const note = document.getElementById('lab-note');
  const btn = document.getElementById('lab-run-btn');
  // An empty field falls back to the placeholder default (the user's own
  // observed monthly pace) so the button always does something sensible.
  const raw = String(input && input.value || '').trim() || (_defaultBudget ? String(_defaultBudget) : '');
  const budget = parseFloat(raw.replace(',', '.'));
  const say = (msg) => { if (note) { note.textContent = msg; note.hidden = !msg; } };
  if (!_hasAnyApr) {
    say('Add an APR before comparing interest-saving strategies.');
    return;
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    say('Enter the total dollars you can put toward debt each month.');
    return;
  }
  say('');
  if (btn) { btn.disabled = true; btn.textContent = 'Comparing…'; }
  try {
    const res = await fetch(stewardApiUrl(`/api/payoff-plan/compare?budget=${encodeURIComponent(budget)}`));
    const body = await res.json();
    if (!res.ok || !body.ok) {
      say(body && body.error ? body.error : 'Comparison failed — try again.');
      return;
    }
    if (!body.budgetCoversMinimums) {
      say(`Heads up: your minimums alone are ~${fmt$(body.minimumsMonthly)}/mo — this budget can't cover them.`);
    }
    renderResults(body);
    const exp = document.getElementById('lab-lp-export');
    if (exp) exp.href = stewardApiUrl(`/api/payoff-plan/compare?budget=${encodeURIComponent(budget)}&format=lp`);
  } catch {
    say('Comparison failed — check your connection and try again.');
  } finally {
    if (btn) { btn.disabled = !_hasAnyApr; btn.textContent = 'Compare strategies'; }
  }
}

/** Called on every status render — seeds the budget default and wires once. */
export function renderStrategyLab(stats) {
  const section = document.getElementById('strategy-lab-section');
  if (!section) return;
  const pace = Number(stats && stats.monthlyPace);
  if (Number.isFinite(pace) && pace > 0) _defaultBudget = Math.round(pace);
  const input = document.getElementById('lab-budget');
  if (input && !input.value && _defaultBudget) input.placeholder = String(_defaultBudget);
  _hasAnyApr = !(stats && stats.payoffPlan && stats.payoffPlan.hasApr === false);
  const gate = document.getElementById('lab-apr-gate');
  const btn = document.getElementById('lab-run-btn');
  if (gate) gate.hidden = _hasAnyApr;
  if (btn) btn.disabled = !_hasAnyApr;
  if (!_hasAnyApr) {
    const results = document.getElementById('lab-results');
    if (results) results.hidden = true;
  }
  if (_wired) return;
  if (!btn || !input) return;
  btn.addEventListener('click', runComparison);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runComparison(); } });
  const addAprs = document.getElementById('lab-add-aprs-btn');
  if (addAprs) {
    addAprs.addEventListener('click', () => {
      const aprPanel = document.getElementById('apr-form-panel');
      const aprEdit = document.getElementById('apr-edit-btn');
      if (aprPanel && aprPanel.hidden && aprEdit) aprEdit.click();
      (aprPanel || aprEdit)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  // Empty input + a known pace → run with the pace on first open, so the
  // panel never opens onto a dead form.
  _wired = true;
}
