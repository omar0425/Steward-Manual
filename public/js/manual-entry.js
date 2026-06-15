'use strict';

import { stewardApiUrl, readJsonRes } from './api.js';
import { manualRefresh } from './boot.js';
import { offerFirstVisitDashboardOnboarding } from './onboarding.js';

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

/* Normalize a balance value for display in a number input. Always shows two
   decimals so every row reads the same regardless of the underlying value
   ("2098.00" beside "18055.43" — uniform precision). QA bug #6: a mix of
   integer-rendered and 2-decimal-rendered inputs looks inconsistent. */
function formatBalanceForInput(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  // Whole dollars only — keeps every displayed figure summing cleanly.
  return String(Math.round(v));
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
    <input type="number" class="debt-acct-balance" step="any" min="0" inputmode="numeric" placeholder="Balance" aria-label="Debt account balance" />
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
    const balance = Math.round(parseFloat(row.querySelector('.debt-acct-balance').value));
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
    const balance = Math.round(parseFloat(input.value));
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
  const addBtn = document.getElementById('save-snapshot-btn');

  if (!listEl || !rowsEl || !debtLines || debtLines.length === 0) {
    // No saved debts — show the add form with financials visible (first-time setup)
    if (listEl) listEl.style.display = 'none';
    if (addSection) {
      addSection.style.display = '';
      const addFin = addSection.querySelector('.manual-entry-financials');
      if (addFin) addFin.style.display = '';
    }
    if (heading) heading.textContent = 'Add your debts';
    // Nothing saved yet, so saving IS the primary action — keep it gold.
    if (addBtn) { addBtn.textContent = 'Save Debts'; addBtn.classList.remove('commitment-btn--ghost'); }
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
        <input type="number" class="saved-debt-balance-input" step="any" min="0" inputmode="numeric" value="${formatBalanceForInput(acct.balance)}" />
      </div>
      <button type="button" class="saved-debt-remove" title="Remove">&times;</button>
    `;
    const savedNameEl = row.querySelector('.saved-debt-name');
    savedNameEl.textContent = acct.name;
    savedNameEl.title = acct.name;
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

  // Switch add section to "add more" mode. The list above already owns the
  // primary action (Update Balances / Start Climb), so this becomes the
  // clearly-secondary "Add account" — relabeled and de-emphasized to a ghost
  // button so users don't confuse it with saving their paydown.
  if (addSection) addSection.style.display = '';
  if (heading) heading.textContent = 'Add another account';
  if (addBtn) { addBtn.textContent = 'Add account'; addBtn.classList.add('commitment-btn--ghost'); }

  // Hide the financial snapshot block in the add form — user updates financials via UPDATE BALANCES
  const addFinancials = addSection && addSection.querySelector('.manual-entry-financials');
  if (addFinancials) addFinancials.style.display = 'none';

  // Clear any leftover rows in the add form
  const addEntries = document.getElementById('debt-accounts-entries');
  if (addEntries) addEntries.innerHTML = '';
}

function setSetupStartVisible(visible) {
  // Show exactly ONE Start Climb button. Once any debt is saved the saved-debts
  // list is visible and owns the primary action; the add-form's duplicate would
  // give the user two identical buttons stacked a few rows apart, which reads as
  // a bug. Keep the duplicate permanently hidden.
  const main = document.getElementById('start-climb-btn');
  if (main) main.hidden = !visible;
  const dupe = document.getElementById('start-climb-empty-btn');
  if (dupe) dupe.hidden = true;
}

function updateSavedTotal() {
  const totalEl = document.getElementById('saved-debts-total-val');
  if (!totalEl) return;
  const rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  let total = 0;
  for (const row of rows) {
    const input = row.querySelector('.saved-debt-balance-input');
    const val = Math.round(parseFloat(input.value));
    if (Number.isFinite(val) && val >= 0) total += val;
  }
  totalEl.textContent = fmtDollar(total);
  totalEl.classList.toggle('is-debt-clear', total <= 0.005);
  /* Live state changed — mirror into the read-only debt table, hero card,
     and panel total so the rest of the dashboard isn't lying about totals. */
  mirrorLiveDebtState(rows, total);
}

/* ── Live-state mirror ────────────────────────────────────────────────────── */
/* When the user edits or removes debts in the saved-debts list, the read-only
   "Debt Accounts" table and the hero stage card still show the last-saved
   snapshot. This function pushes the live state into those surfaces so they
   stop lying about totals. A small "Unsaved" badge is shown so users know
   they're previewing — the snapshot only updates when they click Save / Update.
   QA bugs #3 + #5. */
function mirrorLiveDebtState(rows, liveTotal) {
  if (!rows) rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  if (liveTotal == null) {
    liveTotal = 0;
    for (const row of rows) {
      const input = row.querySelector('.saved-debt-balance-input');
      const v = parseFloat(input && input.value);
      if (Number.isFinite(v) && v >= 0) liveTotal += v;
    }
  }
  /* Build a snapshot of live state by account id. Missing id == removed. */
  const liveById = new Map();
  let dirty = false;
  for (const row of rows) {
    const id = row.dataset.accountId;
    const input = row.querySelector('.saved-debt-balance-input');
    const v = parseFloat(input && input.value);
    if (id && Number.isFinite(v) && v >= 0) {
      liveById.set(id, v);
      const prev = parseFloat(row.dataset.prevBalance);
      if (Number.isFinite(prev) && Math.abs(prev - v) >= 0.005) dirty = true;
    }
  }

  /* Read-only debt accounts list: update or hide each row. */
  const readonlyList = document.getElementById('debt-accounts-list');
  if (readonlyList) {
    const readonlyRows = readonlyList.querySelectorAll('.debt-row');
    for (const r of readonlyRows) {
      const id = r.dataset.accountId;
      const balEl = r.querySelector('.dr-balance');
      if (!id || !balEl) continue;
      if (liveById.has(id)) {
        const liveVal = liveById.get(id);
        const snapshotVal = parseFloat(r.dataset.snapshotBalance);
        balEl.textContent = fmtDollar(Math.round(liveVal));
        if (Number.isFinite(snapshotVal) && Math.abs(snapshotVal - liveVal) >= 0.005) {
          r.classList.add('debt-row--live-edit');
          dirty = true;
        } else {
          r.classList.remove('debt-row--live-edit');
        }
        r.classList.remove('debt-row--removed');
        r.hidden = false;
      } else {
        r.classList.add('debt-row--removed');
        r.hidden = true;
        dirty = true;
      }
    }
  }

  const liveCleared = liveTotal <= 0.005;

  /* Panel total in the read-only Debt Accounts header. */
  const debtTotal = document.getElementById('debt-total-val');
  if (debtTotal) {
    debtTotal.textContent = fmtDollar(Math.round(liveTotal));
    debtTotal.classList.toggle('is-debt-clear', liveCleared);
  }

  /* Hero stage card: live debt remaining. */
  const cardFooterDebt = document.getElementById('card-footer-debt');
  if (cardFooterDebt) {
    cardFooterDebt.textContent = liveCleared
      ? 'Debt free'
      : `${fmtDollar(Math.round(liveTotal))} debt remaining`;
    cardFooterDebt.classList.toggle('is-debt-clear', liveCleared);
  }

  /* Session-level diff: replace the per-bullet rendering that came from the
     last snapshot with one driven by the LIVE list. Net = sum(live - prev)
     across rows still present, plus -prev for rows the user removed. This
     fixes QA bug #2 where adding-then-removing showed a net positive. */
  let liveAdded = 0;     // dollars added by edits (balance went UP)
  let livePaidDown = 0;  // dollars paid down by edits
  let liveNet = 0;
  for (const row of rows) {
    const prev = parseFloat(row.dataset.prevBalance);
    const input = row.querySelector('.saved-debt-balance-input');
    const curr = parseFloat(input && input.value);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const delta = curr - prev; // positive = balance grew = new debt
    if (delta > 0) liveAdded += delta;
    else if (delta < 0) livePaidDown += -delta;
    liveNet += delta;
  }
  /* Removed rows in saved-debts: snapshot value remains in
     _originalDebtAccounts. The live state collapsed them to zero, so the
     "diff" credits paid-down by the full prev balance. This is what the QA
     expects — "removed in same session" cancels the addition. */
  const liveIds = new Set();
  for (const row of rows) if (row.dataset.accountId) liveIds.add(row.dataset.accountId);
  for (const orig of _originalDebtAccounts) {
    if (!liveIds.has(orig.id)) {
      livePaidDown += orig.balance;
      liveNet += -orig.balance;
    }
  }

  /* Update Stage progress bullets (re-renders are gated by ENG_BUSY so we just
     overwrite the innerHTML). Mirrors fillPlayProgressDetailBullets in
     render-progress.js, but for the LIVE delta. */
  const elTurn = document.getElementById('progress-bullet-turn');
  if (elTurn) {
    const hasMove = Math.abs(liveNet) >= 0.01;
    const sign = liveNet > 0 ? '+' : liveNet < 0 ? '-' : '';
    const valStr = hasMove ? `${sign}$${Math.abs(Math.round(liveNet)).toLocaleString()}` : '$0';
    const cls = liveNet > 0 ? 'sp-val--bad' : liveNet < 0 ? 'sp-val--good' : '';
    elTurn.innerHTML = `<span class="sp-label">This turn</span><span class="sp-val ${cls}">${valStr}</span>`;
  }
  const elNew = document.getElementById('progress-bullet-newdebt');
  if (elNew) {
    const ndStr = liveAdded > 0.005 ? '+$' + Math.round(liveAdded).toLocaleString() : '$0';
    const cls = liveAdded > 0.005 ? 'sp-val--bad' : '';
    elNew.innerHTML = `<span class="sp-label">New debt added</span><span class="sp-val ${cls}">${ndStr}</span>`;
  }
  const elDir = document.getElementById('progress-bullet-direction');
  if (elDir) {
    let d = 'flat', cls = '';
    if (liveNet > 0.005) { d = 'backward'; cls = 'sp-val--bad'; }
    else if (liveNet < -0.005) { d = 'forward'; cls = 'sp-val--good'; }
    elDir.innerHTML = `<span class="sp-label">Net direction</span><span class="sp-val ${cls}">${d}</span>`;
  }
  /* "This Turn" big number in the session card. */
  const sessionNet = document.getElementById('this-turn-net');
  if (sessionNet) {
    const hasMove = Math.abs(liveNet) >= 0.01;
    const sign = liveNet > 0 ? '+' : liveNet < 0 ? '-' : '';
    sessionNet.textContent = hasMove ? `${sign}$${Math.abs(Math.round(liveNet)).toLocaleString()}` : '$0';
  }

  /* "Unsaved changes" badge — non-blocking nudge that the dashboard is showing
     a preview. Lives next to the saved-debts total so it's near the action. */
  ensureUnsavedBadge(dirty);
}

function ensureUnsavedBadge(show) {
  let badge = document.getElementById('saved-debts-unsaved-badge');
  if (!show) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    const totalRow = document.querySelector('.saved-debts-total');
    if (!totalRow) return;
    badge = document.createElement('div');
    badge.id = 'saved-debts-unsaved-badge';
    badge.className = 'saved-debts-unsaved-badge';
    badge.textContent = 'Unsaved — Update Balances to save';
    // Sit on its own line just above the action button. Appending it INSIDE the
    // total row made it the row's :last-child, where the dollar-amount styling
    // ballooned it to 16px rose and stranded the total via space-between.
    totalRow.insertAdjacentElement('afterend', badge);
  }
}

/* ── Paydown confirmation summary ─────────────────────────────────────────── */

function buildPaydownSummary(accounts) {
  const rows = document.querySelectorAll('#saved-debts-rows .saved-debt-row');
  const changes = [];
  let totalPaid = 0;

  for (const row of rows) {
    const name = row.dataset.name;
    const prev = Math.round(parseFloat(row.dataset.prevBalance));
    const input = row.querySelector('.saved-debt-balance-input');
    const curr = Math.round(parseFloat(input.value));
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const delta = prev - curr;
    if (Math.abs(delta) >= 1) {
      changes.push({ name, prev, curr, delta });
      if (delta > 0) totalPaid += delta;
    }
  }

  // Check for removed debts using snapshot captured at render time. A removed
  // account is listed for confirmation but is NOT counted as paid down — the
  // user didn't pay it, they stopped tracking it (matches cumulative metrics).
  const currentIds = new Set(accounts.map(a => a.id));
  for (const orig of _originalDebtAccounts) {
    if (!currentIds.has(orig.id)) {
      changes.push({ name: orig.name, prev: Math.round(orig.balance), curr: 0, delta: Math.round(orig.balance), removed: true });
    }
  }

  return { changes, totalPaid };
}

function showPaydownConfirmation(summary, newAccounts, onConfirm) {
  // Remove any existing dialog
  const existing = document.getElementById('paydown-confirm-dialog');
  if (existing) existing.remove();

  // newAccounts: genuinely-new accounts added this pull while a climb is active.
  // Each must be classified as new debt vs already-had before saving, so a
  // forgotten-then-added account doesn't silently spiral the user backward.
  const toClassify = Array.isArray(newAccounts) ? newAccounts : [];

  // Nothing to confirm AND nothing to classify → save straight through.
  if (summary.changes.length === 0 && toClassify.length === 0) {
    onConfirm([]);
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

  // Classification block for newly-added accounts. No default — the user must
  // pick, because guessing wrong either spirals them (counting a forgotten debt
  // as new) or flatters them (counting genuinely-new debt as pre-existing).
  const classifyHtml = toClassify.length === 0 ? '' : `
    <div class="paydown-classify-section">
      <p class="paydown-classify-intro">You're adding ${toClassify.length === 1 ? 'a new account' : 'new accounts'}. For each, is this debt you just took on, or one you already had and are only now tracking?</p>
      ${toClassify.map(a => `
        <div class="paydown-classify-row" data-account-id="${escHtml(String(a.id))}">
          <div class="paydown-classify-name">${escHtml(a.name)} <span class="paydown-classify-amt">$${Math.round(a.balance).toLocaleString()}</span></div>
          <div class="paydown-classify-opts">
            <label><input type="radio" name="classify-${escHtml(String(a.id))}" value="new"> New debt I just took on</label>
            <label><input type="radio" name="classify-${escHtml(String(a.id))}" value="existing"> A debt I already had</label>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  overlay.innerHTML = `
    <div class="paydown-confirm-card">
      <h3 class="paydown-confirm-title" id="paydown-confirm-title">Confirm changes</h3>
      <div class="paydown-confirm-lines">${linesHtml}</div>
      ${summary.totalPaid > 0 ? `<div class="paydown-confirm-total">Total paid down: <strong>$${summary.totalPaid.toLocaleString()}</strong></div>` : ''}
      ${classifyHtml}
      <div class="paydown-confirm-actions">
        <button type="button" class="paydown-confirm-cancel">Cancel</button>
        <button type="button" class="paydown-confirm-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Save stays disabled until every new account is classified.
  const saveBtnEl = overlay.querySelector('.paydown-confirm-save');
  const radios = Array.from(overlay.querySelectorAll('.paydown-classify-opts input[type="radio"]'));
  function allClassified() {
    return toClassify.every(a => overlay.querySelector(`input[name="classify-${CSS.escape(String(a.id))}"]:checked`));
  }
  function refreshSaveEnabled() {
    if (saveBtnEl) saveBtnEl.disabled = toClassify.length > 0 && !allClassified();
  }
  radios.forEach(r => r.addEventListener('change', refreshSaveEnabled));
  refreshSaveEnabled();
  function collectPreexistingIds() {
    return toClassify
      .filter(a => {
        const checked = overlay.querySelector(`input[name="classify-${CSS.escape(String(a.id))}"]:checked`);
        return checked && checked.value === 'existing';
      })
      .map(a => String(a.id));
  }

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
    if (toClassify.length > 0 && !allClassified()) return; // guard double-fire
    const preexistingIds = collectPreexistingIds();
    closeDialog();
    onConfirm(preexistingIds);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  // Focus the first actionable control. When classification is required the
  // Save button starts disabled, so focus the first radio instead.
  const focusTarget = toClassify.length > 0
    ? overlay.querySelector('.paydown-classify-opts input[type="radio"]')
    : saveBtnEl;
  if (focusTarget) {
    try { focusTarget.focus(); } catch (_) { /* ignore */ }
  }
}

/* ── Save snapshot ────────────────────────────────────────────────────────── */

/* After the server confirms a save, rebuild the editable "saved debts" list
   from authoritative state. manualRefresh() re-renders the read-only dashboard
   (hero, totals, debt table, chart) but NOT these editable rows — so without
   this the rows keep their old prevBalance baselines, the "Unsaved" badge
   lingers after a successful save, and a newly-added account doesn't show up in
   the editable list until a full page reload. */
function resyncSavedDebtsFromServer() {
  return fetch(stewardApiUrl('/api/status'))
    .then(r => r.json())
    .then(status => {
      const lines = status && status.stats && Array.isArray(status.stats.debtAccountLines)
        ? status.stats.debtAccountLines
        : [];
      renderSavedDebtsList(lines);
      ensureUnsavedBadge(false);
      // "Start Climb" is a setup-only action; once the climb is running the
      // server reports setupIncomplete=false, so keep the buttons hidden.
      setSetupStartVisible(status && status.setupIncomplete === true);
    })
    .catch(() => { /* non-fatal — the read-only dashboard already refreshed */ });
}

async function saveSnapshot(debtAccounts, msgEl, btnEl, opts = {}) {
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
  // Accounts the user marked "I already had this" \u2014 server folds them into the
  // baseline instead of counting them as new debt.
  const preexistingAccountIds = Array.isArray(opts.preexistingAccountIds) ? opts.preexistingAccountIds : [];

  try {
    const res = await fetch(stewardApiUrl('/api/snapshot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAssets:      0,
        totalDebt,
        monthlyIncome:    0,
        monthlyExpenses:  0,
        investmentValue:  0,
        debtAccounts,
        preexistingAccountIds,
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
            // Delay the soft refresh so the user can read the notice. Using
            // manualRefresh() (not location.reload) means the message stays
            // on-screen while the dashboard underneath updates in place.
            setTimeout(() => { void manualRefresh(); void resyncSavedDebtsFromServer(); }, 4500);
            return;
          }
        }
        // Soft refresh — re-fetches /api/status and re-renders without the
        // full-page flash. Also lets the Steward AI dialog fire as soon as
        // the new "Live" snapshot lands, rather than after a fresh page boot.
        await manualRefresh();
        // Rebuild the editable saved-debts rows so new accounts appear, the
        // prevBalance baselines reset, and the "Unsaved" badge clears.
        await resyncSavedDebtsFromServer();
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

  // "Save Debts" — adds new debts (from the add form)
  /* Validation toast: snappy 3s auto-dismiss, a clear × button so users can
     get rid of it instantly, and dismissal on any subsequent interaction with
     the add-debt form. QA bug #7. */
  let validationClearTimer = null;
  function getFormMsg() {
    return msg || document.getElementById('snapshot-save-msg');
  }
  function setValidationMsg(text) {
    const formMsg = getFormMsg();
    if (!formMsg) return;
    if (validationClearTimer) { window.clearTimeout(validationClearTimer); validationClearTimer = null; }
    if (!text) {
      formMsg.textContent = '';
      formMsg.classList.remove('manual-entry-validation');
      return;
    }
    /* Build a dismissible chip: text + × button. We re-render every call so
       the close button is fresh and rebound. */
    formMsg.textContent = '';
    formMsg.classList.add('manual-entry-validation');
    const label = document.createElement('span');
    label.className = 'manual-entry-validation-text';
    label.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'manual-entry-validation-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => dismissValidationMsg());
    formMsg.appendChild(label);
    formMsg.appendChild(close);
    validationClearTimer = window.setTimeout(() => {
      dismissValidationMsg();
    }, 3000);
  }
  /* Dismiss the validation message as soon as the user starts typing or adds
     a row in the add form — they're acting on it, no need to keep nagging. */
  function dismissValidationMsg() {
    const formMsg = getFormMsg();
    if (validationClearTimer) { window.clearTimeout(validationClearTimer); validationClearTimer = null; }
    if (!formMsg) return;
    formMsg.textContent = '';
    formMsg.classList.remove('manual-entry-validation');
  }
  container.addEventListener('input', dismissValidationMsg);
  container.addEventListener('focusin', dismissValidationMsg);
  addBtn.addEventListener('click', dismissValidationMsg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newAccounts = collectDebtAccounts();
    if (newAccounts.length === 0) {
      setValidationMsg('Add at least one account above before saving.');
      return;
    }
    /* Successful submit clears any stale validation chip before kicking off the save. */
    dismissValidationMsg();
    const existingAccounts = collectSavedDebtUpdates();
    const allAccounts = [...existingAccounts, ...newAccounts];
    const saveBtn = document.getElementById('save-snapshot-btn');
    const formMsg = getFormMsg();
    await saveSnapshot(allAccounts, formMsg, saveBtn);
  });

  // "Update Balances" — shows confirmation summary then saves
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      const updatedAccounts = collectSavedDebtUpdates();
      const newAccounts = collectDebtAccounts();
      const allAccounts = [...updatedAccounts, ...newAccounts];
      const summary = buildPaydownSummary(allAccounts);
      // Only ask the new-debt-vs-already-had question once a climb is running —
      // during first-run setup every account is just inventory, no baseline yet.
      const isSetup = document.body && document.body.dataset.setupMode === 'first';
      const toClassify = isSetup ? [] : newAccounts.filter(a => a.balance > 0);
      showPaydownConfirmation(summary, toClassify, async (preexistingAccountIds) => {
        await saveSnapshot(allAccounts, msg, updateBtn, { preexistingAccountIds });
      });
    });
  }

  for (const startBtn of startBtns) {
    startBtn.addEventListener('click', async () => {
      const formMsg = msg || document.getElementById('snapshot-save-msg');
      startBtn.disabled = true;
      if (formMsg) formMsg.textContent = 'Locking starting debt...';
      try {
        // Capture whatever is on screen right now before locking the baseline.
        // In setup we hide "Update Balances", so an inline edit in the saved
        // list (or a half-filled add-form row) would otherwise never reach the
        // server and the starting line would be wrong. Save silently first.
        const pending = [...collectSavedDebtUpdates(), ...collectDebtAccounts()];
        if (pending.length > 0) {
          await saveSnapshot(pending, null, null);
        }
        const res = await fetch(stewardApiUrl('/api/start-game'), { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not start climb.');
        if (formMsg) formMsg.textContent = 'Climb started.';
        // The climb is now running, so the setup-only "Start Climb" buttons must
        // not linger on the dashboard. This soft-refresh path never reloads the
        // page, so hide them explicitly (page reload would re-hide via prefill).
        setSetupStartVisible(false);
        // Soft refresh — /api/status will now return ready:true with the
        // baseline locked, so the dashboard re-renders into play mode
        // without the start-game gate flashing back in mid-transition.
        await manualRefresh();
        // First-visit tour. Boot only offers it on a full-page load, and the
        // setup view has no dashboard root yet — so without this, a brand-new
        // user's first dashboard session never gets the tour (it would
        // surprise them on their NEXT visit instead). Same 480ms grace as boot.
        window.setTimeout(() => offerFirstVisitDashboardOnboarding(), 480);
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

function prefillFromLastSnapshot() {
  fetch(stewardApiUrl('/api/status'))
    .then(r => r.json())
    .then(status => {
      if (!status || !status.stats || (!status.ready && status.setupIncomplete !== true)) return;
      const s = status.stats;

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
