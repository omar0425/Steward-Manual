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
  const projecting =
    historyDays >= 1 && dailyPace > 0 && latest > 0 && daysToZero <= 365 * 30;

  /* Projection owns the right 30% of the plot, drawn at the same days-per-
     pixel scale as the history. A payoff further out than that still gets the
     dated label; the dashed line just exits the right edge mid-descent. */
  const PROJ_FRAC = 0.3;
  const historyW = projecting ? plotW * (1 - PROJ_FRAC) : plotW;
  const projDaysAtEdge = historyDays * (PROJ_FRAC / (1 - PROJ_FRAC));

  const minV = projecting ? 0 : Math.min(...values);
  const maxV = Math.max(...values);
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
      const payoff = new Date(lastDate.getTime() + daysToZero * 86400000);
      const when = payoff.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      projLabel.textContent = `At this pace, debt-free around ${when}`;
      projLabel.hidden = false;
    }
  } else {
    if (projEl) projEl.setAttribute('d', '');
    if (projDot) projDot.hidden = true;
    if (projLabel) { projLabel.hidden = true; projLabel.textContent = ''; }
  }

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
