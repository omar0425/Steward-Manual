'use strict';

// Admin-only bug reporting: capture endpoint, signature dedupe, and — most
// importantly — the visibility gate. Reports come from EVERY user but must be
// readable by exactly one account; a regular user probing the admin routes
// must get an answer indistinguishable from "there is no such feature".
// No ANTHROPIC_API_KEY in the test env, so the AI-triage branch never fires;
// what's asserted here is the deterministic fallback path.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { bugSignature, executeStewardTool } = require('../routes/api');
// Top-level (NOT lazy) requires: zzz-climb-metrics-apply.test clears the module
// cache for db when it loads, so an in-test require would grab a fresh copy
// bound to a different AsyncLocalStorage than the router's withUser().
const {
  upsertBugReport,
  setBugReportTriage,
  listBugReports,
  countNewBugReports,
  markAllBugReportsSeen,
  withUser,
  setConfig,
  resetAllGameState,
} = require('../db');
const { checkLedgerInvariants } = require('../services/ledgerInvariants');

const run = (fn) => withUser(1, fn);

// Matches the default in routes/api.js (CUTSCENE_USERNAME) — the admin when
// STEWARD_ADMIN_USERNAME isn't set, which it never is in tests.
const ADMIN = 'LoudFlipFlopz';

function startApp(username, userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { userId, username }; next(); });
  app.use('/api', apiRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function withApp(username, fn) {
  const { server, baseUrl } = await startApp(username);
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('upsertBugReport dedupes by signature: bumps count, re-opens seen reports', () => {
  const sig = 'test-dedupe-' + process.pid;
  const first = upsertBugReport({ signature: sig, kind: 'error', userId: 7, raw: '{"a":1}' });
  assert.equal(first.isNew, true);
  assert.equal(first.count, 1);

  const again = upsertBugReport({ signature: sig, kind: 'error', userId: 9, raw: '{"a":2}' });
  assert.equal(again.isNew, false);
  assert.equal(again.id, first.id);
  assert.equal(again.count, 2);

  // A seen report that recurs must come back as 'new' — a recurring bug the
  // admin already dismissed is still news.
  markAllBugReportsSeen();
  upsertBugReport({ signature: sig, kind: 'error', userId: 7, raw: '{"a":3}' });
  const row = listBugReports(200).find((r) => r.id === first.id);
  assert.equal(row.status, 'new');
  assert.equal(row.count, 3);
});

test('bugSignature collapses digits: same bug with different values dedupes', () => {
  const a = bugSignature('error', 'Balance 4200 is invalid', 'at save (app.js:120:5)');
  const b = bugSignature('error', 'Balance 87 is invalid', 'at save (app.js:415:9)');
  const c = bugSignature('error', 'Name is required', 'at save (app.js:120:5)');
  assert.equal(a, b);
  assert.notEqual(a, c);
  // Same message caught differently is a different signature (different path).
  assert.notEqual(a, bugSignature('unhandledrejection', 'Balance 4200 is invalid', ''));
});

test('POST /api/bug-report records with a readable fallback title (no AI key in tests)', async () => {
  const marker = `Unique explosion ${process.pid}-A`;
  await withApp('SomeRegularUser', async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/bug-report', {
      message: marker,
      stack: 'Error: boom\n    at pull (main.js:10:2)',
      url: '/play',
      source: 'error',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
  const row = listBugReports(200).find((r) => r.title === marker);
  assert.ok(row, 'report row exists with the fallback title');
  assert.equal(row.kind, 'error');
  assert.equal(row.status, 'new');
  assert.equal(row.severity, null); // untriaged — no AI in tests
  assert.ok(row.raw.includes('/play'));
});

test('POST /api/bug-report never errors to the caller: junk in, {ok:true} out', async () => {
  await withApp('SomeRegularUser', async (baseUrl) => {
    for (const body of [{}, { message: '' }, { message: 42 }, { stack: 'no message' }]) {
      const res = await postJson(baseUrl, '/api/bug-report', body);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    }
  });
});

test('POST /api/bug-report caps oversized fields instead of storing them', async () => {
  const marker = `Unique explosion ${process.pid}-B `;
  await withApp('SomeRegularUser', async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/bug-report', {
      message: marker + 'x'.repeat(2000),
      stack: 'y'.repeat(20000),
      url: '/z'.repeat(500),
      source: 'error',
    });
    assert.equal(res.status, 200);
  });
  const row = listBugReports(200).find((r) => r.title && r.title.startsWith(marker.slice(0, 50)));
  assert.ok(row, 'capped report exists');
  assert.ok(row.title.length <= 120);
  assert.ok(row.raw.length <= 8000);
});

