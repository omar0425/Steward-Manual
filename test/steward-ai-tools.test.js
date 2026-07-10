'use strict';

// Steward AI tools: the executor behind the chat model's actions. Every write
// must flow through the same validated snapshot path as the manual form —
// undoable, classified, user-scoped. No model calls anywhere in this suite;
// the executor is deterministic server logic.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { executeStewardTool } = require('../routes/api');
const {
  withUser,
  resetAllGameState,
  getConfig,
  setConfig,
  getAllDebtAccountBalances,
  latestSnapshot,
} = require('../db');
const stewardAiMemory = require('../services/stewardAiMemory');
const stewardAiContext = require('../services/stewardAiContext');
// Top-level (NOT lazy) requires: zzz-climb-metrics-apply.test clears the module
// cache for db + climbMetrics when it loads, so an in-test require would grab a
// fresh copy bound to a different AsyncLocalStorage than our withUser().
const { getClimbStatsFromConfig } = require('../services/climbMetrics');
const { STEWARD_AI_TOOLS } = require('../routes/api');

function startApp(username) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { userId: 1, username }; next(); });
  app.use('/api', apiRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp('ToolTester');
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedClimb(baseUrl) {
  let res = await postJson(baseUrl, '/api/snapshot', {
    totalDebt: 8000,
    debtAccounts: [
      { id: 'visa', name: 'Visa', balance: 6000 },
      { id: 'med', name: 'Medical', balance: 2000 },
    ],
  });
  assert.equal(res.status, 200);
  res = await fetch(`${baseUrl}/api/start-game`, { method: 'POST' });
  assert.equal(res.status, 200);
}

const run = (fn) => withUser(1, fn);

test.beforeEach(() => {
  run(resetAllGameState);
  // Memories are a preference that survives reset — clear explicitly per test.
  run(() => setConfig('steward_ai_memory', ''));
});

test('update_debt_balances: records a payment through the real snapshot path, undoably', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);

    const out = run(() => executeStewardTool('update_debt_balances', {
      changes: [{ account: 'Visa', newBalance: 5400 }],
    }, 'ToolTester'));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.dataChanged, true);
    assert.match(out.summary, /Visa: \$6,000 → \$5,400 \(paid down \$600\)/);

    // The balance really moved and a snapshot really landed.
    assert.equal(run(() => getAllDebtAccountBalances()).get('visa'), 5400);
    assert.equal(run(() => latestSnapshot()).debt_remaining, 7400);

    // And it is one-click reversible — the same undo the manual form gets.
    const undo = run(() => executeStewardTool('undo_last_entry', {}, 'ToolTester'));
    assert.equal(undo.ok, true, JSON.stringify(undo));
    assert.equal(run(() => getAllDebtAccountBalances()).get('visa'), 6000);
  });
});

test('update_debt_balances: resolves names case-insensitively; rejects ambiguity and unknowns', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);

    // Case-insensitive name match works.
    const ok = run(() => executeStewardTool('update_debt_balances', {
      changes: [{ account: 'medical', newBalance: 1500 }],
    }, 'ToolTester'));
    assert.equal(ok.ok, true);

    // Unknown account → helpful error listing the real names (fed back to the model).
    const missing = run(() => executeStewardTool('update_debt_balances', {
      changes: [{ account: 'Amex', newBalance: 100 }],
    }, 'ToolTester'));
    assert.equal(missing.ok, false);
    assert.match(missing.error, /No account matches "Amex"/);
    assert.match(missing.error, /Visa/);

    // Validation from the shared path holds: negative balances bounce.
    const negative = run(() => executeStewardTool('update_debt_balances', {
      changes: [{ account: 'Visa', newBalance: -50 }],
    }, 'ToolTester'));
    assert.equal(negative.ok, false);
  });
});

test('update_debt_balances: increase classifications route to the climb buckets', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);
    const out = run(() => executeStewardTool('update_debt_balances', {
      changes: [{ account: 'Visa', newBalance: 6090, reason: 'interest' }],
    }, 'ToolTester'));
    assert.equal(out.ok, true);
    const stats = run(() => getClimbStatsFromConfig());
    assert.equal(stats.cumulativeInterestAccrued, 90, 'the $90 rise went to interest, not new debt');
    assert.equal(stats.cumulativeNewDebtAdded, 0);
  });
});

test('add_debt_account: adds with APR + terms in one call; duplicate names bounce', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);
    const out = run(() => executeStewardTool('add_debt_account', {
      name: 'Chase Sapphire', balance: 3200, aprPercent: 24.99, minPayment: 85, dueDay: 15,
    }, 'ToolTester'));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(out.summary, /Added Chase Sapphire at \$3,200/);
    assert.match(out.summary, /APR 24\.99%/);

    const balances = run(() => getAllDebtAccountBalances());
    assert.equal(balances.get('chase-sapphire'), 3200);
    const rates = JSON.parse(run(() => getConfig('interest_rates')));
    assert.equal(rates['chase-sapphire'], 24.99);
    const terms = JSON.parse(run(() => getConfig('debt_terms')));
    assert.deepEqual(terms['chase-sapphire'], { minPayment: 85, dueDay: 15 });

    // Existing accounts kept their balances — the tool sends the FULL list.
    assert.equal(balances.get('visa'), 6000);
    assert.equal(balances.get('med'), 2000);

    const dupe = run(() => executeStewardTool('add_debt_account', {
      name: 'chase sapphire', balance: 100,
    }, 'ToolTester'));
    assert.equal(dupe.ok, false);
    assert.match(dupe.error, /already exists/);
  });
});

