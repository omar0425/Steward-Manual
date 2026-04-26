'use strict';

import { stewardApiUrl, readJsonRes } from './api.js';

let _debtAccountCounter = 0;

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
  const rows = document.querySelectorAll('.debt-account-entry-row');
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

function prefillFromLastSnapshot() {
  fetch(stewardApiUrl('/api/status'))
    .then(r => r.json())
    .then(status => {
      if (!status || !status.ready || !status.stats) return;
      const s = status.stats;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null && Number.isFinite(Number(val)) && Number(val) > 0) {
          el.value = Number(val);
        }
      };
      // Prefill debt accounts
      const container = document.getElementById('debt-accounts-entries');
      if (container && s.debtAccountLines && s.debtAccountLines.length > 0) {
        container.innerHTML = '';
        for (const acct of s.debtAccountLines) {
          addDebtAccountRow(container, acct.name, acct.balance, acct.id);
        }
      }
    })
    .catch(() => { /* no prefill on error */ });
}

export function initManualEntryForm() {
  const form = document.getElementById('manual-snapshot-form');
  const addBtn = document.getElementById('add-debt-account-btn');
  const container = document.getElementById('debt-accounts-entries');
  const msg = document.getElementById('snapshot-save-msg');

  if (!form || !addBtn || !container) return;

  addBtn.addEventListener('click', () => {
    addDebtAccountRow(container);
  });

  // Wire up the loading screen button to scroll to the form
  const loadingBtn = document.getElementById('loading-ynab-sync-btn');
  if (loadingBtn) {
    // Remove old event listeners by cloning
    const newBtn = loadingBtn.cloneNode(true);
    loadingBtn.parentNode.replaceChild(newBtn, loadingBtn);
    newBtn.addEventListener('click', () => {
      // If we're on the loading screen, transition to ready and show the form
      const loadingScreen = document.getElementById('loading-screen');
      const dashboard = document.getElementById('dashboard');
      if (loadingScreen) loadingScreen.style.display = 'none';
      if (dashboard) dashboard.style.display = '';
      document.body.dataset.appMode = 'ready';
      const panel = document.getElementById('manual-entry-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-snapshot-btn');
    if (saveBtn) saveBtn.disabled = true;
    if (msg) msg.textContent = 'Saving\u2026';

    const totalDebtEl = document.getElementById('entry-total-debt');
    const totalDebt = totalDebtEl ? (parseFloat(totalDebtEl.value) || 0) : 0;
    const debtAccounts = collectDebtAccounts();

    if (debtAccounts.length === 0 && totalDebt <= 0) {
      if (msg) msg.textContent = 'Enter at least one debt account or a total debt amount.';
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

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
        if (msg) msg.textContent = `Snapshot saved! Tier: ${data.tier}`;
        // Reload the dashboard
        window.location.reload();
      } else {
        if (msg) msg.textContent = data.error || 'Failed to save.';
      }
    } catch (err) {
      if (msg) msg.textContent = 'Network error.';
    }

    if (saveBtn) saveBtn.disabled = false;
  });

  // Prefill from last snapshot if available
  prefillFromLastSnapshot();
}
