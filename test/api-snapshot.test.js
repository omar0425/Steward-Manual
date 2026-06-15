'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { latestSnapshot, resetAllGameState, withUser } = require('../db');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  withUser(0, resetAllGameState);
});

test('POST /api/snapshot: aggregate-only snapshots update climb paydown totals', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 1000,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 800,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.stats.cumulativePaidDown, 200);
    assert.equal(status.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: first saved debts stay in setup until start-game', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 25000 },
      ],
    });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.setupIncomplete, true);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.ready, false);
    assert.equal(body.setupIncomplete, true);
    assert.equal(body.stats.gameStartDebt, null);
    assert.equal(body.stats.debtRemaining, 25000);
    assert.equal(body.stats.debtAccountLines.length, 1);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.tier.id, 'rock_bottom');
    assert.equal(body.stats.gameStartDebt, 25000);
    assert.equal(body.stats.climbBaselineDebt, 25000);
    assert.equal(body.stats.cumulativePaidDown, 0);
  });
});

test('POST /api/snapshot: small starting debts still begin at rock bottom', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2500 },
        { id: 'loan-b', name: 'Loan B', balance: 1800 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.tier.id, 'rock_bottom');
    assert.equal(body.tier.label, 'Buried');
    assert.equal(body.stats.debtRemaining, 4300);
    assert.equal(body.stats.debtTierBandPct, 0);
    assert.equal(body.nextTier.id, 'broke');
    assert.equal(body.nextTier.gapDollars, 477.78);
  });
});

test('POST /api/snapshot: switching from aggregate to accounts does not create fake new debt', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 4300,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2500 },
        { id: 'loan-b', name: 'Loan B', balance: 1800 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.debtRemaining, 4300);
    assert.equal(body.stats.cumulativePaidDown, 0);
    assert.equal(body.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: aggregate to accounts handoff still counts real aggregate delta', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 4300,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 2300 },
        { id: 'loan-b', name: 'Loan B', balance: 1700 },
      ],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.debtRemaining, 4000);
    assert.equal(body.stats.cumulativePaidDown, 300);
    assert.equal(body.stats.cumulativeNewDebtAdded, 0);
  });
});

test('POST /api/snapshot: duplicate debt account ids are rejected before write', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: 500,
      debtAccounts: [
        { id: 'card', name: 'Card A', balance: 200 },
        { id: 'card', name: 'Card B', balance: 300 },
      ],
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Duplicate debt account id/);
    assert.equal(withUser(0, () => latestSnapshot()), null);
  });
});

test('POST /api/snapshot: negative debt is rejected before write', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      totalDebt: -1,
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'totalDebt cannot be negative');
    assert.equal(withUser(0, () => latestSnapshot()), null);
  });
});

test('POST /api/snapshot: empty body is rejected', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/snapshot', {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /empty/i);
    assert.equal(withUser(0, () => latestSnapshot()), null);
  });
});

test('POST /api/snapshot: non-finite balance string is rejected, not silently zeroed', async () => {
  await withApp(async (baseUrl) => {
    // First a real snapshot + start-game so a typo on the next pull would
    // otherwise have collapsed debtRemaining to 0 and crowned the user "wealthy".
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // The bug: a string like "$3,000.00" used to coerce to NaN → 0 → dropped.
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: '$3,000.00' }],
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /balance must be a number/i);

    // State is unchanged: still 4000, still not "Debt Free".
    const statusRes = await fetch(`${baseUrl}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.stats.debtRemaining, 4000);
    assert.notEqual(status.tier.id, 'wealthy');
  });
});

test('POST /api/snapshot: paying an account to 0 counts as paydown, keeps it on the milestone list', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 4200 },
        { id: 'card-b', name: 'Card B', balance: 1000 },
      ],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // Pay Card A all the way off
    res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 0 },
        { id: 'card-b', name: 'Card B', balance: 1000 },
      ],
    });
    assert.equal(res.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.stats.cumulativePaidDown, 4200, 'paid-off balance should count as paydown');
    assert.equal(status.stats.debtRemaining, 1000);
    const paidOffMilestone = status.recentMilestones.find((m) => m.type === 'account-paid-off');
    assert.ok(paidOffMilestone, 'milestone for paid-off account should fire');
    assert.equal(paidOffMilestone.accountName, 'Card A');
    // Per-pull change should be present with the real name (not "Account")
    const changeRow = status.stats.lastPullAccountChanges.find((r) => r.name === 'Card A');
    assert.ok(changeRow);
    assert.equal(changeRow.kind, 'paid_off');
    assert.equal(changeRow.delta, -4200);
  });
});

test('POST /api/snapshot: removing an account from the array still does NOT count as paydown', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 4200 },
        { id: 'card-b', name: 'Card B', balance: 1000 },
      ],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/snapshot', {
      // Card A removed (data cleanup, not paid off)
      debtAccounts: [{ id: 'card-b', name: 'Card B', balance: 1000 }],
    });
    assert.equal(res.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.stats.cumulativePaidDown, 0, 'removed account is not paydown');
  });
});

test('POST /api/snapshot: tier-change is surfaced as a milestone', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 9000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // Cross rock_bottom→broke: with baseline 9000, idx 1 spans paid ∈ [1/9, 2/9)
    // i.e. debt ∈ (7000, 8000]. Pay $1,500 → debt $7,500 lands in broke (idx 1).
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 7500 }],
    });
    assert.equal(res.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.tier.id, 'broke');
    const tierMilestone = status.recentMilestones.find((m) => m.type === 'tier-change');
    assert.ok(tierMilestone, 'tier-change milestone should fire');
    assert.equal(tierMilestone.from, 'rock_bottom');
    assert.equal(tierMilestone.to, 'broke');
  });
});

test('POST /api/snapshot: zero totalAssets is preserved silently UNLESS allowZero, and is surfaced in response', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1500,
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // Submit 0 — should preserve and tell the user
    res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 0,
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.preservedFields), 'preservedFields should be present');
    const preserved = body.preservedFields.find((f) => f.field === 'totalAssets');
    assert.ok(preserved);
    assert.equal(preserved.value, 1500);
    assert.match(body.message, /allowZero/i);

    // Now opt in to zero
    res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 0,
      allowZero: true,
      debtAccounts: [{ id: 'card-a', name: 'Card A', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    const body2 = await res.json();
    assert.ok(!body2.preservedFields, 'allowZero should suppress preservation');
    const statusRes = await fetch(`${baseUrl}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.stats.totalAssets, 0);
  });
});

