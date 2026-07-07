'use strict';

import { getInterestSummary } from '../render-debts.js';
import { whatIfExtra } from '../payoff-math.js';

/**
 * Debt Reduction Chart - renders debt remaining into the #networth-chart-svg element.
 * Uses the pre-built SVG paths #nw-line and #nw-area in play.js.
 */

/* ── What-if slider ──────────────────────────────────────────────────────────
   "Extra $N/mo → debt-free X months sooner, saving ~$Y interest." Prefers an
   EXACT month-by-month amortization (payoff-math.js) fed from the status
   render — average payment + blended APR — so the interest figure is a true
   simulation; falls back to the chart projection's pace approximation for
   users whose stats can't be simulated yet. Slider value persists. */

const WHATIF_STORAGE_KEY = 'steward-whatif-extra';
// First-visit default (multiple of the slider's step). Starting above $0 means
// the control demonstrates its own value immediately instead of showing a flat
// "drag to see" prompt. A user who deliberately sets $0 keeps it (stored as "0").
const WHATIF_DEFAULT = 100;
let _projState = null; // { latest, dailyPace, lastDateMs, daysToZero } when projecting
let _whatifBound = false;
let _whatifBasis = null; // { debt, apr, basePayment } — exact-amortization inputs

/** Fed from render.js on every status render. */
export function setWhatIfBasis(stats) {
  const debt = Number(stats && stats.debtRemaining);
  const basePayment = Number(stats && stats.avgMonthlyPayment) || Number(stats && stats.monthlyPace) || 0;
  const apr = Number(stats && stats.avgApr) || 0;
  _whatifBasis = Number.isFinite(debt) && debt > 0 && basePayment > 0
    ? { debt, apr, basePayment }
    : null;
  syncWhatIfSection();
}

function monthsPhrase(m) {
  if (m < 24) return `${m} month${m === 1 ? '' : 's'}`;
  const y = Math.floor(m / 12);
  const rem = m % 12;
  return rem === 0 ? `${y} years` : `${y} yr ${rem} mo`;
}

function readWhatifExtra() {
  try {
    const raw = localStorage.getItem(WHATIF_STORAGE_KEY);
    if (raw == null) return WHATIF_DEFAULT; // never set → show a live projection, not $0
    return Math.max(0, Number(raw) || 0);
  } catch { return WHATIF_DEFAULT; }
}

function updateWhatIfReadout() {
  const slider = document.getElementById('whatif-slider');
  const amountEl = document.getElementById('whatif-amount');
  const readout = document.getElementById('whatif-readout');
  if (!slider || !readout || (!_projState && !_whatifBasis)) return;

  const extra = Number(slider.value) || 0;
  if (amountEl) amountEl.textContent = `$${extra.toLocaleString()}`;
  if (extra <= 0) {
    readout.textContent = 'Drag to see how extra payments move your debt-free date.';
    readout.classList.remove('is-live');
    return;
  }

  // Preferred path: exact amortization from the user's real average payment
  // and blended APR — interest compounds monthly instead of being averaged.
  if (_whatifBasis) {
    const r = whatIfExtra(_whatifBasis.debt, _whatifBasis.apr, _whatifBasis.basePayment, extra);
    if (r) {
      const payoff = new Date(Date.now() + r.newMonths * 30.44 * 86400000);
      const when = payoff.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      let text = `Debt-free around ${when}`;
      if (r.monthsSooner >= 1) text += ` — ${monthsPhrase(r.monthsSooner)} sooner`;
      if (r.interestSaved >= 10) text += `, keeping ~$${Math.round(r.interestSaved).toLocaleString()} from the bank`;
      readout.textContent = text + '.';
      readout.classList.add('is-live');
      return;
    }
    // Basis exists but the base payment loses to interest — that is itself the
    // most important thing the slider can say. Does the EXTRA fix it?
    const rescued = whatIfExtra(_whatifBasis.debt, _whatifBasis.apr, _whatifBasis.basePayment + extra, 0);
    if (rescued) {
      readout.textContent = `Your current pace loses to interest — but +$${extra.toLocaleString()}/mo clears it in ${monthsPhrase(rescued.baseMonths)}.`;
      readout.classList.add('is-live');
      return;
    }
    if (!_projState) {
      readout.textContent = 'Interest is outrunning this pace — drag higher to find the payment that beats it.';
      readout.classList.remove('is-live');
      return;
    }
    // fall through to the projection approximation
  }

  if (!_projState) return;
  const { latest, dailyPace, lastDateMs, daysToZero } = _projState;
  const newPace = dailyPace + (extra * 12) / 365;
  const newDays = latest / newPace;
  const payoff = new Date(lastDateMs + newDays * 86400000);
  const when = payoff.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthsSooner = Math.max(0, Math.round((daysToZero - newDays) / 30.44));

  // Blended APR from the avalanche totals → rough interest saved. The balance
  // declines ~linearly to zero, so average balance is latest/2 over the window.
  const { monthlyInterest, totalDebt } = getInterestSummary();
  let savings = 0;
  if (monthlyInterest > 0 && totalDebt > 0) {
    const aprDaily = (monthlyInterest * 12) / totalDebt / 365;
    savings = aprDaily * (latest / 2) * (daysToZero - newDays);
  }

  let text = `Debt-free around ${when}`;
  if (monthsSooner >= 1) text += ` — ${monthsSooner} month${monthsSooner === 1 ? '' : 's'} sooner`;
  if (savings >= 10) text += `, saving ~$${Math.round(savings).toLocaleString()} in interest`;
  readout.textContent = text + '.';
  readout.classList.add('is-live');
}

