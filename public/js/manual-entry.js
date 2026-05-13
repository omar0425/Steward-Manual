'use strict';

import { stewardApiUrl, readJsonRes } from './api.js';

let _debtAccountCounter = 0;
let _originalDebtAccounts = [];

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDollar(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function nextDebtAccountId() {
  const used = new Set(
    Array.from(document.querySelectorAll('[data-account-id]'))
      .map((el) => el.dataset.accountId)
      .filter(Boolean)
  );

  let rowId;
  do {
    rowId = `manual-acct-${_debtAccountCounter++}`;
  } while (used.has(rowId));

  return rowId;
}

function addDebtAccountRow(container, name, balance, id) {
  const rowId = id || nextDebtAccountId();
  const row = document.createElement('div');
  row.className = 'debt-account-entry-row';
  row.dataset.accountId = rowId;
  row.innerHTML = `
    <input type="text" class="debt-acct-name" placeholder="Account name" maxlength="100" aria-label="Debt account name" />
    <input type="number" class="debt-acct-balance" step="0.01" min="0" placeholder="Balance" aria-label="Debt account balance" />
    <button type="button" class="debt-acct-remove" aria-label="Remove account">&times;</button>
  `;
  const nameInput = row.querySelector('.debt-acct-name');
  const removeBtn = row.querySelector('.debt-acct-remove');
  // Keep the remove button's aria-label in sync with the typed name so
  // screen readers announce e.g. "Remove Chase Sapphire" instead of a
  // bare "Remove account" for every row.
  const syncRemoveLabel = () => {
    const n = (nameInput.value || '').trim();
    removeBtn.setAttribute('aria-label', n ? `Remove ${n}` : 'Remove account');
  };
  nameInput.addEventListener('input', syncRemoveLabel);
  if (name) nameInput.value = name;
  if (balance != null) row.querySelector('.debt-acct-balance').value = balance;
  syncRemoveLabel();
  removeBtn.addEventListener('click', () => row.remove());
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
    // No saved debts — show the add form with financials visible (first-time setup)
    if (listEl) listEl.style.display = 'none';
    if (addSection) {
      addSection.style.display = '';
      const addFin = addSection.querySelector('.manual-entry-financials');
      if (addFin) addFin.style.display = '';
    }
    if (heading) heading.textContent = 'Add your debts';
    setSetupStartVisible(false);
    return;
  }

  // Snapshot original accounts for removed-account detection in buildPaydownSummary
  _originalDebtAccounts = debtLines.map(a => ({ id: a.id, name: a.name, balance: a.balance }));

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
      <div class="saved-debt-name"></div>
      <div class="saved-debt-balance">
        <span class="saved-debt-dollar">$</span>
        <input type="number" class="saved-debt-balance-input" step="0.01" min="0" value="${acct.balance}" />
      </div>
      <button type="button" class="saved-debt-remove" title="Remove">&times;</button>
    `;
    row.querySelector('.saved-debt-name').textContent = acct.name;
    row.querySelector('.saved-debt-remove').setAttribute('aria-label', `Remove ${acct.name}`);

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

  // Hide the financial snapshot block in the add form — user updates financials via UPDATE BALANCES
  const addFinancials = addSection && addSection.querySelector('.manual-entry-financials');
  if (addFinancials) addFinancials.style.display = 'none';

  // Clear any leftover rows in the add form
  const addEntries = document.getElementById('debt-accounts-entries');
  if (addEntries) addEntries.innerHTML = '';
}

function setSetupStartVisible(visible) {
  for (const id of ['start-climb-btn', 'start-climb-empty-btn']) {
    const btn = document.getElementById(id);
    if (btn) btn.hidden = !visible;
  }
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

  // Check for removed debts using snapshot captured at render time
  const currentIds = new Set(accounts.map(a => a.id));
  for (const orig of _originalDebtAccounts) {
    if (!currentIds.has(orig.id)) {
      changes.push({ name: orig.name, prev: orig.balance, curr: 0, delta: orig.balance, removed: true });
      totalPaid += orig.balance;
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

  // Remember the trigger so focus can return there after the dialog closes.
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.id = 'paydown-confirm-dialog';
  overlay.className = 'paydown-confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'paydown-confirm-title');

  let linesHtml = summary.changes.map(c => {
    const arrow = '\u2192';
    const safeName = escHtml(c.name);
    if (c.removed) {
      return `<div class="paydown-line paydown-removed"><span class="paydown-name">${safeName}</span> <span class="paydown-detail">removed</span></div>`;
    }
    const dir = c.delta > 0 ? 'paydown-paid' : 'paydown-added';
    const label = c.delta > 0 ? `paid $${Math.abs(c.delta).toLocaleString()}` : `+$${Math.abs(c.delta).toLocaleString()} added`;
    return `<div class="paydown-line ${dir}"><span class="paydown-name">${safeName}</span> <span class="paydown-detail">$${c.prev.toLocaleString()} ${arrow} $${c.curr.toLocaleString()} (${label})</span></div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="paydown-confirm-card">
      <h3 class="paydown-confirm-title" id="paydown-confirm-title">Confirm changes</h3>
      <div class="paydown-confirm-lines">${linesHtml}</div>
      ${summary.totalPaid > 0 ? `<div class="paydown-confirm-total">Total paid down: <strong>$${summary.totalPaid.toLocaleString()}</strong></div>` : ''}
      <div class="paydown-confirm-actions">
        <button type="button" class="paydown-confirm-cancel">Cancel</button>
        <button type="button" class="paydown-confirm-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeDialog = () => {
    overlay.remove();
    // Return focus to whatever opened the dialog so keyboard users don't
    // land at the top of the document.
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus(); } catch (_) { /* ignore */ }
    }
  };

  overlay.querySelector('.paydown-confirm-cancel').addEventListener('click', closeDialog);
  overlay.querySelector('.paydown-confirm-save').addEventListener('click', () => {
    closeDialog();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  // First focusable element inside the dialog receives focus on open.
  // Save button is the primary action; Cancel is reachable via Shift+Tab.
  const saveBtn = overlay.querySelector('.paydown-confirm-save');
  if (saveBtn) {
    try { saveBtn.focus(); } catch (_) { /* ignore */ }
  }
}

/* ── Save snapshot ────────────────────────────────────────────────────────── */

function readFinancialFields() {
  return { monthlyIncome: 0, monthlyExpenses: 0, totalAssets: 0, investmentValue: 0 };
}

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

  const fin = readFinancialFields();

  try {
    const res = await fetch(stewardApiUrl('/api/snapshot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAssets:      fin.totalAssets,
        totalDebt,
        monthlyIncome:    fin.monthlyIncome,
        monthlyExpenses:  fin.monthlyExpenses,
        investmentValue:  fin.investmentValue,
        debtAccounts,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      if (data.setupIncomplete) {
        if (document.body) document.body.dataset.setupMode = 'first';
        if (msgEl) msgEl.textContent = 'Saved. Add every debt, then start the climb.';
        renderSavedDebtsList(activeAccounts);
        setSetupStartVisible(activeAccounts.length > 0);
      } else {
        if (msgEl) {
          msgEl.textContent = `Saved! Tier: ${data.tier}`;
          // Surface preserved-field notice so the user understands why a 0
          // input didn't replace prior data. The message includes the
          // "allowZero" escape hatch — friendlier than silent overwrite.
          if (Array.isArray(data.preservedFields) && data.preservedFields.length > 0) {
            const note = document.createElement('span');
            note.className = 'manual-entry-preserved';
            note.textContent = data.message;
            msgEl.appendChild(document.createTextNode(' '));
            msgEl.appendChild(note);
            // Delay reload so the user can read the notice
            setTimeout(() => window.location.reload(), 4500);
            return;
          }
        }
        window.location.reload();
      }
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
  const startBtns = [
    document.getElementById('start-climb-btn'),
    document.getElementById('start-climb-empty-btn'),
  ].filter(Boolean);
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
    const formMsg = msg || document.getElementById('snapshot-save-msg');
    if (newAccounts.length === 0) {
      if (formMsg) formMsg.textContent = 'Add at least one account above before saving.';
      return;
    }
    const existingAccounts = collectSavedDebtUpdates();
    const allAccounts = [...existingAccounts, ...newAccounts];
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

  for (const startBtn of startBtns) {
    startBtn.addEventListener('click', async () => {
      const formMsg = msg || document.getElementById('snapshot-save-msg');
      startBtn.disabled = true;
      if (formMsg) formMsg.textContent = 'Locking starting debt...';
      try {
        const res = await fetch(stewardApiUrl('/api/start-game'), { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not start climb.');
        if (formMsg) formMsg.textContent = 'Climb started.';
        window.location.reload();
      } catch (err) {
        if (formMsg) formMsg.textContent = err && err.message ? err.message : 'Could not start climb.';
        startBtn.disabled = false;
      }
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

function prefillFinancialFields(stats) {
  const pairs = [
    ['update-total-assets',     stats.totalAssets],
    ['update-investment-value', stats.investmentValue],
    ['input-total-assets',      stats.totalAssets],
    ['input-investment-value',  stats.investmentValue],
  ];
  for (const [id, val] of pairs) {
    const el = document.getElementById(id);
    if (el && el.value === '' && val != null && Number(val) > 0) {
      el.value = String(Math.round(Number(val)));
    }
  }
}

function prefillFromLastSnapshot() {
  fetch(stewardApiUrl('/api/status'))
    .then(r => r.json())
    .then(status => {
      if (!status || !status.stats || (!status.ready && status.setupIncomplete !== true)) return;
      const s = status.stats;

      // Pre-fill financial snapshot fields from last saved values
      prefillFinancialFields(s);

      // Render saved debts list if we have debt account data
      if (s.debtAccountLines && s.debtAccountLines.length > 0) {
        renderSavedDebtsList(s.debtAccountLines);
        setSetupStartVisible(status.setupIncomplete === true);
      } else {
        setSetupStartVisible(false);
        showFirstTimeHint();
      }
    })
    .catch(() => {
      showFirstTimeHint();
    });
}
