'use strict';

const express = require('express');
const router  = express.Router();
const {
  createLocalUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  findOrCreateGoogleUser,
  setUserEmail,
  setUserPassword,
  createSession,
  deleteSession,
  deleteUserSessions,
  deleteOtherUserSessions,
  deleteUserAccount,
  verifyPassword,
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
} = require('../db-auth');
const { withUser, resetAllGameState } = require('../db');
const {
  sendEmail,
  buildPasswordResetEmail,
  looksLikeEmail,
  APP_BASE_URL,
} = require('../services/email');

const COOKIE_NAME = 'steward_sid';

function setSessionCookie(res, session) {
  res.cookie(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    // Only send the session cookie over HTTPS in production. Behind Railway's
    // TLS-terminating proxy (trust proxy = 1) Express sees the request as
    // secure, so the cookie is set and returned correctly. Off in dev/test
    // where there's no TLS.
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
//
// Per-IP creation limit: 5 new accounts per IP per hour. Counted only on
// SUCCESSFUL creation so a legit user fumbling validation isn't locked out,
// while a bot can't bloat the users table on a public deploy. Same in-memory
// map + sweep pattern as the login and forgot-password limiters.

const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_PER_WINDOW = 5;
const _registerCreations = new Map(); // ip → { count, firstAt }
const _registerSweepHandle = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _registerCreations) {
    if (now - v.firstAt >= REGISTER_WINDOW_MS) _registerCreations.delete(k);
  }
}, REGISTER_WINDOW_MS);
if (typeof _registerSweepHandle.unref === 'function') _registerSweepHandle.unref();

function _clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString().split(',')[0].trim().slice(0, 64);
}

/* Test suites (unit + e2e) register many users from 127.0.0.1 and would trip
   the limiter instantly; they run with NODE_ENV=test. The dedicated limiter
   test opts back in via STEWARD_FORCE_REGISTER_LIMIT. */
function _registerLimiterActive() {
  return process.env.NODE_ENV !== 'test' || process.env.STEWARD_FORCE_REGISTER_LIMIT === '1';
}

function _registerBlocked(ip) {
  const entry = _registerCreations.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt >= REGISTER_WINDOW_MS) {
    _registerCreations.delete(ip);
    return false;
  }
  return entry.count >= REGISTER_MAX_PER_WINDOW;
}

function _recordRegistration(ip) {
  const entry = _registerCreations.get(ip);
  if (!entry || Date.now() - entry.firstAt >= REGISTER_WINDOW_MS) {
    _registerCreations.set(ip, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.post('/register', (req, res) => {
  try {
    const { username, password, email } = req.body || {};

    const ip = _clientIp(req);
    if (_registerLimiterActive() && _registerBlocked(ip)) {
      res.set('Retry-After', String(Math.ceil(REGISTER_WINDOW_MS / 1000)));
      return res.status(429).json({ ok: false, error: 'Too many new accounts from this connection. Try again later.' });
    }

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
    // Email required for password reset capability. Accept missing only when
    // STEWARD_ALLOW_REGISTER_WITHOUT_EMAIL=1 (single-user / dev mode).
    const allowMissingEmail = process.env.STEWARD_ALLOW_REGISTER_WITHOUT_EMAIL === '1';
    if (!email || typeof email !== 'string' || !email.trim()) {
      if (!allowMissingEmail) {
        return res.status(400).json({ ok: false, error: 'Email is required.' });
      }
    } else if (!looksLikeEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Email looks invalid.' });
    } else if (email.length > 254) {
      return res.status(400).json({ ok: false, error: 'Email is too long.' });
    }

    const existing = findUserByUsername(username.trim());
    if (existing) {
      // Generic 400 — login uses identical 401s for wrong-user vs wrong-password
      // to prevent username enumeration; mirror that protection here so register
      // does not confirm whether an account exists.
      return res.status(400).json({ ok: false, error: 'Could not create account. Try a different username.' });
    }
    // Same protection for email: don't leak "this email is taken." Return the
    // identical generic error so register can't be used to test which emails
    // have accounts.
    const normalizedEmail = email && email.trim() ? email.trim().toLowerCase() : null;
    if (normalizedEmail && findUserByEmail(normalizedEmail)) {
      return res.status(400).json({ ok: false, error: 'Could not create account. Try a different username.' });
    }

    const user = createLocalUser(username.trim(), password, normalizedEmail);
    if (_registerLimiterActive()) _recordRegistration(ip);
    const session = createSession(user.id);
    setSessionCookie(res, session);

    // Structured signup log → visible in Railway's log stream without shelling
    // into the DB. No password/secret material is logged.
    console.log(
      `[auth] register username=${user.username} id=${user.id} email=${user.email || '-'} provider=${user.provider} at=${new Date().toISOString()}`,
    );

    return res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email } });
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

    // Structured login log → live signup/login feed in Railway logs.
    console.log(
      `[auth] login username=${user.username} id=${user.id} at=${new Date().toISOString()}`,
    );

    return res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email || null },
      // Flag legacy accounts so the frontend can prompt for an email so the
      // user can use password reset later. Doesn't block login.
      needsEmail: user.provider === 'local' && !user.email,
    });
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
  res.clearCookie(COOKIE_NAME, { path: '/', secure: process.env.NODE_ENV === 'production' });
  return res.json({ ok: true });
});

