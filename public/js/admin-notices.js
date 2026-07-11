'use strict';

/* Admin-only bug report panel. Every client probes /api/admin/bug-reports once
   at boot; for everyone except the admin account the server answers
   {admin:false} and this module does NOTHING — no DOM, no globals, no second
   request. Regular users never learn the capture system exists.

   For the admin it mounts a dashboard section listing captured bugs (deduped
   server-side; AI-triaged when the key is configured) with a new-report badge
   and a mark-all-seen control. */

import { stewardApiUrl } from './api.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function severityChip(severity) {
  const s = severity === 'high' || severity === 'medium' || severity === 'low' ? severity : 'untriaged';
  return el('span', `admin-bug-chip admin-bug-chip--${s}`, s);
}

function renderReports(listEl, reports) {
  listEl.textContent = '';
  if (!reports.length) {
    listEl.appendChild(el('p', 'admin-bug-empty', 'No bugs captured. Quiet skies.'));
    return;
  }
  for (const r of reports) {
    const row = el('details', `admin-bug-row${r.status === 'new' ? ' admin-bug-row--new' : ''}`);
    const head = el('summary', 'admin-bug-head');
    head.appendChild(severityChip(r.severity));
    head.appendChild(el('span', 'admin-bug-title', r.title || '(untitled report)'));
    const meta = [];
    if (r.count > 1) meta.push(`×${r.count}`);
    if (r.kind === 'metrics') meta.push('metrics');
    if (r.url) meta.push(r.url);
    meta.push(fmtWhen(r.lastSeenAt));
    head.appendChild(el('span', 'admin-bug-meta', meta.filter(Boolean).join(' · ')));
    row.appendChild(head);
    row.appendChild(el('p', 'admin-bug-report-text',
      r.report || 'Not AI-triaged (no key configured or daily AI budget spent).'));
    listEl.appendChild(row);
  }
}

function buildPanel(data) {
  const section = el('section', 'section-panel dashboard-only-section admin-bug-panel');
  section.id = 'admin-bug-panel';

  const heading = el('h2', 'tc-section-label', '🐞 Bug reports');
  const badge = el('span', 'admin-bug-badge');
  heading.appendChild(badge);
  section.appendChild(heading);
  section.appendChild(el('p', 'tc-section-sublabel',
    'Only you see this. Errors from every account, deduped and AI-triaged.'));

  const list = el('div', 'admin-bug-list');
  section.appendChild(list);

  const seenBtn = el('button', 'admin-bug-seen-btn', 'Mark all seen');
  seenBtn.type = 'button';
  seenBtn.addEventListener('click', async () => {
    seenBtn.disabled = true;
    try {
      await fetch(stewardApiUrl('/api/admin/bug-reports/seen'), { method: 'POST' });
      const res = await fetch(stewardApiUrl('/api/admin/bug-reports'));
      const fresh = await res.json().catch(() => null);
      if (fresh && fresh.admin) update(fresh);
    } catch { /* leave the panel as-is */ }
    seenBtn.disabled = false;
  });
  section.appendChild(seenBtn);

  function update(d) {
    const n = Number(d.newCount) || 0;
    badge.textContent = n > 0 ? String(n) : '';
    badge.hidden = n === 0;
    seenBtn.hidden = n === 0;
    renderReports(list, Array.isArray(d.reports) ? d.reports : []);
  }
  update(data);
  return section;
}

export async function initAdminNotices() {
  try {
    const res = await fetch(stewardApiUrl('/api/admin/bug-reports'));
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (!data || data.admin !== true) return; // not the admin — do nothing, silently
    // Mount next to "Ask the Steward" so it reads as part of the dashboard.
    const anchor = document.getElementById('ask-steward-panel');
    if (!anchor || !anchor.parentElement) return;
    anchor.insertAdjacentElement('afterend', buildPanel(data));
  } catch { /* never surface anything */ }
}
