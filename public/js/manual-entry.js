'use strict';

import { stewardApiUrl, readJsonRes } from './api.js';

let _debtAccountCounter = 0;

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtDollar(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function addDebtAccountRow(container, name, balance, id) {
  const rowId = id || `manual-acct-${_debtAccountCounter++}`;
  const row = document.createElement('div');
  row.className = 'debt-account-entry-row';
  row.dataset.accountId = rowId;
  row.innerHTML = `
    <input type="text" class="debt-acct-name" placeholder="Account name" value="${name || ''}" />
    <input type="number" class="debt-acct-balance" step="0.01" min="0" placeholder="Balance" value="${balance || ''}" />
    <button type="button" class="debt-acct-remove" aria-label="Remove">&times;</button>
  `;
  row.querySelector('.debt-acct-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectDebtAccounts() {
  const rows = document.querySelectorAll('#debt-accounts-entries .debt-account-entry-row');
  const accounts = [];
  for (const row of rows) {
    const name = row.querySelector('.debt-acct-name').value.trim();
    const balance = parseFloat(row.querySelector('.debt-acct-balance').value);
    const id = row.dataset.accountId;
    if (name && Number.isFinite(balance) && balance > 0) {
      accounts.push({ id, name, balance });
    }
  }
  return accounts;
}

function collectSavedDebtUpdates() {
  const rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  const accounts = [];
  for (const row of rows) {
    const name = row.dataset.name;
    const id = row.dataset.accountId;
    const input = row.querySelector('.saved-debt-balance-input');
    const balance = parseFloat(input.value);
    if (name && Number.isFinite(balance) && balance >= 0) {
      accounts.push({ id, name, balance });
    }
  }
  return accounts;
}

/* ── Render saved debts list ──────────────────────────────────────────────── */

function renderSavedDebtsList(debtLines) {
  const listEl = document.getElementById('saved-debts-list');
  const rowsEl = document.getElementById('saved-debts-rows');
  const totalEl = document.getElementById('saved-debts-total-val');
  const addSection = document.getElementById('add-debt-section');
  const heading = document.getElementById('add-debt-heading');

  if (!listEl || !rowsEl || !debtLines || debtLines.length === 0) {
    // No saved debts — show the add form
    if (listEl) listEl.style.display = 'none';
    if (addSection) addSection.style.display = '';
    if (heading) heading.textContent = 'Add your debts';
    return;
  }

  // Populate saved debts
  rowsEl.innerHTML = '';
  let total = 0;

  for (const acct of debtLines) {
    total += acct.balance;
    const row = document.createElement('div');
    row.className = 'saved-debt-row';
    row.dataset.accountId = acct.id;
    row.dataset.name = acct.name;
    row.dataset.prevBalance = acct.balance;
    row.innerHTML = `
      <div class="saved-debt-name">${acct.name}</div>
      <div class="saved-debt-balance">
        <span class="saved-debt-dollar">$</span>
        <input type="number" class="saved-debt-balance-input" step="0.01" min="0" value="${acct.balance}" />
      </div>
      <button type="button" class="saved-debt-remove" aria-label="Remove ${acct.name}" title="Remove">&times;</button>
    `;

    // Live total update on input
    const input = row.querySelector('.saved-debt-balance-input');
    input.addEventListener('input', () => updateSavedTotal());

    // Remove debt row
    row.querySelector('.saved-debt-remove').addEventListener('click', () => {
      row.remove();
      updateSavedTotal();
      // If no saved debts remain, hide the list
      const remaining = rowsEl.querySelectorAll('.saved-debt-row');
      if (remaining.length === 0) {
        listEl.style.display = 'none';
        if (heading) heading.textContent = 'Add your debts';
      }
    });

    rowsEl.appendChild(row);
  }

  if (totalEl) totalEl.textContent = fmtDollar(total);
  listEl.style.display = '';

  // Switch add section to "add more" mode
  if (addSection) addSection.style.display = '';
  if (heading) heading.textContent = 'Add another debt';

  // Clear any leftover rows in the add form
  const addEntries = document.getElementById('debt-accounts-entries');
  if (addEntries) addEntries.innerHTML = '';
}

function updateSavedTotal() {
  const totalEl = document.getElementById('saved-debts-total-val');
  if (!totalEl) return;
  const rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  let total = 0;
  for (const row of rows) {
    const input = row.querySelector('.saved-debt-balance-input');
    const val = parseFloat(input.value);
    if (Number.isFinite(val) && val >= 0) total += val;
  }
  totalEl.textContent = fmtDollar(total);
}

/* ── Paydown confirmation summary ─────────────────────────────────────────── */

function buildPaydownSummary(accounts) {
  const rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  const changes = [];
  let totalPaid = 0;

  for (const row of rows) {
    const name = row.dataset.name;
    const prev = parseFloat(row.dataset.prevBalance);
    const input = row.querySelector('.saved-debt-balance-input');
    const curr = parseFloat(input.value);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const delta = prev - curr;
    if (Math.abs(delta) >= 0.01) {
      changes.push({ name, prev, curr, delta });
      if (delta > 0) totalPaid += delta;
    }
  }

  // Check for removed debts
  const currentIds = new Set(accounts.map(a => a.id));
  for (const row of rows) {
    const id = row.dataset.accountId;
    if (!currentIds.has(id)) {
      const name = row.dataset.name;
      const prev = parseFloat(row.dataset.prevBalance);
      changes.push({ name, prev, curr: 0, delta: prev, removed: true });
      totalPaid += prev;
    }
  }

  return { changes, totalPaid };
}

function showPaydownConfirmation(summary, onConfirm) {
  // Remove any existing dialog
  const existing = document.getElementById('paydown-confirm-dialog');
  if (existing) existing.remove();

  if (summary.changes.length === 0) {
    onConfirm();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paydown-confirm-dialog';
  overlay.className = 'paydown-confirm-overlay';

  let linesHtml = summary.changes.map(c => {
    const arrow = '\u2192';
    if (c.removed) {
      return `<div class="paydown-line paydown-removed"><span class="paydown-name">${c.name}</span> <span class="paydown-detail">removed</span></div>`;
    }
    const dir = c.delta > 0 ? 'paydown-paid' : 'paydown-added';
    const label = c.delta > 0 ? `paid $${Math.abs(c.delta).toLocaleString()}` : `+$${Math.abs(c.delta).toLocaleString()} added`;
    return `<div class="paydown-line ${dir}"><span class="paydown-name">${c.name}</span> <span class="paydown-detail">$${c.prev.toLocaleString()} ${arrow} $${c.curr.toLocaleString()} (${label})</span></div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="paydown-confirm-card">
      <h3 class="paydown-confirm-title">Confirm changes</h3>
      <div class="paydown-confirm-lines">${linesHtml}</div>
      ${summary.totalPaid > 0 ? `<div class="paydown-confirm-total">Total paid down: <strong>$${summary.totalPaid.toLocaleString()}</strong></div>` : ''}
      <div class="paydown-confirm-actions">
        <button type="button" class="paydown-confirm-cancel">Cancel</button>
        <button type="button" class="paydown-confirm-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.paydown-confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.paydown-confirm-save').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/* ── Save snapshot ────────────────────────────────────────────────────────── */

async function saveSnapshot(debtAccounts, msgEl, btnEl) {
  if (btnEl) btnEl.disabled = true;
  if (msgEl) msgEl.textContent = 'Saving\u2026';

  if (!debtAccounts || debtAccounts.length === 0) {
    if (msgEl) msgEl.textContent = 'Enter at least one debt account.';
    if (btnEl) btnEl.disabled = false;
    return;
  }

  // Filter out zero-balance (paid off) accounts
  const activeAccounts = debtAccounts.filter(a => a.balance > 0);
  const totalDebt = debtAccounts.reduce((sum, a) => sum + a.balance, 0);

  try {
    const res = await fetch(stewardApiUrl('/api/snapshot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAssets: 0,
        totalDebt,
        monthlyIncome: 0,
        monthlyExpenses: 0,
        investmentValue: 0,
        debtAccounts,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      if (msgEl) msgEl.textContent = `Saved! Tier: ${data.tier}`;
      window.location.reload();
    } else {
      if (msgEl) msgEl.textContent = data.error || 'Failed to save.';
    }
  } catch (err) {
    if (msgEl) msgEl.textContent = 'Network error.';
  }

  if (btnEl) btnEl.disabled = false;
}

/* ── Init ─────────────────────────────────────────────────────────────────── */

export function initManualEntryForm() {
  const form = document.getElementById('manual-snapshot-form');
  const addBtn = document.getElementById('add-debt-account-btn');
  const container = document.getElementById('debt-accounts-entries');
  const updateBtn = document.getElementById('update-balances-btn');
  const msg = document.getElementById('snapshot-save-msg');

  if (!form || !addBtn || !container) return;

  // "+ Add Account" button
  addBtn.addEventListener('click', () => {
    addDebtAccountRow(container);
  });

  // Wire up the loading screen button
  const loadingBtn = document.getElementById('loading-sync-btn');
  if (loadingBtn) {
    const newBtn = loadingBtn.cloneNode(true);
    loadingBtn.parentNode.replaceChild(newBtn, loadingBtn);
    newBtn.addEventListener('click', () => {
      const loadingScreen = document.getElementById('loading-screen');
      const dashboard = document.getElementById('dashboard');
      if (loadingScreen) loadingScreen.style.display = 'none';
      if (dashboard) dashboard.style.display = '';
      document.body.dataset.appMode = 'ready';
      const panel = document.getElementById('manual-entry-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // "Save Debts" — adds new debts (from the add form)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newAccounts = collectDebtAccounts();
    const existingAccounts = collectSavedDebtUpdates();
    const allAccounts = [...existingAccounts, ...newAccounts];
    const formMsg = msg || document.getElementById('snapshot-save-msg');
    const saveBtn = document.getElementById('save-snapshot-btn');
    await saveSnapshot(allAccounts, formMsg, saveBtn);
  });

  // "Update Balances" — shows confirmation summary then saves
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      const updatedAccounts = collectSavedDebtUpdates();
      const newAccounts = collectDebtAccounts();
      const allAccounts = [...updatedAccounts, ...newAccounts];
      const summary = buildPaydownSummary(allAccounts);
      showPaydownConfirmation(summary, async () => {
        await saveSnapshot(allAccounts, msg, updateBtn);
      });
    });
  }

  // Prefill from last snapshot
  prefillFromLastSnapshot();
}

function showFirstTimeHint() {
  const container = document.getElementById('debt-accounts-entries');
  const existing = document.getElementById('first-time-hint');
  if (existing || !container) return;

  const hint = document.createElement('div');
  hint.id = 'first-time-hint';
  hint.className = 'first-time-hint';
  hint.innerHTML = `
    <p class="first-time-hint-title">Start by adding your debts</p>
    <p class="first-time-hint-text">Click <strong>"+ Add Account"</strong> above to enter each credit card, loan, or liability. Once saved, you'll be able to track your paydown progress over time.</p>
  `;
  container.parentNode.insertBefore(hint, container);
}

function prefillFromLastSnapshot() {
  fetch(stewardApiUrl('/api/status'))
    .then(r => r.json())
    .then(status => {
      if (!status || !status.ready || !status.stats) return;
      const s = status.stats;

      // Render saved debts list if we have debt account data
      if (s.debtAccountLines && s.debtAccountLines.length > 0) {
        renderSavedDebtsList(s.debtAccountLines);
      } else {
        showFirstTimeHint();
      }
    })
    .catch(() => {
      showFirstTimeHint();
    });
}