test('set_debt_terms / set_interest_rate: merge (never clobber other accounts) and validate ranges', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);
    // Seed existing terms for med via the route, then have the AI set visa's.
    await postJson(baseUrl, '/api/config/debt-terms', { terms: { med: { dueDay: 5 } } });

    const t = run(() => executeStewardTool('set_debt_terms', { account: 'Visa', minPayment: 150, dueDay: 21 }, 'ToolTester'));
    assert.equal(t.ok, true, JSON.stringify(t));
    const terms = JSON.parse(run(() => getConfig('debt_terms')));
    assert.deepEqual(terms.visa, { minPayment: 150, dueDay: 21 });
    assert.deepEqual(terms.med, { dueDay: 5 }, 'AI term writes merge — the other account survives');

    assert.equal(run(() => executeStewardTool('set_debt_terms', { account: 'Visa', dueDay: 42 }, 'ToolTester')).ok, false);
    assert.equal(run(() => executeStewardTool('set_debt_terms', { account: 'Visa' }, 'ToolTester')).ok, false);

    const r = run(() => executeStewardTool('set_interest_rate', { account: 'med', aprPercent: 7.5 }, 'ToolTester'));
    assert.equal(r.ok, true);
    assert.equal(JSON.parse(run(() => getConfig('interest_rates'))).med, 7.5);
    assert.equal(run(() => executeStewardTool('set_interest_rate', { account: 'med', aprPercent: 250 }, 'ToolTester')).ok, false);
  });
});

test('manage_memory: save/update/delete round-trip, dedupe, cap, and payload injection', async () => {
  await withApp(async (baseUrl) => {
    await seedClimb(baseUrl);

    const save = run(() => executeStewardTool('manage_memory', { action: 'save', fact: 'Gets paid on the 15th.' }, 'ToolTester'));
    assert.equal(save.ok, true);
    // Saving the identical fact again is a quiet no-op, not a duplicate row.
    run(() => executeStewardTool('manage_memory', { action: 'save', fact: 'gets paid on the 15th.' }, 'ToolTester'));
    let memories = run(() => stewardAiMemory.readMemories());
    assert.equal(memories.length, 1);
    const id = memories[0].id;

    // Injected into every AI context payload.
    const ctx = run(() => stewardAiContext.buildContext());
    assert.deepEqual(ctx.payload.memories, [{ id, fact: 'Gets paid on the 15th.' }]);

    const upd = run(() => executeStewardTool('manage_memory', { action: 'update', id, fact: 'Gets paid on the 1st.' }, 'ToolTester'));
    assert.equal(upd.ok, true);
    assert.equal(run(() => stewardAiMemory.readMemories())[0].fact, 'Gets paid on the 1st.');

    const del = run(() => executeStewardTool('manage_memory', { action: 'delete', id }, 'ToolTester'));
    assert.equal(del.ok, true);
    assert.deepEqual(run(() => stewardAiMemory.readMemories()), []);
    assert.equal(run(() => executeStewardTool('manage_memory', { action: 'delete', id: 999 }, 'ToolTester')).ok, false);

    // Cap: oldest facts are evicted, never an unbounded prompt.
    run(() => {
      for (let i = 0; i < stewardAiMemory.MEMORY_MAX + 10; i++) {
        stewardAiMemory.saveMemory(`fact number ${i}`);
      }
    });
    memories = run(() => stewardAiMemory.readMemories());
    assert.equal(memories.length, stewardAiMemory.MEMORY_MAX);
    assert.equal(memories[0].fact, 'fact number 10', 'oldest evicted first');
  });
});

test('memory routes: player can list and delete what the Steward remembers', async () => {
  await withApp(async (baseUrl) => {
    run(() => stewardAiMemory.saveMemory('Car repair coming in August.'));
    let res = await fetch(`${baseUrl}/api/steward-ai/memory`);
    let body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.memories.length, 1);

    res = await postJson(baseUrl, '/api/steward-ai/memory/delete', { id: body.memories[0].id });
    body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.memories, []);

    assert.equal((await postJson(baseUrl, '/api/steward-ai/memory/delete', { id: 12345 })).status, 404);
    assert.equal((await postJson(baseUrl, '/api/steward-ai/memory/delete', {})).status, 400);
  });
});

test('guardrails: no reset/start/delete tools exist; unknown tools bounce cleanly', () => {
  const names = STEWARD_AI_TOOLS.map((t) => t.name);
  for (const forbidden of ['reset', 'start_game', 'delete_account', 'import', 'export']) {
    assert.ok(!names.some((n) => n.includes(forbidden)), `no tool may touch ${forbidden}`);
  }
  const out = run(() => executeStewardTool('reset_game', {}, 'ToolTester'));
  assert.equal(out.ok, false);
  assert.match(out.error, /Unknown tool/);
});

test('undo_last_entry: honest errors before a climb and with an empty stack', async () => {
  await withApp(async (baseUrl) => {
    // No climb at all.
    let out = run(() => executeStewardTool('undo_last_entry', {}, 'ToolTester'));
    assert.equal(out.ok, false);
    assert.match(out.error, /No active climb/);

    await seedClimb(baseUrl);
    out = run(() => executeStewardTool('undo_last_entry', {}, 'ToolTester'));
    assert.equal(out.ok, false, 'nothing recorded since the climb started → nothing to undo');
  });
});
