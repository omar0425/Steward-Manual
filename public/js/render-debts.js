'use strict';

import { fmtDollar, fmtSignedDollar } from './format.js';
import { stewardApiUrl } from './api.js';

let _aprRates = {};
let _debtHistory = {};
let _lastDebtStats = null;
let _debtSortMode = (() => {
  try { return localStorage.getItem('steward-debt-sort') || 'balance'; } catch { return 'balance'; }
})();

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

export function renderBrokerageFootnote() {
  const sub = document.getElementById('stat-brok-sub');
  if (!sub) return;
  sub.hidden = true;
  sub.textContent = '';
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
      gsMeta.textContent = dateLabel;
      gsVal.textContent  = fmtDollar(gd);
      gsVal.title        = paidDown >= 0
        ? `${fmtDollar(paidDown)} paid down since game start`
        : '';
      gsRow.hidden = false;
    } else {
      gsRow.hidden = true;
    }
  }

  const reasonEl = document.getElementById('commitment-reason-display');
  if (reasonEl) {
    try {
      const reason = localStorage.getItem('steward_promise_text');
      if (reason && reason.trim()) {
        reasonEl.textContent = reason.trim();
        reasonEl.hidden = false;
      } else {
        reasonEl.hidden = true;
      }
    } catch (_) {
      reasonEl.hidden = true;
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

  for (const acct of accounts) {
    const balance = Number(acct.balance);
    if (!Number.isFinite(balance)) continue;

    const row = document.createElement('div');
    row.className = 'debt-row';

    const name = document.createElement('span');
    name.className = 'dr-name debt-row-name';
    name.textContent = acct.name || 'Account';

    const aprEl = document.createElement('span');
    aprEl.className = 'dr-apr';
    const rateVal = _aprRates[acct.id];
    aprEl.textContent = (rateVal != null && Number.isFinite(rateVal)) ? `${rateVal}%` : '—';

    const amount = document.createElement('span');
    amount.className = 'dr-balance debt-row-balance';
    amount.textContent = fmtDollar(balance);

    const deltaEl = document.createElement('span');
    const latestDelta = latestDebtHistoryDelta(acct.id);
    deltaEl.className = 'dr-delta';
    if (latestDelta == null || latestDelta === 0) {
      deltaEl.textContent = '';
      deltaEl.setAttribute('aria-label', 'No recent account balance change');
    } else {
      deltaEl.textContent = fmtSignedDollar(latestDelta);
      deltaEl.classList.add(latestDelta < 0 ? 'down' : 'up');
      deltaEl.title = 'Most recent account balance change';
    }

    const sparkWrap = document.createElement('span');
    sparkWrap.className = 'dr-spark';
    const histPoints = (_debtHistory[acct.id] || []).map(p => p.balance);
    const sparkSvg = buildSparklineSvg(histPoints);
    sparkWrap.appendChild(sparkSvg || buildDebtBalanceBar(balance, maxBalance));

    row.appendChild(name);
    row.appendChild(aprEl);
    row.appendChild(amount);
    row.appendChild(deltaEl);
    row.appendChild(sparkWrap);
    listEl.appendChild(row);
  }

  if (totalEl && stats.debtRemaining != null) totalEl.textContent = fmtDollar(stats.debtRemaining);
}
