'use strict';

import { fmtDollar, fmtSignedDollar } from './format.js';
import { stewardApiUrl } from './api.js';
import { updateInterestMeter } from './interest-meter.js';

let _aprRates = {};
let _debtHistory = {};
let _lastDebtStats = null;
let _debtSortMode = (() => {
  try { return localStorage.getItem('steward-debt-sort') || 'balance'; } catch { return 'balance'; }
})();

/* Collapse the account list beyond this many rows; expanding lasts the session. */
const DEBT_LIST_COLLAPSE_AT = 8;
let _debtListExpanded = false;

/* Latest APR-derived totals, consumed by the chart's what-if slider to turn
   "months sooner" into "~$ interest saved" via a blended rate. */
let _lastInterestSummary = { monthlyInterest: 0, totalDebt: 0 };
export function getInterestSummary() {
  return _lastInterestSummary;
}

/* ── "Pay this next" recommendation card ──────────────────────────────────────
   Shows one target — avalanche (highest APR, saves most) or snowball (smallest
   balance, fastest win) — with a toggle. The plan is computed server-side
   (stats.payoffPlan) so the card and the Steward always agree. */
let _lastPayoffStats = null;

function payoffMethodPref(plan) {
  let pref;
  try { pref = localStorage.getItem('steward-payoff-method'); } catch { pref = null; }
  if (pref !== 'avalanche' && pref !== 'snowball') pref = plan.recommended;
  // Avalanche needs APRs; fall back if the user's saved pref can't be honored.
  if (pref === 'avalanche' && !plan.avalanche) pref = 'snowball';
  return pref;
}

export function renderPayThisNext(stats) {
  _lastPayoffStats = stats;
  const section = document.getElementById('pay-next-section');
  if (!section) return;
  const plan = stats && stats.payoffPlan;
  if (!plan || (!plan.avalanche && !plan.snowball)) { section.hidden = true; return; }

  const method = payoffMethodPref(plan);
  const targetEl = document.getElementById('pay-next-target');
  const reasonEl = document.getElementById('pay-next-reason');

  const t = method === 'avalanche' && plan.avalanche ? plan.avalanche.target : plan.snowball.target;
  const aprBit = Number.isFinite(Number(t.apr)) && Number(t.apr) > 0 ? ` · ${Number(t.apr)}% APR` : '';
  if (targetEl) targetEl.innerHTML = `<span class="pay-next-name">${escapeText(t.name)}</span><span class="pay-next-bal">${fmtDollar(Math.round(t.balance))}${aprBit}</span>`;

  if (reasonEl) {
    if (method === 'avalanche' && plan.avalanche) {
      const mi = Number(plan.avalanche.monthlyInterest);
      const miBit = Number.isFinite(mi) && mi > 0 ? ` It's costing you about ${fmtDollar(Math.round(mi))}/mo in interest right now.` : '';
      reasonEl.textContent = `Highest interest rate — clearing this first saves you the most money.${miBit}`;
    } else {
      reasonEl.textContent = `Smallest balance — knock it out fast for a quick win, then roll that payment into the next one.`;
    }
  }

  // Toggle state + wiring (rebound each render; cheap and idempotent).
  const toggle = document.getElementById('pay-next-toggle');
  if (toggle) {
    for (const tab of toggle.querySelectorAll('.pay-next-tab')) {
      const m = tab.dataset.method;
      const disabled = m === 'avalanche' && !plan.avalanche;
      tab.disabled = disabled;
      tab.title = disabled ? 'Add APRs to your accounts to compare interest' : tab.title;
      tab.classList.toggle('active', m === method && !disabled);
      tab.setAttribute('aria-pressed', String(m === method && !disabled));
      tab.onclick = () => {
        try { localStorage.setItem('steward-payoff-method', m); } catch { /* ignore */ }
        renderPayThisNext(_lastPayoffStats);
      };
    }
  }
  section.hidden = false;
}

