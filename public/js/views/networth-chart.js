'use strict';

/**
 * Debt Reduction Chart - renders debt remaining into the #networth-chart-svg element.
 * Uses the pre-built SVG paths #nw-line and #nw-area in play.js.
 */

export function renderNetWorthChart(snapshots) {
  const svg     = document.getElementById('networth-chart-svg');
  const lineEl  = document.getElementById('nw-line');
  const areaEl  = document.getElementById('nw-area');
  const xLabels = document.getElementById('chart-x-labels');
  const deltaEl = document.getElementById('chart-trend-delta');
  const debtDisplay = document.getElementById('stat-net-worth-chart');
  if (!svg || !lineEl || !areaEl) return;

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
    return;
  }

  const W = 600, H = 110, PX = 20, PY_TOP = 10, PY_BOT = 100;
  const plotW = W - PX * 2;
  const plotH = PY_BOT - PY_TOP;

  // The < 2 case is handled by the early bail above (dashboard-enhance.js
  // shows the inline empty-state in that case).

  const values = pts.map(p => Number(p.debtRemaining));
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  function xPos(i) { return PX + (i / (pts.length - 1)) * plotW; }
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

  const last = coords[coords.length - 1];
  const areaD = lineD +
    ` L${last.x.toFixed(1)},${PY_BOT}` +
    ` L${coords[0].x.toFixed(1)},${PY_BOT} Z`;
  areaEl.setAttribute('d', areaD);

  if (xLabels) {
    xLabels.textContent = '';
    const sampleCount = Math.min(pts.length, 5);
    for (let i = 0; i < sampleCount; i++) {
      const idx = sampleCount === 1 ? 0 : Math.round((i / (sampleCount - 1)) * (pts.length - 1));
      const snap = pts[idx];
      const d = new Date(snap.date);
      const span = document.createElement('span');
      span.className = 'chart-x-label';
      span.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
      xLabels.appendChild(span);
    }
  }

  if (deltaEl) {
    /* `reduction > 0` means debt went down since the first snapshot in this
       window. We render it with a directional arrow + an explicit reference
       point so the chip is unambiguous regardless of which "direction is
       good" the reader assumes. */
    const reduction = values[0] - values[values.length - 1];
    const amt = '$' + Math.abs(Math.round(reduction)).toLocaleString();
    if (reduction > 0) {
      deltaEl.textContent = `↓ ${amt} since first snapshot`;
      deltaEl.className = 'chart-trend pos';
    } else if (reduction < 0) {
      deltaEl.textContent = `↑ ${amt} since first snapshot`;
      deltaEl.className = 'chart-trend neg';
    } else {
      deltaEl.textContent = 'flat since first snapshot';
      deltaEl.className = 'chart-trend';
    }
  }

  if (debtDisplay) {
    const latest = values[values.length - 1];
    debtDisplay.textContent = '$' + Math.max(0, Math.round(latest)).toLocaleString();
    debtDisplay.className = 'chart-current neg';
  }
}