function syncWhatIfSection() {
  const section = document.getElementById('whatif-section');
  const slider = document.getElementById('whatif-slider');
  if (!section || !slider) return;
  if (!_projState && !_whatifBasis) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (!_whatifBound) {
    _whatifBound = true;
    slider.value = String(readWhatifExtra());
    slider.addEventListener('input', () => {
      try { localStorage.setItem(WHATIF_STORAGE_KEY, slider.value); } catch { /* ignore */ }
      updateWhatIfReadout();
    });
  }
  updateWhatIfReadout();
}

export function renderNetWorthChart(snapshots, opts = {}) {
  const svg     = document.getElementById('networth-chart-svg');
  const lineEl  = document.getElementById('nw-line');
  const areaEl  = document.getElementById('nw-area');
  const xLabels = document.getElementById('chart-x-labels');
  const deltaEl = document.getElementById('chart-trend-delta');
  const debtDisplay = document.getElementById('stat-net-worth-chart');
  if (!svg || !lineEl || !areaEl) return;
  // The locked starting debt (climb baseline). It can sit ABOVE the first plotted
  // snapshot when a forgotten debt was folded in later — so progress must be
  // measured against it, not against the first point on the line.
  const baselineDebt = Number(opts && opts.baseline);
  const hasBaseline = Number.isFinite(baselineDebt) && baselineDebt > 0;

  const pts = snapshots
    .map(s => ({
      debtRemaining: s.debt_remaining ?? s.debtRemaining ?? s.totalDebt ?? s.total_debt,
      date: s.date || s.pulled_at,
    }))
    .filter(s => s.debtRemaining != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // < 2 points → caller should show inline empty-state instead (see
  // dashboard-enhance.js). Bail without mutating the SVG so we don't paint
  // stale shapes; hide whatever was there previously.
  if (pts.length < 2) {
    lineEl.setAttribute('d', '');
    areaEl.setAttribute('d', '');
    const existingDot = svg.querySelector('.nw-single-dot');
    if (existingDot) existingDot.hidden = true;
    _projState = null;
    syncWhatIfSection();
    return;
  }

  const W = 600, H = 150, PX = 20, PY_TOP = 10, PY_BOT = 140;
  const plotW = W - PX * 2;
  const plotH = PY_BOT - PY_TOP;

  // The < 2 case is handled by the early bail above (dashboard-enhance.js
  // shows the inline empty-state in that case).

  const values = pts.map(p => Number(p.debtRemaining));

  // ── Payoff projection ──────────────────────────────────────────────────
  // Average daily paydown across the window → date the line crosses $0.
  // Only when the trend is genuinely down, the window spans at least a day,
  // and the payoff lands within a sane horizon (30y). When projecting, the
  // y-domain floors at 0 so the dashed line has somewhere to land.
  const latest = values[values.length - 1];
  const firstDate = new Date(pts[0].date);
  const lastDate = new Date(pts[pts.length - 1].date);
  const historyDays = (lastDate - firstDate) / 86400000;
  const dailyPace = historyDays > 0 ? (values[0] - latest) / historyDays : 0;
  const daysToZero = dailyPace > 0 ? latest / dailyPace : Infinity;
  // Gate at ~3 weeks of real span — the same MIN_SPAN_DAYS guard the server uses
  // (services/pace.js). Below that a couple of clustered entries produce a
  // fantasy rate, and the dashed line / what-if slider would disagree with the
  // "Projected debt-free" banner. Both must tell one story.
  const MIN_SPAN_DAYS = 21;
  const projecting =
    historyDays >= MIN_SPAN_DAYS && dailyPace > 0 && latest > 0 && daysToZero <= 365 * 30;

  /* Projection owns the right 30% of the plot, drawn at the same days-per-
     pixel scale as the history. A payoff further out than that still gets the
     dated label; the dashed line just exits the right edge mid-descent. */
  const PROJ_FRAC = 0.3;
  const historyW = projecting ? plotW * (1 - PROJ_FRAC) : plotW;
  const projDaysAtEdge = historyDays * (PROJ_FRAC / (1 - PROJ_FRAC));

  const minV = projecting ? 0 : Math.min(...values);
  // Include the baseline in the domain so its reference line is always visible,
  // even when it sits above every recorded balance.
  const maxV = Math.max(Math.max(...values), hasBaseline ? baselineDebt : -Infinity);
  const range = maxV - minV || 1;

  function xPos(i) { return PX + (i / (pts.length - 1)) * historyW; }
  function yPos(v) { return PY_TOP + plotH - ((v - minV) / range) * plotH; }

  const coords = pts.map((p, i) => ({ x: xPos(i), y: yPos(Number(p.debtRemaining)) }));

  let lineD = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cpx = (prev.x + curr.x) / 2;
    lineD += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }

  lineEl.setAttribute('d', lineD);

  // Starting-line: a faint dashed rule at the locked baseline so progress reads
  // against where you started (with all debts logged), not against the first
  // point on the line. Created lazily and reused across renders.
  const SVGNS = 'http://www.w3.org/2000/svg';
  let baseLine = svg.querySelector('#nw-baseline');
  if (hasBaseline) {
    const yB = yPos(baselineDebt);
    if (!baseLine) {
      baseLine = document.createElementNS(SVGNS, 'line');
      baseLine.setAttribute('id', 'nw-baseline');
      baseLine.setAttribute('class', 'nw-baseline');
      baseLine.setAttribute('stroke', '#c8a84c');   // gold, matches projection
      baseLine.setAttribute('stroke-width', '1');
      baseLine.setAttribute('stroke-dasharray', '2 4');
      baseLine.setAttribute('opacity', '0.5');
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = 'Starting debt (your locked baseline)';
      baseLine.appendChild(t);
      svg.insertBefore(baseLine, lineEl); // behind the debt line
    }
    baseLine.setAttribute('x1', PX);
    baseLine.setAttribute('x2', (PX + plotW).toFixed(1));
    baseLine.setAttribute('y1', yB.toFixed(1));
    baseLine.setAttribute('y2', yB.toFixed(1));
    baseLine.removeAttribute('hidden');
  } else if (baseLine) {
    baseLine.setAttribute('hidden', '');
  }

  const last = coords[coords.length - 1];
  const areaD = lineD +
    ` L${last.x.toFixed(1)},${PY_BOT}` +
    ` L${coords[0].x.toFixed(1)},${PY_BOT} Z`;
  areaEl.setAttribute('d', areaD);

  const projEl = document.getElementById('nw-projection');
  const projDot = document.getElementById('nw-projection-dot');
  const projLabel = document.getElementById('chart-projection-label');
  if (projecting && projEl) {
    let endX, endY, reachesZero;
    if (daysToZero <= projDaysAtEdge) {
      // Debt-free inside the drawn window — land the dash on the $0 baseline.
      endX = last.x + (daysToZero / projDaysAtEdge) * (PX + plotW - last.x);
      endY = PY_BOT;
      reachesZero = true;
    } else {
      // Payoff is past the right edge — exit mid-descent at the same slope.
      endX = PX + plotW;
      endY = yPos(latest * (1 - projDaysAtEdge / daysToZero));
      reachesZero = false;
    }
    projEl.setAttribute('d', `M${last.x.toFixed(1)},${last.y.toFixed(1)} L${endX.toFixed(1)},${endY.toFixed(1)}`);
    if (projDot) {
      projDot.hidden = !reachesZero;
      if (reachesZero) {
        projDot.setAttribute('cx', endX.toFixed(1));
        projDot.setAttribute('cy', endY.toFixed(1));
      }
    }
    if (projLabel) {
      // The dashed line is a best-case straight-line extrapolation of recent
      // pace; it ignores the bad months the Monte Carlo forecast accounts for, so
      // stating a single optimistic date here contradicted the forecast panel
      // (DA-05). Frame it as best-case and defer the actual date to the forecast.
      projLabel.textContent = 'Dashed line: best-case at your recent pace. See the forecast below for the likely range.';
      projLabel.hidden = false;
    }
    _projState = { latest, dailyPace, lastDateMs: lastDate.getTime(), daysToZero };
  } else {
    if (projEl) projEl.setAttribute('d', '');
    if (projDot) projDot.hidden = true;
    if (projLabel) { projLabel.hidden = true; projLabel.textContent = ''; }
    _projState = null;
  }
  syncWhatIfSection();

  if (xLabels) {
    xLabels.textContent = '';
    const sampleCount = Math.min(pts.length, projecting ? 4 : 5);
    for (let i = 0; i < sampleCount; i++) {
      const idx = sampleCount === 1 ? 0 : Math.round((i / (sampleCount - 1)) * (pts.length - 1));
      const snap = pts[idx];
      const d = new Date(snap.date);
      const span = document.createElement('span');
      span.className = 'chart-x-label';
      span.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
      xLabels.appendChild(span);
    }
    if (projecting) {
      // Date at the right edge of the projection segment (payoff date when it
      // lands inside the window, otherwise the date the dash exits the chart).
      const edgeDays = Math.min(daysToZero, projDaysAtEdge);
      const edge = new Date(lastDate.getTime() + edgeDays * 86400000);
      const span = document.createElement('span');
      span.className = 'chart-x-label chart-x-label--payoff';
      span.textContent = `${edge.getMonth() + 1}/${edge.getFullYear()}`;
      xLabels.appendChild(span);
    }
  }

  if (deltaEl) {
    /* Measure progress against the locked baseline when we have it (so folding
       in a forgotten debt reads as the correction it is, not as back-sliding);
       otherwise fall back to the first plotted snapshot. `reduction > 0` = debt
       went down. The reference word makes the chip unambiguous. */
    const anchor = hasBaseline ? baselineDebt : values[0];
    const ref = hasBaseline ? 'since you started' : 'since first snapshot';
    const reduction = anchor - values[values.length - 1];
    const amt = '$' + Math.abs(Math.round(reduction)).toLocaleString();
    if (reduction > 0) {
      deltaEl.textContent = `↓ ${amt} ${ref}`;
      deltaEl.className = 'chart-trend pos';
    } else if (reduction < 0) {
      deltaEl.textContent = `↑ ${amt} ${ref}`;
      deltaEl.className = 'chart-trend neg';
    } else {
      deltaEl.textContent = `flat ${ref}`;
      deltaEl.className = 'chart-trend';
    }
  }

  if (debtDisplay) {
    const latest = values[values.length - 1];
    debtDisplay.textContent = '$' + Math.max(0, Math.round(latest)).toLocaleString();
    debtDisplay.className = 'chart-current neg';
  }
}