// ── POST /api/auth/delete-account ─────────────────────────────────────────────
//
// Permanently delete the authenticated user. Removes game data first (snapshots,
// debt accounts, config keys scoped to the user), then deletes the user row —
// which CASCADEs to sessions and password_reset_tokens via the schema FKs.
// Clears the session cookie before responding. Caller is expected to redirect
// to /login after a successful response.
//
// Requires `confirm: true` in the body so a stray fetch can't nuke an account.

router.post('/delete-account', (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
    }
    if (!(req.body && req.body.confirm === true)) {
      return res.status(400).json({ ok: false, error: 'confirm: true required to delete account' });
    }
    const userId = req.user.userId;
    /* Run inside withUser scope so resetAllGameState() targets this user. */
    withUser(userId, () => {
      resetAllGameState();
    });
    deleteUserAccount(userId);
    /* Clear the session cookie — the session row itself is already gone via
       the CASCADE on the users FK, but the browser still has the cookie. */
    res.clearCookie(COOKIE_NAME, { path: '/', secure: process.env.NODE_ENV === 'production' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/delete-account]', err);
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : 'Account deletion failed.',
    });
  }
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
    needsEmail: req.user.provider === 'local' && !req.user.email,
  });
});

// ── PATCH /api/auth/me/email ──────────────────────────────────────────────────
//
// Authenticated route that lets a legacy local user attach an email to their
// account (or update an existing one). Required so existing accounts can
// opt into password reset without forcing them to recreate the account.
router.patch('/me/email', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'Email is required.' });
  }
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Email looks invalid.' });
  }
  if (email.length > 254) {
    return res.status(400).json({ ok: false, error: 'Email is too long.' });
  }
  const normalized = email.trim().toLowerCase();
  const taken = findUserByEmail(normalized);
  if (taken && taken.id !== req.user.userId) {
    // Don't leak account existence — same generic copy as register.
    return res.status(400).json({ ok: false, error: 'Could not save email. Try a different one.' });
  }
  try {
    setUserEmail(req.user.userId, normalized);
  } catch (err) {
    console.error('[auth/me/email]', err);
    return res.status(500).json({ ok: false, error: 'Could not save email.' });
  }
  return res.json({ ok: true, email: normalized });
});

// ── POST /api/auth/change-password ────────────────────────────────────────────
//
// Logged-in password rotation (the forgot-password email flow was previously
// the ONLY way to change a password). Verifies the current password, applies
// the same rules as register, then invalidates every session — including this
// one — and issues a fresh cookie so the caller stays signed in while any
// stolen session dies.

router.post('/change-password', (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
    }
    if (req.user.provider !== 'local') {
      return res.status(400).json({ ok: false, error: 'This account signs in with Google and has no password.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || typeof currentPassword !== 'string'
        || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ ok: false, error: 'Current and new password are required.' });
    }
    if (newPassword.length < 10) {
      return res.status(400).json({ ok: false, error: 'New password must be at least 10 characters.' });
    }
    if (newPassword.length > 200) {
      return res.status(400).json({ ok: false, error: 'New password must be 200 characters or fewer.' });
    }
    const user = findUserById(req.user.userId);
    if (!user || !user.password || !verifyPassword(currentPassword, user.password)) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
    }
    if (verifyPassword(newPassword, user.password)) {
      return res.status(400).json({ ok: false, error: 'New password must be different from your current password.' });
    }
    setUserPassword(user.id, newPassword);
    // Rotate everything: any session a thief might hold dies with the old
    // password; the caller continues on a brand-new session.
    deleteUserSessions(user.id);
    const session = createSession(user.id);
    setSessionCookie(res, session);
    console.log(`[auth] change-password username=${user.username} id=${user.id} at=${new Date().toISOString()}`);
    return res.json({ ok: true, message: 'Password updated. Other devices have been signed out.' });
  } catch (err) {
    console.error('[auth/change-password]', err);
    return res.status(500).json({ ok: false, error: 'Password change failed.' });
  }
});

// ── POST /api/auth/logout-others ──────────────────────────────────────────────
//
// "Sign out other devices" — kills every session except the calling one.
// Works for both local and Google accounts.

