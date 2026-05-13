'use strict';

const express = require('express');
const router  = express.Router();
const {
  createLocalUser,
  findUserByUsername,
  findOrCreateGoogleUser,
  createSession,
  deleteSession,
  verifyPassword,
  SESSION_TTL_MS,
} = require('../db-auth');

const COOKIE_NAME = 'steward_sid';

function setSessionCookie(res, session) {
  res.cookie(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

// ── POST /api/auth/register ───────────────────────────────────────────────────

router.post('/register', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ ok: false, error: 'Username is required.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ ok: false, error: 'Password is required.' });
    }
    if (username.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'Username must be at least 3 characters.' });
    }
    if (username.trim().length > 30) {
      return res.status(400).json({ ok: false, error: 'Username must be 30 characters or fewer.' });
    }
    if (password.length < 10) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 10 characters.' });
    }
    if (password.length > 200) {
      return res.status(400).json({ ok: false, error: 'Password must be 200 characters or fewer.' });
    }

    const existing = findUserByUsername(username.trim());
    if (existing) {
      // Generic 400 — login uses identical 401s for wrong-user vs wrong-password
      // to prevent username enumeration; mirror that protection here so register
      // does not confirm whether an account exists.
      return res.status(400).json({ ok: false, error: 'Could not create account. Try a different username.' });
    }

    const user = createLocalUser(username.trim(), password);
    const session = createSession(user.id);
    setSessionCookie(res, session);

    return res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ ok: false, error: 'Registration failed.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
//
// In-memory rate limiter: 5 failed attempts per username per 15-minute window.
// A successful login clears the counter; the 6th failure inside the window
// returns 429 with a "try again in N minutes" message. Applies only to local
// password login — register and Google OAuth are not throttled here.

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const _loginAttempts = new Map(); // key: lowercased username → { count, firstAttemptAt }

// Periodic sweep of expired attempt entries. Each unique attempted username
// otherwise lingers in the Map for up to LOGIN_WINDOW_MS even after no
// further activity — small but unbounded over time. The sweep clears entries
// whose window has elapsed.
const _loginAttemptsSweepHandle = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _loginAttempts) {
    if (now - entry.firstAttemptAt >= LOGIN_WINDOW_MS) {
      _loginAttempts.delete(key);
    }
  }
}, LOGIN_WINDOW_MS);
if (typeof _loginAttemptsSweepHandle.unref === 'function') {
  _loginAttemptsSweepHandle.unref();
}

function _loginAttemptKey(rawUsername) {
  return String(rawUsername || '').trim().toLowerCase();
}

function _loginAttemptStatus(key) {
  const entry = _loginAttempts.get(key);
  if (!entry) return { blocked: false, retryAfterMs: 0 };
  const elapsed = Date.now() - entry.firstAttemptAt;
  if (elapsed >= LOGIN_WINDOW_MS) {
    _loginAttempts.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    return { blocked: true, retryAfterMs: LOGIN_WINDOW_MS - elapsed };
  }
  return { blocked: false, retryAfterMs: 0 };
}

function _recordLoginFailure(key) {
  const entry = _loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAttemptAt >= LOGIN_WINDOW_MS) {
    _loginAttempts.set(key, { count: 1, firstAttemptAt: Date.now() });
    return;
  }
  entry.count += 1;
}

function _clearLoginAttempts(key) {
  _loginAttempts.delete(key);
}

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password are required.' });
    }
    if (typeof password !== 'string' || password.length > 200) {
      return res.status(400).json({ ok: false, error: 'Password must be 200 characters or fewer.' });
    }

    const attemptKey = _loginAttemptKey(username);
    const status = _loginAttemptStatus(attemptKey);
    if (status.blocked) {
      const minutes = Math.max(1, Math.ceil(status.retryAfterMs / 60000));
      res.set('Retry-After', String(Math.ceil(status.retryAfterMs / 1000)));
      return res.status(429).json({
        ok: false,
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }

    const user = findUserByUsername(username.trim());
    if (!user || user.provider !== 'local' || !user.password) {
      _recordLoginFailure(attemptKey);
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    if (!verifyPassword(password, user.password)) {
      _recordLoginFailure(attemptKey);
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    _clearLoginAttempts(attemptKey);
    const session = createSession(user.id);
    setSessionCookie(res, session);

    return res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ ok: false, error: 'Login failed.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  const sid = req.cookies && req.cookies[COOKIE_NAME];
  if (sid) {
    deleteSession(sid);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  return res.json({
    ok: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      provider: req.user.provider,
    },
  });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(501).json({ ok: false, error: 'Google OAuth not configured.' });
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) {
      return res.redirect('/login?error=google_denied');
    }
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect('/login?error=google_not_configured');
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      console.error('[auth/google] Token exchange failed:', tokens);
      return res.redirect('/login?error=google_token_failed');
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json();
    if (!userRes.ok || !profile.email) {
      console.error('[auth/google] User info failed:', profile);
      return res.redirect('/login?error=google_profile_failed');
    }

    // Find or create user, create session
    const user = findOrCreateGoogleUser(profile.email, profile.name);
    const session = createSession(user.id);
    setSessionCookie(res, session);

    return res.redirect('/');
  } catch (err) {
    console.error('[auth/google/callback]', err);
    return res.redirect('/login?error=google_failed');
  }
});

// ── Google OAuth status (for frontend to know if button should show) ──────────
router.get('/google/status', (req, res) => {
  res.json({ ok: true, enabled: !!GOOGLE_CLIENT_ID });
});

module.exports = router;
module.exports.COOKIE_NAME = COOKIE_NAME;
