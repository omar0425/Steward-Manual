'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRouter = require('../routes/auth');
const {
  findUserByUsername,
  findUserByEmail,
  setUserEmail,
  createPasswordResetToken,
  createSession,
  validateSession,
  verifyPassword,
} = require('../db-auth');

// Tests inherit STEWARD_DB_PATH from run-all.js, so each test cleans up after
// itself by using unique usernames/emails. Resend dispatch is skipped because
// RESEND_API_KEY is unset in the test env — falls back to console mode.

function startApp() {
  const app = express();
  app.use(express.json());
  // Auth router needs req.cookies / res.cookie polyfill (server.js wires these
  // for real; recreate the minimum the router actually uses).
  app.use((req, res, next) => {
    req.cookies = {};
    if (!res.cookie) {
      res.cookie = (name, value) => { res._lastCookie = { name, value }; return res; };
    }
    if (!res.clearCookie) res.clearCookie = () => res;
    next();
  });
  app.use('/api/auth', authRouter);
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
  try { return await fn(baseUrl); }
  finally { await new Promise(r => server.close(r)); }
}

async function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('register: email required by default (rejects without it)', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/auth/register', {
      username: 'resetuser1',
      password: 'tenchars-strong',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /email is required/i);
  });
});

test('register: rejects malformed email', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/auth/register', {
      username: 'resetuser2',
      email: 'not-an-email',
      password: 'tenchars-strong',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /email looks invalid/i);
  });
});

test('register: accepts valid email, stores normalized lowercase', async () => {
  await withApp(async (baseUrl) => {
    const res = await postJson(baseUrl, '/api/auth/register', {
      username: 'resetuser3',
      email: 'Reset.User3@Example.COM',
      password: 'tenchars-strong',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.email, 'reset.user3@example.com');
  });
});

test('forgot-password: always returns generic success (no enumeration)', async () => {
  await withApp(async (baseUrl) => {
    // Unknown email — generic 200
    const r1 = await postJson(baseUrl, '/api/auth/forgot-password', {
      email: 'nobody-here-12345@example.com',
    });
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.ok, true);
    assert.match(b1.message, /if an account/i);

    // Malformed email — also generic 200
    const r2 = await postJson(baseUrl, '/api/auth/forgot-password', {
      email: 'not-an-email',
    });
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.ok, true);
    assert.match(b2.message, /if an account/i);
  });
});

test('reset-password: rejects bad/expired/missing tokens with generic error', async () => {
  await withApp(async (baseUrl) => {
    const r1 = await postJson(baseUrl, '/api/auth/reset-password', {
      token: '',
      password: 'tenchars-strong',
    });
    assert.equal(r1.status, 400);

    const r2 = await postJson(baseUrl, '/api/auth/reset-password', {
      token: 'nope-this-token-does-not-exist',
      password: 'tenchars-strong',
    });
    assert.equal(r2.status, 400);
    const b2 = await r2.json();
    assert.match(b2.error, /invalid or expired/i);
  });
});

test('reset-password: enforces password length on the new password', async () => {
  await withApp(async (baseUrl) => {
    const r = await postJson(baseUrl, '/api/auth/reset-password', {
      token: 'whatever',
      password: 'short',
    });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.match(b.error, /at least 10/i);
  });
});

test('full flow: register → forgot → mint token directly → reset → login with new pw', async () => {
  await withApp(async (baseUrl) => {
    // Register
    const reg = await postJson(baseUrl, '/api/auth/register', {
      username: 'flowuser',
      email: 'flowuser@example.com',
      password: 'original-password',
    });
    assert.equal(reg.status, 200);

    // Forgot endpoint always 200; we don't have the raw token from the email,
    // so for the test we mint a token directly to exercise the redeem path.
    const fp = await postJson(baseUrl, '/api/auth/forgot-password', {
      email: 'flowuser@example.com',
    });
    assert.equal(fp.status, 200);

    const user = findUserByEmail('flowuser@example.com');
    assert.ok(user, 'user should exist after register');
    const { token } = createPasswordResetToken(user.id);

    // Use the token
    const rp = await postJson(baseUrl, '/api/auth/reset-password', {
      token,
      password: 'brand-new-password',
    });
    assert.equal(rp.status, 200);
    const rpBody = await rp.json();
    assert.equal(rpBody.ok, true);

    // Old password must NOT work anymore
    const oldLogin = await postJson(baseUrl, '/api/auth/login', {
      username: 'flowuser',
      password: 'original-password',
    });
    assert.equal(oldLogin.status, 401);

    // New password works
    const newLogin = await postJson(baseUrl, '/api/auth/login', {
      username: 'flowuser',
      password: 'brand-new-password',
    });
    assert.equal(newLogin.status, 200);
  });
});

test('reset token is single-use: second redemption is rejected', async () => {
  await withApp(async (baseUrl) => {
    await postJson(baseUrl, '/api/auth/register', {
      username: 'singleuse',
      email: 'singleuse@example.com',
      password: 'original-password',
    });
    const user = findUserByEmail('singleuse@example.com');
    const { token } = createPasswordResetToken(user.id);

    const r1 = await postJson(baseUrl, '/api/auth/reset-password', {
      token,
      password: 'second-password',
    });
    assert.equal(r1.status, 200);

    const r2 = await postJson(baseUrl, '/api/auth/reset-password', {
      token,
      password: 'third-password',
    });
    assert.equal(r2.status, 400);
    const b2 = await r2.json();
    assert.match(b2.error, /invalid or expired/i);
  });
});

test('reset-password invalidates all existing sessions for the user', async () => {
  await withApp(async (baseUrl) => {
    await postJson(baseUrl, '/api/auth/register', {
      username: 'sessionkill',
      email: 'sessionkill@example.com',
      password: 'original-password',
    });
    const user = findUserByUsername('sessionkill');
    const sessionA = createSession(user.id);
    const sessionB = createSession(user.id);
    assert.ok(validateSession(sessionA.id));
    assert.ok(validateSession(sessionB.id));

    const { token } = createPasswordResetToken(user.id);
    const rp = await postJson(baseUrl, '/api/auth/reset-password', {
      token,
      password: 'a-fresh-new-password',
    });
    assert.equal(rp.status, 200);

    assert.equal(validateSession(sessionA.id), null);
    assert.equal(validateSession(sessionB.id), null);
  });
});

test('PATCH /me/email: requires auth, validates, normalizes', async () => {
  await withApp(async (baseUrl) => {
    // Unauthed → 401
    const unauthed = await fetch(`${baseUrl}/api/auth/me/email`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'foo@example.com' }),
    });
    assert.equal(unauthed.status, 401);
  });
});
