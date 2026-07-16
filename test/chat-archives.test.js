'use strict';

/**
 * Saved-conversations lifecycle: save (archive + fresh thread), list, resume
 * (with auto-save of the live thread), delete, and the bounded-archive cap.
 * Chat history is seeded directly through config — the AI itself is not
 * involved in any of these endpoints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../routes/api');
const { withUser, resetAllGameState, setConfig, getConfig } = require('../db');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

async function post(baseUrl, urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function seedThread(messages) {
  withUser(0, () => setConfig('steward_chat_history', JSON.stringify(messages)));
}

const THREAD_A = [
  { role: 'user', text: 'How am I doing on the Klarna payoff?', at: '2026-07-01T10:00:00.000Z' },
  { role: 'assistant', text: 'Down $474 since the start — keep the pressure on.', at: '2026-07-01T10:00:05.000Z' },
];

test.beforeEach(() => { withUser(0, resetAllGameState); });

test('chat archive: save snapshots the thread, titles it, and starts fresh', async () => {
  await withApp(async (baseUrl) => {
    seedThread(THREAD_A);
    const res = await post(baseUrl, '/api/steward-ai/chat/archive');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.archives.length, 1);
    assert.equal(body.archives[0].title, 'How am I doing on the Klarna payoff?');
    assert.equal(body.archives[0].messageCount, 2);
    // The live thread restarted empty.
    const state = await (await fetch(`${baseUrl}/api/steward-ai/chat`)).json();
    assert.deepEqual(state.messages, []);
    assert.equal(state.archives.length, 1);
  });
});

test('chat archive: saving an empty thread is a friendly no-op', async () => {
  await withApp(async (baseUrl) => {
    const res = await post(baseUrl, '/api/steward-ai/chat/archive');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /empty/i);
  });
});

test('chat archive: resume restores the saved thread and auto-saves the live one', async () => {
  await withApp(async (baseUrl) => {
    seedThread(THREAD_A);
    const saved = await (await post(baseUrl, '/api/steward-ai/chat/archive')).json();
    const archivedId = saved.archives[0].id;

    // A new live conversation starts…
    seedThread([{ role: 'user', text: 'Different topic entirely', at: '2026-07-02T09:00:00.000Z' }]);

    const res = await post(baseUrl, '/api/steward-ai/chat/archives/resume', { id: archivedId });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // The old thread is live again…
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].text, THREAD_A[0].text);
    // …and the interrupted conversation was auto-saved, not destroyed.
    assert.equal(body.archives.length, 1);
    assert.equal(body.archives[0].title, 'Different topic entirely');
  });
});

test('chat archive: delete removes one saved conversation; unknown ids 404', async () => {
  await withApp(async (baseUrl) => {
    seedThread(THREAD_A);
    const saved = await (await post(baseUrl, '/api/steward-ai/chat/archive')).json();
    const id = saved.archives[0].id;

    let res = await post(baseUrl, '/api/steward-ai/chat/archives/delete', { id });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).archives, []);

    res = await post(baseUrl, '/api/steward-ai/chat/archives/delete', { id });
    assert.equal(res.status, 404);
    res = await post(baseUrl, '/api/steward-ai/chat/archives/resume', { id: 'chat-nope' });
    assert.equal(res.status, 404);
  });
});

test('chat archive: the archive shelf is bounded (oldest dropped past the cap)', async () => {
  await withApp(async (baseUrl) => {
    for (let i = 0; i < 23; i++) {
      seedThread([{ role: 'user', text: `Conversation number ${i}`, at: '2026-07-01T10:00:00.000Z' }]);
      const res = await post(baseUrl, '/api/steward-ai/chat/archive');
      assert.equal((await res.json()).ok, true);
    }
    const state = await (await fetch(`${baseUrl}/api/steward-ai/chat`)).json();
    assert.equal(state.archives.length, 20, 'capped at 20');
    // Newest first; the oldest three fell off.
    assert.equal(state.archives[0].title, 'Conversation number 22');
    assert.equal(state.archives[19].title, 'Conversation number 3');
  });
});

test('chat archive: reset clears the shelf', async () => {
  await withApp(async (baseUrl) => {
    seedThread(THREAD_A);
    await post(baseUrl, '/api/steward-ai/chat/archive');
    withUser(0, resetAllGameState);
    assert.equal(withUser(0, () => getConfig('steward_chat_archives')), null);
  });
});
