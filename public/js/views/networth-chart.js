'use strict';

/**
 * Net Worth Chart — renders snapshots into the #networth-chart-svg element.
 * Uses the pre-built SVG paths #nw-line and #nw-area in play.js.
 */

export function renderNetWorthChart(snapshots) {
  const svg     = document.getElementById('networth-chart-svg');
  const lineEl  = document.getElementById('nw-line');
  const areaEl  = document.getElementById('nw-area');
  const xLabels = document.getElementById('chart-x-labels');
  const deltaEl = document.getElementById('chart-trend-delta');
  const nwDisplay = document.getElementById('stat-net-worth-chart');
  if (!svg || !lineEl || !areaEl) return;

  const pts = snapshots
    .map(s => ({
      netWorth: s.netWorth ?? (s.total_assets != null && s.total_debt != null ? Number(s.total_assets) - Number(s.total_debt) : null),
      date: s.date || s.pulled_at,
    }))
    .filter(s => s.netWorth != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (pts.length === 0) return;

  const W = 600, H = 110, PX = 20, PY_TOP = 10, PY_BOT = 100;
  const plotW = W - PX * 2;
  const plotH = PY_BOT - PY_TOP;

  // Single-point case: draw a labeled dot at chart center — honest about having
  // only one pull, not a fake trend line.
  if (pts.length === 1) {
    const cx = (W / 2).toFixed(1);
    const cy = ((PY_TOP + PY_BOT) / 2).toFixed(1);
    // Clear the line and area paths (no fake trend)
    lineEl.setAttribute('d', '');
    areaEl.setAttribute('d', '');
    // Draw a single circle dot in the SVG (reuse or create)
    let dot = svg.querySelector('.nw-single-dot');
    if (!dot) {
      dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'nw-single-dot');
      dot.setAttribute('r', '4');
      svg.appendChild(dot);
    }
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.hidden = false;
    if (xLabels) {
      xLabels.textContent = '';
      const d = new Date(pts[0].date);
      const span = document.createElement('span');
      span.className = 'chart-x-label';
      span.textContent = `${d.getMonth() + 1}/${d.getDate()} — starting point`;
      xLabels.appendChild(span);
    }
    if (deltaEl) { deltaEl.textContent = 'Pull again to see trend'; deltaEl.className = 'chart-trend'; }
    if (nwDisplay) {
      const v = Number(pts[0].netWorth);
      const formatted = '$' + Math.abs(Math.round(v)).toLocaleString();
      nwDisplay.textContent = v < 0 ? '-' + formatted : formatted;
      nwDisplay.className = 'chart-current ' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
    }
    return;
  }

  // Multi-point: hide single dot if it was previously shown
  const existingDot = svg.querySelector('.nw-single-dot');
  if (existingDot) existingDot.hidden = true;

  const values = pts.map(p => Number(p.netWorth));
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  function xPos(i) { return PX + (i / (pts.length - 1)) * plotW; }
  function yPos(v) { return PY_TOP + plotH - ((v - minV) / range) * plotH; }

  /* Build smooth cubic bezier path through all points */
  const coords = pts.map((p, i) => ({ x: xPos(i), y: yPos(Number(p.netWorth)) }));

  let lineD = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cpx = (prev.x + curr.x) / 2;
    lineD += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }

  lineEl.setAttribute('d', lineD);

  /* Area: same curve closed to bottom */
  const last = coords[coords.length - 1];
  const areaD = lineD +
    ` L${last.x.toFixed(1)},${PY_BOT}` +
    ` L${coords[0].x.toFixed(1)},${PY_BOT} Z`;
  areaEl.setAttribute('d', areaD);

  /* X-axis labels */
  if (xLabels) {
    xLabels.textContent = '';
    const sampleCount = Math.min(pts.length, 5);
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.round((i / (sampleCount - 1)) * (pts.length - 1));
      const snap = pts[idx];
      const d = new Date(snap.date);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const span = document.createElement('span');
      span.className = 'chart-x-label';
      span.textContent = label;
      xLabels.appendChild(span);
    }
  }

  /* Trend delta */
  if (deltaEl) {
    const diff = values[values.length - 1] - values[0];
    const sign = diff >= 0 ? '+' : '-';
    deltaEl.textContent = sign + '$' + Math.abs(Math.round(diff)).toLocaleString();
    deltaEl.className = 'chart-trend ' + (diff >= 0 ? 'pos' : 'neg');
  }

  /* Current net worth display */
  if (nwDisplay) {
    const latest = values[values.length - 1];
    const formatted = '$' + Math.abs(Math.round(latest)).toLocaleString();
    nwDisplay.textContent = latest < 0 ? '-' + formatted : formatted;
    nwDisplay.className = 'chart-current ' + (latest < 0 ? 'neg' : latest > 0 ? 'pos' : '');
  }
}