function escapeText(s) {
  const d = document.createElement('span');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

/* Paid-off celebration. The list rebuilds several times per view (initial
   render, then again when the async debt-history fetch resolves), so a class
   added once gets wiped almost immediately. Instead the renderer re-applies it
   on every rebuild for a short window after the account is queued — the
   animation simply replays, which reads as one continuous celebration. The
   window self-expires so it fires only for the pull that paid the account off. */
const CELEBRATE_WINDOW_MS = 2800;
const _celebrateUntil = new Map(); // account name → timestamp the flash ends

export function queuePaidOffCelebration(name) {
  const wanted = String(name || '').trim();
  if (!wanted || _celebrateUntil.has(wanted)) return;
  _celebrateUntil.set(wanted, Date.now() + CELEBRATE_WINDOW_MS);
  if (_lastDebtStats) fillDebtAccountsList(_lastDebtStats);
}

async function loadDebtPanelData(options = {}) {
  const rerender = options.rerender !== false;
  try {
    const [ratesRes, histRes] = await Promise.all([
      fetch(stewardApiUrl('/api/config/interest-rates')),
      fetch(stewardApiUrl(`/api/debt-history?t=${Date.now()}`)),
    ]);
    const ratesData = await ratesRes.json();
    const histData  = await histRes.json();
    _aprRates    = (ratesData && typeof ratesData.rates === 'object' && !Array.isArray(ratesData.rates)) ? ratesData.rates : {};
    _debtHistory = (histData && typeof histData.byAccount === 'object') ? histData.byAccount : {};
  } catch { _aprRates = {}; _debtHistory = {}; }
  if (rerender && _lastDebtStats) fillDebtAccountsList(_lastDebtStats);
}

loadDebtPanelData();

export async function refreshDebtPanelData() {
  await loadDebtPanelData({ rerender: false });
}

export function setDebtSortMode(mode) {
  _debtSortMode = mode;
  try { localStorage.setItem('steward-debt-sort', mode); } catch {}
  if (_lastDebtStats) fillDebtAccountsList(_lastDebtStats);
}

async function saveAprRates() {
  try {
    const res = await fetch(stewardApiUrl('/api/config/interest-rates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates: _aprRates }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function toggleAprForm() {
  const panel = document.getElementById('apr-form-panel');
  const btn = document.getElementById('apr-edit-btn');
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    if (btn) btn.classList.remove('active');
    return;
  }
  buildAprForm(panel);
  panel.hidden = false;
  if (btn) btn.classList.add('active');
}

function buildAprForm(panel) {
  const accounts = (_lastDebtStats && _lastDebtStats.debtAccountLines) || [];
  panel.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'apr-form';

  for (const acct of accounts) {
    const row = document.createElement('div');
    row.className = 'apr-form-row';

    const label = document.createElement('label');
    label.className = 'apr-form-label';
    label.textContent = acct.name || 'Account';
    label.htmlFor = `apr-input-${acct.id}`;

    const wrap = document.createElement('div');
    wrap.className = 'apr-form-input-wrap';

    const input = document.createElement('input');
    input.type = 'number';
    input.id = `apr-input-${acct.id}`;
    input.min = '0';
    input.max = '100';
    input.step = '0.01';
    input.className = 'apr-form-input';
    input.dataset.accountId = acct.id;
    input.placeholder = '—';
    const rateVal = _aprRates[acct.id];
    if (rateVal != null && Number.isFinite(rateVal)) input.value = rateVal;

    const suffix = document.createElement('span');
    suffix.className = 'apr-form-suffix';
    suffix.textContent = '%';

    wrap.appendChild(input);
    wrap.appendChild(suffix);
    row.appendChild(label);
    row.appendChild(wrap);
    form.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'apr-form-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'apr-form-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    panel.hidden = true;
    const btn = document.getElementById('apr-edit-btn');
    if (btn) btn.classList.remove('active');
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'apr-form-save';
  save.textContent = 'Save rates';
  save.addEventListener('click', async () => {
    const inputs = form.querySelectorAll('.apr-form-input');
    for (const inp of inputs) {
      const id = inp.dataset.accountId;
      const raw = inp.value.trim();
      if (raw === '') {
        delete _aprRates[id];
      } else {
        const val = parseFloat(raw);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
          _aprRates[id] = Math.round(val * 100) / 100;
        }
      }
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    const ok = await saveAprRates();
    save.disabled = false;
    if (!ok) {
      save.textContent = 'Save failed — retry';
      save.style.color = 'var(--neg, #f87171)';
      return;
    }
    save.textContent = 'Save rates';
    save.style.color = '';
    panel.hidden = true;
    const btn = document.getElementById('apr-edit-btn');
    if (btn) btn.classList.remove('active');
    if (_lastDebtStats) fillDebtAccountsList(_lastDebtStats);
  });

  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);
  panel.appendChild(form);

  const firstEmpty = form.querySelector('.apr-form-input:not([value])') ||
                     [...form.querySelectorAll('.apr-form-input')].find(i => !i.value);
  const firstInput = form.querySelector('.apr-form-input');
  (firstEmpty || firstInput)?.focus();
}

function buildSparklineSvg(points) {
  if (!points || points.length < 2) return null;
  const W = 60, H = 14;
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return null;
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = points[points.length - 1] - points[0];
  const color = trend < 0 ? 'var(--emerald)' : trend > 0 ? 'var(--rose)' : 'var(--text-3)';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.style.cssText = 'display:block;overflow:visible';
  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', coords);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', color);
  poly.setAttribute('stroke-width', '1.5');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  svg.appendChild(poly);
  return svg;
}

function buildDebtBalanceBar(balance, maxBalance) {
  const b = Number(balance);
  const m = Number(maxBalance);
  if (!Number.isFinite(b) || !Number.isFinite(m) || b <= 0 || m <= 0) return null;

  const W = 60;
  const H = 14;
  const fillW = Math.max(4, Math.min(W, (b / m) * W));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('aria-label', 'Debt balance share');
  svg.style.cssText = 'display:block;overflow:visible';

  const track = document.createElementNS(ns, 'line');
  track.setAttribute('x1', '0');
  track.setAttribute('x2', String(W));
  track.setAttribute('y1', String(H / 2));
  track.setAttribute('y2', String(H / 2));
  track.setAttribute('stroke', 'rgba(108, 93, 72, 0.22)');
  track.setAttribute('stroke-width', '2.5');
  track.setAttribute('stroke-linecap', 'round');

  const fill = document.createElementNS(ns, 'line');
  fill.setAttribute('x1', '0');
  fill.setAttribute('x2', fillW.toFixed(1));
  fill.setAttribute('y1', String(H / 2));
  fill.setAttribute('y2', String(H / 2));
  fill.setAttribute('stroke', 'var(--gold)');
  fill.setAttribute('stroke-width', '2.5');
  fill.setAttribute('stroke-linecap', 'round');

  svg.appendChild(track);
  svg.appendChild(fill);
  return svg;
}

function latestDebtHistoryDelta(accountId) {
  const rows = _debtHistory[accountId];
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const latest = Number(rows[rows.length - 1] && rows[rows.length - 1].balance);
  if (!Number.isFinite(latest)) return null;
  for (let i = rows.length - 2; i >= 0; i--) {
    const prev = Number(rows[i] && rows[i].balance);
    if (!Number.isFinite(prev)) continue;
    const delta = Math.round((latest - prev) * 100) / 100;
    if (delta !== 0) return delta;
  }
  return 0;
}

export function fillDebtAccountsList(stats) {
  _lastDebtStats = stats;
  const listEl = document.getElementById('debt-accounts-list');
  const totalEl = document.getElementById('debt-total-val');
  if (!listEl) return;

  document.querySelectorAll('.sort-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === _debtSortMode);
  });

  listEl.textContent = '';

  const gsRow  = document.getElementById('game-start-row');
  const gsMeta = document.getElementById('game-start-meta');
  const gsVal  = document.getElementById('game-start-val');
  if (gsRow && gsMeta && gsVal) {
    const gd = stats && stats.gameStartDebt;
    const ga = stats && stats.gameStartAt;
    if (gd != null && Number.isFinite(gd)) {
      const dateLabel = ga
        ? new Date(ga).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const paidDown = gd - (stats.debtRemaining || 0);
      const pct = gd > 0 ? Math.round((paidDown / gd) * 1000) / 10 : null;
      gsMeta.textContent = (pct != null && pct > 0)
        ? `${dateLabel} · ${pct}% paid down`
        : dateLabel;
      gsVal.textContent  = fmtDollar(gd);
      gsVal.title        = paidDown >= 0
        ? `${fmtDollar(paidDown)} paid down since game start${pct != null ? ` (${pct}%)` : ''}`
        : '';
      gsRow.hidden = false;
    } else {
      gsRow.hidden = true;
    }
  }

  const reasonEl = document.getElementById('commitment-reason-display');
  const reasonWrap = document.getElementById('commitment-reason-wrap');
  if (reasonEl) {
    try {
      const reason = localStorage.getItem('steward_promise_text');
      if (reason && reason.trim()) {
        reasonEl.textContent = reason.trim();
        reasonEl.hidden = false;
        if (reasonWrap) reasonWrap.hidden = false;
      } else {
        reasonEl.hidden = true;
        /* Keep the wrap visible — empty-state shows a "+ Add your reason" prompt. */
        if (reasonWrap) reasonWrap.hidden = false;
      }
    } catch (_) {
      reasonEl.hidden = true;
      if (reasonWrap) reasonWrap.hidden = true;
    }
  }

  let accounts = stats && stats.debtAccountLines;
  if (!accounts || !Array.isArray(accounts) || accounts.length === 0) return;

  accounts = [...accounts];
  if (_debtSortMode === 'apr') {
    accounts.sort((a, b) => {
      const ra = (_aprRates[a.id] != null) ? _aprRates[a.id] : -1;
      const rb = (_aprRates[b.id] != null) ? _aprRates[b.id] : -1;
      return rb - ra;
    });
  } else {
    accounts.sort((a, b) => Number(b.balance) - Number(a.balance));
  }
  const maxBalance = accounts.reduce((max, acct) => {
    const b = Number(acct && acct.balance);
    return Number.isFinite(b) && b > max ? b : max;
  }, 0);

  // Column header row — labels the sparkline column ("Trend") that otherwise has
  // no header. Uses the same grid as .debt-row so the label sits over the spark.
  const header = document.createElement('div');
  header.className = 'debt-row debt-row--header';
  header.setAttribute('aria-hidden', 'true');
  header.innerHTML =
    '<span class="dr-col-head"></span>' +
    '<span class="dr-col-head"></span>' +
    '<span class="dr-col-head"></span>' +
    '<span class="dr-col-head"></span>' +
    '<span class="dr-col-head dr-col-head--trend">Trend</span>';
  listEl.appendChild(header);

  // Avalanche guidance: the open account with the highest APR is the one
  // every extra dollar should hit first. Only meaningful when APRs are set.
  let payFirstId = null;
  let payFirstApr = -Infinity;
  let totalMonthlyInterest = 0;
  let ratedCount = 0;
  for (const acct of accounts) {
    const bal = Number(acct.balance);
    const apr = _aprRates[acct.id];
    if (!Number.isFinite(bal) || bal <= 0 || apr == null || !Number.isFinite(apr) || apr <= 0) continue;
    ratedCount += 1;
    totalMonthlyInterest += (bal * apr) / 100 / 12;
    if (apr > payFirstApr) { payFirstApr = apr; payFirstId = acct.id; }
  }

  // Long lists collapse to the largest balances; "Show all" expands for the
  // session. Sorting already puts the heavy hitters first in either mode.
  const totalCount = accounts.length;
  const collapsed = !_debtListExpanded && totalCount > DEBT_LIST_COLLAPSE_AT;
  if (collapsed) accounts = accounts.slice(0, DEBT_LIST_COLLAPSE_AT);

  for (const acct of accounts) {
    const balance = Number(acct.balance);
    if (!Number.isFinite(balance)) continue;

    const row = document.createElement('div');
    row.className = 'debt-row';
    /* Tagged so the live-mirror in manual-entry.js can find rows by account id
       without having to re-query by name (which isn't unique). */
    if (acct.id != null) row.dataset.accountId = String(acct.id);
    /* Snapshot balance kept on the row so we can restore it cleanly if the
       user reverts a live edit. */
    row.dataset.snapshotBalance = String(balance);
    if (acct.paidOff === true || balance === 0) {
      row.classList.add('debt-row--paid-off');
      row.setAttribute('aria-label', `${acct.name || 'Account'} paid off`);
    }

    const name = document.createElement('span');
    name.className = 'dr-name debt-row-name';
    name.textContent = acct.name || 'Account';
    name.title = acct.name || 'Account';
    const isPaidOff = acct.paidOff === true || balance === 0;
    if (isPaidOff) {
      const badge = document.createElement('span');
      badge.className = 'dr-paid-badge';
      badge.textContent = 'PAID OFF';
      name.appendChild(document.createTextNode(' '));
      name.appendChild(badge);
    } else if (acct.id != null && acct.id === payFirstId && ratedCount >= 2) {
      // Avalanche pick — only shown when at least two open accounts have an
      // APR, otherwise "first" is meaningless.
      const badge = document.createElement('span');
      badge.className = 'dr-payfirst-badge';
      badge.textContent = 'PAY FIRST';
      badge.title = `Highest interest rate (${payFirstApr}% APR) — extra payments save the most here.`;
      name.appendChild(document.createTextNode(' '));
      name.appendChild(badge);
    }

    // Celebration: re-applied at build time for the whole window so the async
    // debt-history rebuild can't wipe it. Expired entries are pruned so the
    // flash doesn't replay on later unrelated renders.
    const acctName = String(acct.name || '').trim();
    const until = _celebrateUntil.get(acctName);
    if (isPaidOff && until != null) {
      if (Date.now() < until) row.classList.add('debt-row--celebrate');
      else _celebrateUntil.delete(acctName);
    }

    const aprEl = document.createElement('span');
    aprEl.className = 'dr-apr';
    const rateVal = _aprRates[acct.id];
    if (rateVal != null && Number.isFinite(rateVal)) {
      aprEl.textContent = `${rateVal}%`;
      const monthly = (balance * rateVal) / 100 / 12;
      if (rateVal > 0 && monthly >= 0.5) {
        const cost = document.createElement('span');
        cost.className = 'dr-interest';
        cost.textContent = ` ~$${Math.round(monthly).toLocaleString()}/mo`;
        aprEl.appendChild(cost);
        aprEl.title = `At ${rateVal}% APR this balance accrues roughly $${Math.round(monthly).toLocaleString()} in interest per month.`;
      }
    } else {
      aprEl.textContent = '—';
    }

    // Balance cell stacks the dollar figure over a small "% paid" line. The
    // dollar stays its own .dr-balance span (manual-entry's live editor writes
    // to it directly), so the percentage sibling survives live edits.
    const amountCell = document.createElement('div');
    amountCell.className = 'dr-balance-cell';
    const amount = document.createElement('span');
    amount.className = 'dr-balance debt-row-balance';
    amount.textContent = fmtDollar(balance);
    amountCell.appendChild(amount);
    // Always render the "% paid" line so every row is the same height (rows
    // that used to omit it for 0% read as uneven). Paid-off rows show 100%.
    const pctPaidRaw = Number(acct.pctPaid);
    const pctPaidVal = isPaidOff ? 100 : (Number.isFinite(pctPaidRaw) && pctPaidRaw > 0 ? pctPaidRaw : 0);
    const pctEl = document.createElement('span');
    pctEl.className = 'dr-paid-pct';
    pctEl.textContent = `${pctPaidVal}% paid`;
    if (acct.startBalance != null && Number.isFinite(Number(acct.startBalance))) {
      pctEl.title = `Down from ${fmtDollar(Number(acct.startBalance))} since you started tracking it.`;
    }
    amountCell.appendChild(pctEl);

    const deltaEl = document.createElement('span');
    const latestDelta = latestDebtHistoryDelta(acct.id);
    deltaEl.className = 'dr-delta';
    if (latestDelta == null || latestDelta === 0) {
      // Empty + decorative: a bare <span> can't carry aria-label (ARIA prohibits
      // it on generic roles), and there's nothing to announce, so leave it bare.
      deltaEl.textContent = '';
    } else {
      deltaEl.textContent = fmtSignedDollar(latestDelta);
      deltaEl.classList.add(latestDelta < 0 ? 'down' : 'up');
      deltaEl.title = 'Most recent account balance change';
    }

    const sparkWrap = document.createElement('span');
    sparkWrap.className = 'dr-spark';
    const histPoints = (_debtHistory[acct.id] || []).map(p => p.balance);
    /* Either builder can return null (sparkline needs ≥2 distinct points; the
       fallback bar needs balance>0 and maxBalance>0). For a paid-off account
       with sparse/failed history both are null — appendChild(null) would throw
       and abort the whole list render, so only append a real node. */
    const sparkViz = buildSparklineSvg(histPoints) || buildDebtBalanceBar(balance, maxBalance);
    if (sparkViz) sparkWrap.appendChild(sparkViz);

    row.appendChild(name);
    row.appendChild(aprEl);
    row.appendChild(amountCell);
    row.appendChild(deltaEl);
    row.appendChild(sparkWrap);
    listEl.appendChild(row);
  }

  if (totalCount > DEBT_LIST_COLLAPSE_AT) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'turn-show-all-btn';
    toggle.textContent = collapsed
      ? `Show all ${totalCount} accounts`
      : `Show top ${DEBT_LIST_COLLAPSE_AT} only`;
    toggle.addEventListener('click', () => {
      _debtListExpanded = !_debtListExpanded;
      fillDebtAccountsList(stats);
    });
    listEl.appendChild(toggle);
  }

  if (totalEl && stats.debtRemaining != null) {
    totalEl.textContent = fmtDollar(stats.debtRemaining);
    // $0 remaining is a victory, not a rose-red liability — paint it emerald.
    totalEl.classList.toggle('is-debt-clear', Number(stats.debtRemaining) <= 0.005);
  }

  // Hero interest ticker — the same monthly figure as the panel summary.
  // A monthly app speaks in months, so this is the per-month cost. Hidden
  // until APRs are entered.
  _lastInterestSummary = {
    monthlyInterest: totalMonthlyInterest,
    totalDebt: Number(stats.debtRemaining) || 0,
  };
  const ticker = document.getElementById('hero-interest-ticker');
  if (ticker) {
    if (totalMonthlyInterest >= 0.5) {
      const amount = totalMonthlyInterest < 10
        ? totalMonthlyInterest.toFixed(2)
        : Math.round(totalMonthlyInterest).toLocaleString();
      ticker.textContent = `Carrying this debt costs ~$${amount} every month`;
      ticker.title = 'Estimated from your APRs and current balances. Every payment shrinks this number.';
      ticker.hidden = false;
    } else {
      ticker.hidden = true;
      ticker.textContent = '';
    }
  }

  // Live interest meter — ticks the accruing interest in real time.
  updateInterestMeter(totalMonthlyInterest);

  // Avalanche summary — what the debt costs per month, and where extra
  // dollars do the most damage. Hidden until APRs are entered.
  const interestLine = document.getElementById('debt-interest-line');
  if (interestLine) {
    if (totalMonthlyInterest >= 1) {
      const payFirstName =
        payFirstId != null
          ? (stats.debtAccountLines || []).find((a) => a.id === payFirstId)?.name
          : null;
      interestLine.textContent =
        `Interest costs you ~$${Math.round(totalMonthlyInterest).toLocaleString()}/mo right now` +
        (payFirstName && ratedCount >= 2 ? ` — extra payments go furthest on ${payFirstName}.` : '.');
      interestLine.hidden = false;
    } else {
      interestLine.hidden = true;
      interestLine.textContent = '';
    }
  }
}
