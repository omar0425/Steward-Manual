'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRouter = require('../routes/auth');
const {
  createLocalUser,
  createSession,
  validateSession,
  findUserById,
  verifyPassword,
} = require('../db-auth');

const PW = 'original-password-1';

/* Harness mirrors server.js: parses the cookie header, attaches req.user from
   the session, and polyfills res.cookie so Set-Cookie actually reaches the
   client (the password-change flow issues a fresh session cookie). */
function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.cookies = {};
    const header = req.headers.cookie;
    if (header) {
      for (const pair of header.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) req.cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
      }
    }
    if (!res.cookie) {
      res.cookie = (name, value) => { res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/`); return res; };
    }
    if (!res.clearCookie) res.clearCookie = () => res;
    const sid = req.cookies.steward_sid;
    if (sid) req.user = validateSession(sid);
    next();
  });
  app.use('/api/auth', authRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
    server.on('error', reject);
  });
}

async function withApp(fn) {
  const { server, baseUrl } = await startApp();
  try { return await fn(baseUrl); }
  finally { await new Promise((r) => server.close(r)); }
}

function postJson(baseUrl, path, body, sid) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sid ? { cookie: `steward_sid=${sid}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
}

let _n = 0;
function makeUserWithSession() {
  _n += 1;
  const user = createLocalUser(`acctsec_${Date.now().toString(36)}_${_n}`, PW, null);
  const session = createSession(user.id);
  return { user, session };
}

test('change-password: auth, validation, and wrong-current rejections', async () => {
  await withApp(async (baseUrl) => {
    const { session } = makeUserWithSession();

    let res = await postJson(baseUrl, '/api/auth/change-password', { currentPassword: PW, newPassword: 'whatever-new-1' });
    assert.equal(res.status, 401, 'unauthenticated rejected');

    res = await postJson(baseUrl, '/api/auth/change-password', { currentPassword: PW, newPassword: 'short' }, session.id);
    assert.equal(res.status, 400, 'short new password rejected');

    res = await postJson(baseUrl, '/api/auth/change-password', { currentPassword: 'wrong-password-x', newPassword: 'long-enough-new-1' }, session.id);
    assert.equal(res.status, 401, 'wrong current password rejected');

    res = await postJson(baseUrl, '/api/auth/change-password', { currentPassword: PW, newPassword: PW }, session.id);
    assert.equal(res.status, 400, 'same-as-current rejected');
  });
});

test('change-password: rotates the password and every session, issues a fresh cookie', async () => {
  await withApp(async (baseUrl) => {
    const { user, session } = makeUserWithSession();
    const otherDevice = createSession(user.id);

    const res = await postJson(baseUrl, '/api/auth/change-password',
      { currentPassword: PW, newPassword: 'brand-new-password-9' }, session.id);
    assert.equal(res.status, 200);

    // Password actually changed
    const fresh = findUserById(user.id);
    assert.ok(verifyPassword('brand-new-password-9', fresh.password));
    assert.ok(!verifyPassword(PW, fresh.password));

    // Both old sessions are dead — including the caller's pre-change one
    assert.equal(validateSession(session.id), null, 'calling session rotated');
    assert.equal(validateSession(otherDevice.id), null, 'other device signed out');

    // The response carries a working replacement cookie
    const setCookie = res.headers.get('set-cookie') || '';
    const newSid = (setCookie.match(/steward_sid=([^;]+)/) || [])[1];
    assert.ok(newSid, 'fresh session cookie issued');
    assert.ok(validateSession(decodeURIComponent(newSid)), 'fresh session valid');
  });
});

test('logout-others: kills other sessions, keeps the caller signed in', async () => {
  await withApp(async (baseUrl) => {
    const { user, session } = makeUserWithSession();
    const phone = createSession(user.id);
    const tablet = createSession(user.id);

    const res = await postJson(baseUrl, '/api/auth/logout-others', {}, session.id);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.removed, 2);

    assert.equal(validateSession(phone.id), null);
    assert.equal(validateSession(tablet.id), null);
    assert.ok(validateSession(session.id), 'calling session preserved');
  });
});

test('register: per-IP limit blocks the 6th account in the window', async () => {
  process.env.STEWARD_FORCE_REGISTER_LIMIT = '1';
  try {
    await withApp(async (baseUrl) => {
      const stamp = Date.now().toString(36);
      let lastStatus = 0;
      for (let i = 1; i <= 6; i++) {
        const res = await postJson(baseUrl, '/api/auth/register', {
          username: `ratelimit_${stamp}_${i}`,
          password: 'tenchars-strong',
          email: `ratelimit_${stamp}_${i}@x.test`,
        });
        lastStatus = res.status;
        if (i <= 5) assert.equal(res.status, 200, `account ${i} allowed`);
      }
      assert.equal(lastStatus, 429, '6th account from same IP blocked');
    });
  } finally {
    delete process.env.STEWARD_FORCE_REGISTER_LIMIT;
  }
});