test('POST /api/reset-game: response reports what was deleted and preserved', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [
        { id: 'card-a', name: 'Card A', balance: 4000 },
        { id: 'card-b', name: 'Card B', balance: 2000 },
      ],
    });
    assert.equal(res.status, 200);
    await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    res = await postJson(baseUrl, '/api/config/interest-rates', {
      rates: { 'card-a': 18.99, 'card-b': 22 },
    });
    assert.equal(res.status, 200);

    res = await postJson(baseUrl, '/api/reset-game', { confirm: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.deleted, 'deleted summary should be present');
    assert.ok(body.deleted.snapshots >= 1);
    assert.ok(body.deleted.debtAccountBalances >= 2);
    assert.ok(body.deleted.gameStateConfigKeys >= 1);
    assert.equal(body.preserved.interestRates, 2);

    // Verify interest_rates actually survive (not just reported as preserved)
    const ratesRes = await fetch(`${baseUrl}/api/config/interest-rates`);
    const ratesBody = await ratesRes.json();
    assert.equal(Object.keys(ratesBody.rates).length, 2);
  });
});

test('GET /api/status: debt-free user gets a friendly message, not "In the hole"', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 10000,
      totalDebt: 0,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    const status = await res.json();
    assert.equal(status.setupIncomplete, true);
    assert.equal(status.debtFree, true);
    assert.match(status.message, /No debt to track/i);
  });
});

test('POST /api/start-game: rejects when there is no debt to climb', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 10000,
      totalDebt: 0,
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /No debt to climb/i);
  });
});

test('GET /api/status: monthsEstimate stays null until at least a day of history exists', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'a', name: 'A', balance: 10000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'a', name: 'A', balance: 9500 }],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/status`);
    const status = await res.json();
    // Two snapshots seconds apart should NOT yield a misleading "1 month away"
    // estimate. Min sample window is 1 day.
    assert.equal(status.nextTier.monthsEstimate, null);
  });
});

test('promise config: roundtrip, trimming, and reset-game clears it', async () => {
  await withApp(async (baseUrl) => {
    // Fresh user: not made.
    let res = await fetch(`${baseUrl}/api/config/promise`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.made, false);
    assert.equal(body.madeAt, null);
    assert.equal(body.text, '');

    // Make the promise with a reason (padded — server trims).
    res = await postJson(baseUrl, '/api/config/promise', { text: '  for my kids  ' });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.made, true);
    assert.ok(body.madeAt);
    assert.equal(body.text, 'for my kids');
    const firstMadeAt = body.madeAt;

    // Editing the reason later must not move the original madeAt timestamp.
    res = await postJson(baseUrl, '/api/config/promise', { text: 'new reason' });
    body = await res.json();
    assert.equal(body.madeAt, firstMadeAt);
    assert.equal(body.text, 'new reason');

    // Non-string text rejected.
    res = await postJson(baseUrl, '/api/config/promise', { text: 42 });
    assert.equal(res.status, 400);

    // Long text capped at 280 chars.
    res = await postJson(baseUrl, '/api/config/promise', { text: 'x'.repeat(500) });
    body = await res.json();
    assert.equal(body.text.length, 280);

    // Clear game data wipes the promise (matches resetPlayGame clearing localStorage).
    res = await postJson(baseUrl, '/api/reset-game', { confirm: true });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/config/promise`);
    body = await res.json();
    assert.equal(body.made, false);
    assert.equal(body.text, '');
  });
});

