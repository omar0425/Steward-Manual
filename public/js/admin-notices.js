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

/* Two-step delete: the first click arms the button, the second commits. A
   report is gone for good once removed, and this panel is a dense list of
   similar-looking rows — a single misplaced click should not destroy one.
   Arming resets after a few seconds, and only one row can be armed at a time. */
function attachDeleteControl(row, report, onDeleted) {
  const btn = el('button', 'admin-bug-delete-btn', 'Delete');
  btn.type = 'button';
  btn.title = 'Remove this report permanently';
  btn.setAttribute('aria-label', `Delete report: ${report.title || 'untitled report'}`);
  let armed = false;
  let armTimer = null;

  const disarm = () => {
    armed = false;
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    btn.textContent = 'Delete';
    btn.classList.remove('is-armed');
  };

  btn.addEventListener('click', async (e) => {
    // The button lives inside <summary>; without this the click also toggles
    // the row open/closed, which reads as the panel jumping around mid-delete.
    e.preventDefault();
    e.stopPropagation();

    if (!armed) {
      for (const other of listOfArmedButtons(btn)) other.dispatchEvent(new CustomEvent('admin-bug-disarm'));
      armed = true;
      btn.textContent = 'Delete for good?';
      btn.classList.add('is-armed');
      armTimer = setTimeout(disarm, 5000);
      return;
    }

    disarm();
    btn.disabled = true;
    try {
      const res = await fetch(stewardApiUrl(`/api/admin/bug-reports/${report.id}`), { method: 'DELETE' });
      // 404 means someone already removed it; refreshing shows the truth either
      // way, so both outcomes end in the same resync.
      if (res.ok || res.status === 404) {
        await onDeleted();
        return;
      }
      btn.disabled = false;
      btn.textContent = 'Delete failed';
      setTimeout(() => { btn.textContent = 'Delete'; }, 2500);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Delete failed';
      setTimeout(() => { btn.textContent = 'Delete'; }, 2500);
    }
  });

  btn.addEventListener('admin-bug-disarm', disarm);
  return btn;
}

/* Every armed delete button except the one being clicked. */
function listOfArmedButtons(except) {
  return Array.from(document.querySelectorAll('.admin-bug-delete-btn.is-armed'))
    .filter((b) => b !== except);
}

function renderReports(listEl, reports, onDeleted) {
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
    // 'error' is the default kind and needs no label; the others do:
    // 'metrics' (AI audit), 'invariant' (ledger rule), 'user' (chat-reported).
    if (r.kind && r.kind !== 'error') meta.push(r.kind === 'user' ? 'player-reported' : r.kind);
    if (r.url) meta.push(r.url);
    meta.push(fmtWhen(r.lastSeenAt));
    head.appendChild(el('span', 'admin-bug-meta', meta.filter(Boolean).join(' · ')));
    head.appendChild(attachDeleteControl(row, r, onDeleted));
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

  /* Re-pull the list from the server rather than splicing the row out locally:
     a delete also moves newCount, and the panel shows 50 of possibly more, so
     removing one can pull another into view. */
  async function refresh() {
    try {
      const res = await fetch(stewardApiUrl('/api/admin/bug-reports'));
      const fresh = await res.json().catch(() => null);
      if (fresh && fresh.admin) update(fresh);
    } catch { /* leave the panel as-is */ }
  }

  const seenBtn = el('button', 'admin-bug-seen-btn', 'Mark all seen');
  seenBtn.type = 'button';
  seenBtn.addEventListener('click', async () => {
    seenBtn.disabled = true;
    try {
      await fetch(stewardApiUrl('/api/admin/bug-reports/seen'), { method: 'POST' });
      await refresh();
    } catch { /* leave the panel as-is */ }
    seenBtn.disabled = false;
  });
  section.appendChild(seenBtn);

  function update(d) {
    const n = Number(d.newCount) || 0;
    badge.textContent = n > 0 ? String(n) : '';
    badge.hidden = n === 0;
    seenBtn.hidden = n === 0;
    renderReports(list, Array.isArray(d.reports) ? d.reports : [], refresh);
  }
  update(data);
  return section;
}

/* Where to hang the panel. It used to sit right after "Ask the Steward", but
   that panel was later folded into the collapsed "Tools & guidance" drawer and
   took this one with it — the reports still rendered, just inside a closed
   <details> nobody opens. Prefer the drawer itself, then climb out of every
   enclosing fold, so the panel lands at the top level wherever the dashboard
   moves next. */
function mountAnchor() {
  let node = document.getElementById('optional-tools-section')
    || document.getElementById('ask-steward-panel');
  if (!node) return null;
  for (
    let fold = node.parentElement && node.parentElement.closest('details');
    fold;
    fold = node.parentElement && node.parentElement.closest('details')
  ) {
    node = fold;
  }
  return node;
}

export async function initAdminNotices() {
  try {
    const res = await fetch(stewardApiUrl('/api/admin/bug-reports'));
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (!data || data.admin !== true) return; // not the admin — do nothing, silently
    const anchor = mountAnchor();
    if (!anchor || !anchor.parentElement) return;
    anchor.insertAdjacentElement('afterend', buildPanel(data));
  } catch { /* never surface anything */ }
}