router.post('/logout-others', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  try {
    const removed = deleteOtherUserSessions(req.user.userId, req.user.sessionId);
    console.log(`[auth] logout-others username=${req.user.username} id=${req.user.userId} removed=${removed}`);
    return res.json({ ok: true, removed });
  } catch (err) {
    console.error('[auth/logout-others]', err);
    return res.status(500).json({ ok: false, error: 'Could not sign out other devices.' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
//
// Always returns a generic success response — never leaks whether an email is
// registered. Internally: if a local user with that email exists, mint a
// single-use reset token (1h expiry) and dispatch via Resend (or console in
// dev). Rate-limited per email + per source IP to blunt enumeration / abuse.

const FORGOT_WINDOW_MS = 60 * 60 * 1000;        // 1 hour
const FORGOT_MAX_PER_WINDOW = 5;
const _forgotAttempts = new Map();              // key → { count, firstAt }
const _forgotSweepHandle = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _forgotAttempts) {
    if (now - v.firstAt >= FORGOT_WINDOW_MS) _forgotAttempts.delete(k);
  }
}, FORGOT_WINDOW_MS);
if (typeof _forgotSweepHandle.unref === 'function') _forgotSweepHandle.unref();

function _forgotKey(email, ip) {
  return `${String(email || '').trim().toLowerCase()}|${String(ip || '').slice(0, 64)}`;
}
function _forgotShouldThrottle(key) {
  const entry = _forgotAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt >= FORGOT_WINDOW_MS) {
    _forgotAttempts.delete(key);
    return false;
  }
  return entry.count >= FORGOT_MAX_PER_WINDOW;
}
function _forgotBumpCount(key) {
  const entry = _forgotAttempts.get(key);
  if (!entry || Date.now() - entry.firstAt >= FORGOT_WINDOW_MS) {
    _forgotAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.post('/forgot-password', async (req, res) => {
  // Generic response so attackers can't distinguish "email exists" from "no".
  const genericResponse = {
    ok: true,
    message: 'If an account with that email exists, a reset link is on its way.',
  };
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !looksLikeEmail(email)) {
      // Still 200 — don't leak input-validity either.
      return res.json(genericResponse);
    }
    const normalized = email.trim().toLowerCase();
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const key = _forgotKey(normalized, ip);
    if (_forgotShouldThrottle(key)) {
      // Even when throttled, respond 200 generically so attackers don't learn anything.
      return res.json(genericResponse);
    }
    _forgotBumpCount(key);

    const user = findUserByEmail(normalized);
    // Only dispatch for local users with an email. Google-provider accounts
    // don't have a password to reset; tell the user via their generic response.
    if (user && user.provider === 'local' && user.email) {
      const { token, expiresAt } = createPasswordResetToken(user.id);
      const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
      const ttlMinutes = Math.round(PASSWORD_RESET_TTL_MS / 60000);
      const built = buildPasswordResetEmail({
        username: user.username,
        resetUrl,
        ttlMinutes,
      });
      // Fire-and-await — but failure to dispatch must NOT change the response
      // shape (otherwise we leak success vs failure for known emails).
      const result = await sendEmail({
        to: user.email,
        subject: built.subject,
        text: built.text,
        html: built.html,
      });
      if (!result.ok) {
        console.error('[auth/forgot-password] email dispatch failed:', result.error);
      }
      // Hand back expiresAt in non-production for easier testing; never in prod.
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ ...genericResponse, _devTokenExpiresAt: expiresAt });
      }
    }
    return res.json(genericResponse);
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    // Still respond 200 generically — don't reveal server errors here.
    return res.json(genericResponse);
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
//
// Consumes a single-use token, sets the new password, deletes all sessions
// for that user (so a thief can't keep a stolen session alive after reset).
router.post('/reset-password', (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ ok: false, error: 'Token and new password are required.' });
    }
    if (password.length < 10) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 10 characters.' });
    }
    if (password.length > 200) {
      return res.status(400).json({ ok: false, error: 'Password must be 200 characters or fewer.' });
    }
    const row = findValidPasswordResetToken(token);
    if (!row) {
      // Single generic error — don't disambiguate expired vs used vs unknown.
      return res.status(400).json({ ok: false, error: 'Reset link is invalid or expired. Request a new one.' });
    }
    // Reject "new" passwords that match the current one. Otherwise a user
    // can complete the reset flow without actually rotating their password —
    // wasting the reset and (if the original was compromised) leaving the
    // door open. Token is NOT consumed on this branch so the user can submit
    // a different password against the same link.
    const fullUser = findUserById(row.user_id);
    if (fullUser && fullUser.password && verifyPassword(password, fullUser.password)) {
      return res.status(400).json({
        ok: false,
        error: 'New password must be different from your current password.',
      });
    }
    setUserPassword(row.user_id, password);
    consumePasswordResetToken(row.id);
    // Invalidate every existing session for this user — covers the case where
    // the original account was compromised. The user logs in fresh after reset.
    deleteUserSessions(row.user_id);
    return res.json({ ok: true, message: 'Password updated. Please log in with your new password.' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    return res.status(500).json({ ok: false, error: 'Password reset failed.' });
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Default the redirect URI off APP_BASE_URL so a deploy that sets only
// APP_BASE_URL (already required for password-reset links) gets a working
// callback instead of silently inheriting localhost. The resulting URL must
// still be listed under "Authorized redirect URIs" in the Google console.
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || `${APP_BASE_URL}/api/auth/google/callback`;

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

    // Structured login log (Google path) → same feed as local register/login.
    console.log(
      `[auth] login-google username=${user.username} id=${user.id} email=${user.email || '-'} at=${new Date().toISOString()}`,
    );

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
