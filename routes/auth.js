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

    const existing = findUserByUsername(username.trim());
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Username already taken.' });
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

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password are required.' });
    }

    const user = findUserByUsername(username.trim());
    if (!user || user.provider !== 'local' || !user.password) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

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