test('admin gate: regular users get a feature-less probe answer, admin gets reports', async () => {
  const marker = `Unique explosion ${process.pid}-C`;
  await withApp('SomeRegularUser', async (baseUrl) => {
    await postJson(baseUrl, '/api/bug-report', { message: marker, source: 'error' });

    // Non-admin read: 200 {ok, admin:false} and NOTHING else — no counts, no
    // reports, no clue the capture system exists.
    const probe = await fetch(`${baseUrl}/api/admin/bug-reports`);
    assert.equal(probe.status, 200);
    const body = await probe.json();
    assert.deepEqual(body, { ok: true, admin: false });

    // Non-admin mark-seen: plain 404, like any unknown route.
    const seen = await postJson(baseUrl, '/api/bug-reports-nonexistent', {});
    assert.equal(seen.status, 404);
    const seenReal = await fetch(`${baseUrl}/api/admin/bug-reports/seen`, { method: 'POST' });
    assert.equal(seenReal.status, 404);
  });

  await withApp(ADMIN, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/bug-reports`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.admin, true);
    assert.ok(Array.isArray(body.reports));
    const mine = body.reports.find((r) => r.title === marker);
    assert.ok(mine, 'admin sees the report a regular user generated');
    assert.ok(body.newCount >= 1);
    // The list payload must not include the reporter-identifying raw blob keys
    // beyond what the panel needs; specifically no stack in the summary rows.
    assert.ok(!('raw' in mine));
  });
});

test('admin mark-all-seen clears the badge and is idempotent', async () => {
  await withApp(ADMIN, async (baseUrl) => {
    // Ensure at least one new report exists.
    upsertBugReport({ signature: 'test-seen-' + process.pid, kind: 'error', userId: 1, raw: '{}' });
    const res = await fetch(`${baseUrl}/api/admin/bug-reports/seen`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.cleared >= 1);
    assert.equal(countNewBugReports(), 0);
    const again = await fetch(`${baseUrl}/api/admin/bug-reports/seen`, { method: 'POST' });
    assert.equal((await again.json()).cleared, 0);
  });
});

test('ledger invariants: clean climb passes; each corruption fires its rule', async () => {
  await withApp('InvariantUser', async (baseUrl) => {
    run(resetAllGameState);
    // Seed a climb through the real save + start path.
    let res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 9000,
      debtAccounts: [
        { id: 'card', name: 'Card', balance: 6000 },
        { id: 'loan', name: 'Loan', balance: 3000 },
      ],
    });
    assert.equal(res.status, 200);
    res = await postJson(baseUrl, '/api/start-game', {});
    assert.equal(res.status, 200);

    // Healthy state → nothing to report.
    assert.deepEqual(run(checkLedgerInvariants), []);

    // Corrupt a cumulative counter → counter rule (raw value, pre-clamp).
    run(() => setConfig('cumulative_paid_down', '-500'));
    let v = run(checkLedgerInvariants);
    assert.ok(v.some((x) => x.rule === 'counter_corrupt:cumulative_paid_down'), 'negative counter caught');
    run(() => setConfig('cumulative_paid_down', '0'));

    // Corrupt the stored aggregate → mismatch AND identity drift.
    run(() => setConfig('last_aggregate_debt_for_climb', '4444'));
    v = run(checkLedgerInvariants);
    assert.ok(v.some((x) => x.rule === 'aggregate_mismatch'), 'aggregate/sum divergence caught');
    assert.ok(v.some((x) => x.rule === 'ledger_drift'), 'identity drift caught');
    // Reports must not leak balances — magnitudes only.
    for (const x of v) assert.ok(!/6000|3000|9000/.test(x.report), 'no raw balances in the note');

    // A save through the real path files them as admin bug reports.
    res = await postJson(baseUrl, '/api/snapshot', {
      totalDebt: 8900,
      debtAccounts: [
        { id: 'card', name: 'Card', balance: 5900 },
        { id: 'loan', name: 'Loan', balance: 3000 },
      ],
    });
    assert.equal(res.status, 200);
    const filed = listBugReports(200).filter((r) => r.kind === 'invariant');
    assert.ok(filed.length >= 1, 'invariant violations were filed');

    run(resetAllGameState); // leave shared state clean for later suites
  });
});

test('report_bug_to_developer: files a player report, dedupes, rejects junk', () => {
  const summary = `The tier bar looks stuck ${process.pid}`;
  const first = run(() => executeStewardTool('report_bug_to_developer', {
    summary,
    details: 'Player says it has not moved since yesterday despite an update.',
  }, 'SomeRegularUser'));
  assert.equal(first.ok, true);
  assert.match(first.summary, /developer/i);

  const row = listBugReports(200).find((r) => r.kind === 'user' && r.title === summary);
  assert.ok(row, 'player report filed');
  assert.equal(row.severity, 'medium');
  assert.match(row.report, /Player-reported via chat/);

  // Same complaint again (any user) → same row, count bump.
  run(() => executeStewardTool('report_bug_to_developer', { summary }, 'OtherUser'));
  const after = listBugReports(200).find((r) => r.id === row.id);
  assert.equal(after.count, 2);

  // Junk summary → honest tool error, nothing filed.
  const bad = run(() => executeStewardTool('report_bug_to_developer', { summary: 'x' }, 'SomeRegularUser'));
  assert.equal(bad.ok, false);
});

test('setBugReportTriage attaches severity/title/report with caps', () => {
  const { id } = upsertBugReport({ signature: 'test-triage-' + process.pid, kind: 'error', userId: 1, raw: '{}' });
  setBugReportTriage(id, { severity: 'high', title: 't'.repeat(500), report: 'r'.repeat(5000) });
  const row = listBugReports(200).find((r) => r.id === id);
  assert.equal(row.severity, 'high');
  assert.equal(row.title.length, 200);
  assert.equal(row.report.length, 2000);
});
