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
    `;

    // Live total update on input
    const input = row.querySelector('.saved-debt-balance-input');
    input.addEventListener('input', () => updateSavedTotal());

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
  const loadingBtn = document.getElementById('loading-ynab-sync-btn');
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

  // "Update Balances" — saves updated balances from the saved debts list
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      const updatedAccounts = collectSavedDebtUpdates();
      // Also include any new accounts in the add form
      const newAccounts = collectDebtAccounts();
      const allAccounts = [...updatedAccounts, ...newAccounts];
      await saveSnapshot(allAccounts, msg, updateBtn);
    });
  }

  // Prefill from last snapshot
  prefillFromLastSnapshot();
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
      }
    })
    .catch(() => { /* no prefill on error */ });
}