test('GET /api/export: full user data with dated attachment filename', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 3500 }],
    });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/api/export`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="steward-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.json();
    assert.equal(body.app, 'steward-manual');
    assert.ok(body.exportedAt);
    assert.ok(Array.isArray(body.snapshots) && body.snapshots.length >= 2);
    assert.ok(Array.isArray(body.debtAccountHistory) && body.debtAccountHistory.length >= 1);
    assert.equal(body.debtAccountBalances[0].accountId, 'visa');
    assert.equal(typeof body.settings, 'object');
    // Raw snapshot columns preserved (faithful record, not a UI projection).
    assert.ok('debt_remaining' in body.snapshots[0]);
  });
});

test('GET /api/export?format=csv: Excel-ready snapshot series and account history', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalAssets: 1000,
      debtAccounts: [{ id: 'visa', name: 'Visa, "Gold" Card', balance: 4000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa, "Gold" Card', balance: 3500 }],
    });
    assert.equal(res.status, 200);

    // Snapshot series (default CSV)
    res = await fetch(`${baseUrl}/api/export?format=csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /steward-snapshots-\d{4}-\d{2}-\d{2}\.csv/);
    // fetch().text() strips a leading BOM per spec — check the raw bytes.
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM present for Excel UTF-8 detection');
    const csv = buf.toString('utf8').replace(/^﻿/, '');
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0].replace('﻿', ''), 'pulled_at,total_debt,debt_remaining,total_assets,investment_value,monthly_income,monthly_expenses,net_worth,tier');
    assert.ok(lines.length >= 3, 'header + 2 snapshot rows');
    // Excel-friendly datetime: no T separator, no trailing Z
    assert.match(lines[1], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/);

    // Per-account history with names quoted correctly (comma + quotes in name)
    res = await fetch(`${baseUrl}/api/export?format=csv&table=accounts`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /steward-accounts-\d{4}-\d{2}-\d{2}\.csv/);
    const acsv = await res.text();
    const alines = acsv.trim().split('\r\n');
    assert.equal(alines[0].replace('﻿', ''), 'account_id,account_name,recorded_at,balance');
    assert.ok(alines.length >= 3, 'two history rows for visa');
    assert.match(alines[1], /^visa,"Visa, ""Gold"" Card",/, 'name with comma+quotes is CSV-escaped');
  });
});

test('forgot-a-debt: flagging a new account as pre-existing folds it into baseline, not new debt', async () => {
  await withApp(async (baseUrl) => {
    // Baseline: two accounts totaling $20,000.
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 12000 }, { id: 'car', name: 'Car', balance: 8000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // Pay down $2,000 on Visa → $18,000 total.
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 10000 }, { id: 'car', name: 'Car', balance: 8000 }],
    });
    assert.equal(res.status, 200);

    let status = await (await fetch(`${baseUrl}/api/status`)).json();
    const baselineBefore = status.stats.climbBaselineDebt;
    const paidBefore = status.stats.cumulativePaidDown;
    const newDebtBefore = status.stats.cumulativeNewDebtAdded;
    assert.equal(baselineBefore, 20000);
    assert.equal(paidBefore, 2000);
    assert.equal(newDebtBefore, 0);

    // Now the user remembers a $5,000 loan they always had and adds it,
    // flagging it pre-existing. It must NOT count as new debt, and the
    // baseline must rise so the stage position is preserved.
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [
        { id: 'visa', name: 'Visa', balance: 10000 },
        { id: 'car', name: 'Car', balance: 8000 },
        { id: 'loan', name: 'Forgotten Loan', balance: 5000 },
      ],
      preexistingAccountIds: ['loan'],
    });
    assert.equal(res.status, 200);

    status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.equal(status.stats.climbBaselineDebt, 25000, 'baseline rose by the forgotten $5k');
    assert.equal(status.stats.cumulativeNewDebtAdded, 0, 'forgotten debt is NOT counted as new debt');
    assert.equal(status.stats.cumulativePaidDown, 2000, 'paid-down unchanged');
    assert.equal(status.stats.debtRemaining, 23000, 'current debt includes the loan');
    // The honest invariant: amount paid (baseline - current) is preserved.
    assert.equal(status.stats.climbBaselineDebt - status.stats.debtRemaining, 2000);
  });
});

test('forgot-a-debt: WITHOUT the flag, a new account counts as new debt (the spiral)', async () => {
  await withApp(async (baseUrl) => {
    let res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 12000 }],
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
    assert.equal(res.status, 200);

    // Add a $5k account with NO flag → default behavior counts it as new debt.
    res = await postJson(baseUrl, '/api/snapshot', {
      debtAccounts: [{ id: 'visa', name: 'Visa', balance: 12000 }, { id: 'loan', name: 'Loan', balance: 5000 }],
    });
    assert.equal(res.status, 200);

    const status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.equal(status.stats.climbBaselineDebt, 12000, 'baseline unchanged without the flag');
    assert.equal(status.stats.cumulativeNewDebtAdded, 5000, 'unflagged new account = new debt');
  });
});
